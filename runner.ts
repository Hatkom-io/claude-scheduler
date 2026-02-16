import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const resolveRepoRoot = () => {
  if (process.env.REVIEW_BOT_REPO_PATH) {
    return resolve(process.env.REVIEW_BOT_REPO_PATH)
  }
  return resolve(import.meta.dirname, '..')
}

export const repoRoot = resolveRepoRoot()

export const exec = (command: string, cwd?: string) => {
  return execSync(command, { cwd: cwd ?? repoRoot, encoding: 'utf-8' }).trim()
}

export type PullRequest = {
  number: number
  title: string
  labels: Array<{ name: string }>
}

export const loadPrompt = (commandFile: string) => {
  const path = resolve(repoRoot, '.claude/commands', commandFile)
  if (!existsSync(path)) {
    throw new Error(`${path} not found`)
  }
  return readFileSync(path, 'utf-8')
    .replace(/^---[\s\S]*?---\n*/m, '')
    .trim()
}

export const getPRs = (triggerLabel: string | null, doneLabel: string | string[]): PullRequest[] => {
  try {
    const labelFilter = triggerLabel ? ` --label "${triggerLabel}"` : ''
    const json = exec(
      `gh pr list${labelFilter} --json number,labels,title`,
    )
    const prs: PullRequest[] = JSON.parse(json)
    const doneLabels = Array.isArray(doneLabel) ? doneLabel : [doneLabel]

    return prs.filter((pr) => {
      const labels = pr.labels.map((label) => label.name)
      return !doneLabels.some((dl) => labels.includes(dl))
    })
  } catch (error) {
    console.error(`Failed to fetch PRs: ${(error as Error).message}`)
    return []
  }
}

const killGraceMs = 10 * 1000

export const spawnClaude = (opts: {
  prompt: string
  cwd: string
  prNumber: number
  timeoutMs: number
  label: string
}): Promise<string> => {
  const log = (msg: string) => {
    console.log(`[${new Date().toISOString()}] [${opts.label}] ${msg}`)
  }

  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--no-session-persistence',
      opts.prompt,
    ]

    log(`Spawning claude for PR #${opts.prNumber}`)

    const child = spawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const killTimer = setTimeout(() => {
      killed = true
      log(`PR #${opts.prNumber}: timed out after ${opts.timeoutMs / 60000}min, sending SIGTERM`)
      child.kill('SIGTERM')

      setTimeout(() => {
        if (!child.killed) {
          log(`PR #${opts.prNumber}: still alive after SIGTERM, sending SIGKILL`)
          child.kill('SIGKILL')
        }
      }, killGraceMs)
    }, opts.timeoutMs)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      clearTimeout(killTimer)

      if (killed) {
        reject(new Error(`claude timed out on PR #${opts.prNumber}`))
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

export const createWorktree = (prNumber: number, branch: string): string => {
  const worktreePath = join(tmpdir(), `review-bot-fix-${prNumber}-${Date.now()}`)

  exec(`git fetch origin ${branch}`)
  exec(`git worktree add ${worktreePath} origin/${branch}`)

  return worktreePath
}

export const removeWorktree = (worktreePath: string) => {
  try {
    exec(`git worktree remove ${worktreePath} --force`)
  } catch {
    try {
      rmSync(worktreePath, { recursive: true, force: true })
      exec('git worktree prune')
    } catch { /* best effort */ }
  }
}
