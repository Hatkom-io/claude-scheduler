import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveRepoRoot = () => {
  if (process.env.REVIEW_BOT_REPO_PATH) {
    const custom = resolve(process.env.REVIEW_BOT_REPO_PATH)
    if (!existsSync(resolve(custom, '.claude/commands/pr-review.md'))) {
      throw new Error(
        `REVIEW_BOT_REPO_PATH="${custom}" does not contain .claude/commands/pr-review.md`,
      )
    }
    return custom
  }
  return resolve(import.meta.dirname, '..')
}

const repoRoot = resolveRepoRoot()

const promptTemplate = readFileSync(
  resolve(repoRoot, '.claude/commands/pr-review.md'),
  'utf-8',
)
  .replace(/^---[\s\S]*?---\n*/m, '')
  .trim()

const log = (message: string) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

const exec = (command: string) => {
  return execSync(command, { cwd: repoRoot, encoding: 'utf-8' }).trim()
}

type PullRequest = {
  number: number
  title: string
  labels: Array<{ name: string }>
}

const getPendingPRs = (): PullRequest[] => {
  try {
    const json = exec(
      'gh pr list --label "ready for review" --json number,labels,title',
    )
    const prs: PullRequest[] = JSON.parse(json)

    return prs.filter((pr) => {
      const labels = pr.labels.map((label) => label.name)
      return !labels.includes('claude-reviewed')
    })
  } catch (error) {
    log(`Failed to fetch PRs: ${(error as Error).message}`)
    return []
  }
}

const maxConcurrency = 5
const timeoutMs = 10 * 60 * 1000
const killGraceMs = 10 * 1000

const reviewPR = (prNumber: number): Promise<string> => {
  const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(prNumber))

  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--no-session-persistence',
      prompt,
    ]

    log(`Spawning: claude ${args.slice(0, 3).join(' ')} ... (PR #${prNumber})`)

    const child = spawn('claude', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const killTimer = setTimeout(() => {
      killed = true
      log(`PR #${prNumber}: timed out after ${timeoutMs / 60000}min, sending SIGTERM`)
      child.kill('SIGTERM')

      setTimeout(() => {
        if (!child.killed) {
          log(`PR #${prNumber}: still alive after SIGTERM, sending SIGKILL`)
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
        reject(new Error(`claude timed out reviewing PR #${prNumber}`))
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

export const runReviewCycle = async () => {
  if (running) {
    log('Previous cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting review cycle')
    const prs = getPendingPRs()

    if (prs.length === 0) {
      log('No PRs pending review')
      return
    }

    log(
      `Found ${prs.length} PR(s) to review: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
    )

    for (let i = 0; i < prs.length; i += maxConcurrency) {
      const batch = prs.slice(i, i + maxConcurrency)

      const results = await Promise.allSettled(
        batch.map(async (pr) => {
          log(`Reviewing PR #${pr.number}: ${pr.title}`)
          const output = await reviewPR(pr.number)
          log(`PR #${pr.number} review complete:\n${output.slice(0, 500)}`)
        }),
      )

      for (let j = 0; j < results.length; j++) {
        const result = results[j]
        if (result.status === 'rejected') {
          log(`PR #${batch[j].number} review failed: ${result.reason}`)
        }
      }
    }

    log('Review cycle complete')
  } finally {
    running = false
  }
}
