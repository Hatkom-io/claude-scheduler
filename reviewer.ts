import { spawnSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { log, type Config, type RepoEntry } from './utils.ts'

type ResolvedRepo = {
  repo: string
  path?: string
}

type PullRequest = {
  number: number
  title: string
  repo: string
  path?: string
  skill: string
  labels: Array<{ name: string }>
}

const defaultSkill = '/cs-pr-review'
const localSkill = '/pr-review'
const localSkillPath = '.claude/commands/pr-review.md'

const detectSkill = (path?: string): string => {
  if (path && existsSync(resolve(path, localSkillPath))) {
    return localSkill
  }
  return defaultSkill
}

const normalizeRepo = (repo: string): string => {
  const match = repo.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  return match ? match[1] : repo
}

const resolveRepo = (entry: RepoEntry): ResolvedRepo => {
  const raw = typeof entry === 'string' ? { repo: entry } : entry
  return { ...raw, repo: normalizeRepo(raw.repo) }
}

const getPendingPRs = (config: Config): PullRequest[] => {
  const allPRs: PullRequest[] = []

  for (const entry of config.repos) {
    const { repo, path } = resolveRepo(entry)
    try {
      const result = spawnSync(
        'gh',
        ['pr', 'list', '--repo', repo, '--label', config.label, '--json', 'number,labels,title'],
        { encoding: 'utf-8' },
      )
      if (result.status !== 0) {
        throw new Error(result.stderr.trim())
      }
      const json = result.stdout.trim()

      const prs: Array<Omit<PullRequest, 'repo' | 'path' | 'skill'>> = JSON.parse(json)

      const pending = prs
        .filter((pr) => {
          const labels = pr.labels.map((l) => l.name)
          return !labels.includes(config.reviewedLabel)
        })
        .map((pr) => ({ ...pr, repo, path, skill: detectSkill(path) }))

      allPRs.push(...pending)
    } catch (error) {
      log(`Failed to fetch PRs from ${repo}: ${(error as Error).message}`)
    }
  }

  return allPRs
}

const maxConcurrency = 5
const timeoutMs = 10 * 60 * 1000
const killGraceMs = 10 * 1000

const reviewPR = (pr: PullRequest): Promise<string> => {
  return new Promise((resolve, reject) => {
    const prompt = `${pr.skill} ${pr.number} --repo ${pr.repo}`
    const args = [
      '-p',
      prompt,
      '--dangerously-skip-permissions',
      '--model',
      'opus',
    ]

    const cwdInfo = pr.path ? ` cwd=${pr.path}` : ''
    log(`Spawning: claude -p "${prompt}" (${pr.repo}${cwdInfo} skill=${pr.skill})`)

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(pr.path && { cwd: pr.path }),
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const killTimer = setTimeout(() => {
      killed = true
      log(`${pr.repo}#${pr.number}: timed out after ${timeoutMs / 60000}min, sending SIGTERM`)
      child.kill('SIGTERM')

      setTimeout(() => {
        if (!child.killed) {
          log(`${pr.repo}#${pr.number}: still alive after SIGTERM, sending SIGKILL`)
          child.kill('SIGKILL')
        }
      }, killGraceMs)
    }, timeoutMs)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(killTimer)

      if (killed) {
        reject(new Error(`claude timed out reviewing ${pr.repo}#${pr.number}`))
      } else if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr}`))
      }
    })

    child.on('error', (error) => {
      clearTimeout(killTimer)
      reject(error)
    })
  })
}

let running = false

export const runReviewCycle = async (config: Config) => {
  if (running) {
    log('Previous cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting review cycle')
    const prs = getPendingPRs(config)

    if (prs.length === 0) {
      log('No PRs pending review')
      return
    }

    log(
      `Found ${prs.length} PR(s) to review: ${prs.map((pr) => `${pr.repo}#${pr.number} "${pr.title}"`).join(', ')}`,
    )

    for (let i = 0; i < prs.length; i += maxConcurrency) {
      const batch = prs.slice(i, i + maxConcurrency)

      const results = await Promise.allSettled(
        batch.map(async (pr) => {
          log(`Reviewing ${pr.repo}#${pr.number}: ${pr.title}`)
          const output = await reviewPR(pr)
          log(`${pr.repo}#${pr.number} review complete:\n${output.slice(0, 500)}`)
        }),
      )

      for (let j = 0; j < results.length; j++) {
        const result = results[j]
        if (result.status === 'rejected') {
          log(`${batch[j].repo}#${batch[j].number} review failed: ${result.reason}`)
        }
      }
    }

    log('Review cycle complete')
  } finally {
    running = false
  }
}
