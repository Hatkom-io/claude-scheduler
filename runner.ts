import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Config ──────────────────────────────────────────────────────────────────

export type RepoConfig = {
  url: string
  path: string
}

export type Config = {
  repos: RepoConfig[]
}

const configPath = resolve(import.meta.dirname, 'config.json')

export const loadConfig = (): Config => {
  if (!existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}\n` +
      `Copy config.example.json to config.json and fill in your repositories.`,
    )
  }

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read config.json: ${(error as Error).message}`)
  }

  let config: Config
  try {
    config = JSON.parse(raw) as Config
  } catch (error) {
    throw new Error(`config.json is not valid JSON: ${(error as Error).message}`)
  }

  if (!Array.isArray(config.repos) || config.repos.length === 0) {
    throw new Error('config.json must contain a non-empty "repos" array')
  }

  for (const repo of config.repos) {
    if (!repo.url || typeof repo.url !== 'string') {
      throw new Error(`Each repo in config.json must have a "url" field (e.g. "owner/repo")`)
    }
    if (!repo.path || typeof repo.path !== 'string') {
      throw new Error(`Each repo in config.json must have a "path" field (absolute path)`)
    }
    if (!existsSync(repo.path)) {
      throw new Error(`Repo path does not exist: ${repo.path} (for ${repo.url})`)
    }
  }

  return config
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export const exec = (command: string, cwd: string) => {
  return execSync(command, { cwd, encoding: 'utf-8' }).trim()
}

// ─── Pull Requests ───────────────────────────────────────────────────────────

export type PullRequest = {
  number: number
  title: string
  labels: Array<{ name: string }>
}

export const getPRs = (
  triggerLabel: string | null,
  doneLabel: string | string[],
  repo: RepoConfig,
): PullRequest[] => {
  try {
    const labelFilter = triggerLabel ? ` --label "${triggerLabel}"` : ''
    const json = exec(
      `gh pr list --repo "${repo.url}"${labelFilter} --json number,labels,title`,
      repo.path,
    )
    const prs: PullRequest[] = JSON.parse(json)
    const doneLabels = Array.isArray(doneLabel) ? doneLabel : [doneLabel]

    return prs.filter((pr) => {
      const labels = pr.labels.map((label) => label.name)
      return !doneLabels.some((dl) => labels.includes(dl))
    })
  } catch (error) {
    console.error(`Failed to fetch PRs for ${repo.url}: ${(error as Error).message}`)
    return []
  }
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

export const loadPrompt = (commandFile: string, repoPath: string) => {
  const path = resolve(repoPath, '.claude/commands', commandFile)
  if (!existsSync(path)) {
    throw new Error(`Prompt not found: ${path}`)
  }
  return readFileSync(path, 'utf-8')
    .replace(/^---[\s\S]*?---\n*/m, '')
    .trim()
}

// ─── Claude ──────────────────────────────────────────────────────────────────

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

    child.on('close', (code: number | null) => {
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

// ─── Git Worktrees ───────────────────────────────────────────────────────────

export const createWorktree = (prNumber: number, branch: string, repoPath: string): string => {
  const worktreePath = join(tmpdir(), `review-bot-fix-${prNumber}-${Date.now()}`)

  exec(`git fetch origin ${branch}`, repoPath)
  exec(`git worktree add ${worktreePath} origin/${branch}`, repoPath)

  return worktreePath
}

export const removeWorktree = (worktreePath: string, repoPath: string) => {
  try {
    exec(`git worktree remove ${worktreePath} --force`, repoPath)
  } catch {
    try {
      rmSync(worktreePath, { recursive: true, force: true })
      exec('git worktree prune', repoPath)
    } catch { /* best effort */ }
  }
}
