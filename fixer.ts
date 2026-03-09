import { loadConfig, loadPrompt, getPRs, spawnClaude, exec, createWorktree, removeWorktree } from './runner.ts'
import type { RepoConfig } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [fixer] ${msg}`)
}

const timeoutMs = 20 * 60 * 1000

let running = false

const fixRepo = async (repo: RepoConfig) => {
  if (repo.prFix === false) {
    log(`[${repo.url}] Skipping — prFix disabled in config`)
    return
  }

  let promptTemplate: string
  try {
    promptTemplate = loadPrompt('pr-fix.md', repo.path)
  } catch (error) {
    log(`[${repo.url}] Skipping — prompt not found: ${(error as Error).message}`)
    return
  }

  const prs = getPRs(null, ['claude-fixed', 'claude fixed', 'Ready for approval', 'approved'], repo)

  if (prs.length === 0) {
    log(`[${repo.url}] No PRs pending fixes`)
    return
  }

  log(
    `[${repo.url}] Found ${prs.length} PR(s) to fix: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
  )

  for (const pr of prs) {
    let worktreePath: string | undefined

    try {
      const branch = exec(
        `gh pr view ${pr.number} --repo "${repo.url}" --json headRefName --jq '.headRefName'`,
        repo.path,
      )
      worktreePath = createWorktree(pr.number, branch, repo.path)

      log(`[${repo.url}] Fixing PR #${pr.number}: ${pr.title} (branch: ${branch})`)
      const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(pr.number))
      const output = await spawnClaude({
        prompt,
        cwd: worktreePath,
        prNumber: pr.number,
        timeoutMs,
        label: 'fixer',
      })
      log(`[${repo.url}] PR #${pr.number} fix complete:\n${output.slice(0, 500)}`)
    } catch (error) {
      log(`[${repo.url}] PR #${pr.number} fix failed: ${(error as Error).message}`)
    } finally {
      if (worktreePath) removeWorktree(worktreePath, repo.path)
    }
  }
}

export const runFixCycle = async () => {
  if (running) {
    log('Previous fix cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting fix cycle')
    const config = loadConfig()

    for (const repo of config.repos) {
      try {
        await fixRepo(repo)
      } catch (error) {
        log(`[${repo.url}] Unexpected error: ${(error as Error).message}`)
      }
    }

    log('Fix cycle complete')
  } finally {
    running = false
  }
}
