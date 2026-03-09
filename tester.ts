import { loadConfig, loadPrompt, getPRs, spawnClaude, exec, createWorktree, removeWorktree } from './runner.ts'
import type { RepoConfig } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [tester] ${msg}`)
}

const timeoutMs = 20 * 60 * 1000

let running = false

const testRepo = async (repo: RepoConfig) => {
  if (repo.unitTests === false) {
    log(`[${repo.url}] Skipping — unitTests disabled in config`)
    return
  }

  let promptTemplate: string
  try {
    promptTemplate = loadPrompt('pr-test.md', repo.path)
  } catch (error) {
    log(`[${repo.url}] Skipping — prompt not found: ${(error as Error).message}`)
    return
  }

  const prs = getPRs('Approved', [], repo)

  if (prs.length === 0) {
    log(`[${repo.url}] No approved PRs to test`)
    return
  }

  log(
    `[${repo.url}] Found ${prs.length} PR(s) to test: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
  )

  for (const pr of prs) {
    let worktreePath: string | undefined

    try {
      const branch = exec(
        `gh pr view ${pr.number} --repo "${repo.url}" --json headRefName --jq '.headRefName'`,
        repo.path,
      )
      worktreePath = createWorktree(pr.number, branch, repo.path)

      log(`[${repo.url}] Testing PR #${pr.number}: ${pr.title} (branch: ${branch})`)
      const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(pr.number))
      const output = await spawnClaude({
        prompt,
        cwd: worktreePath,
        prNumber: pr.number,
        timeoutMs,
        label: 'tester',
      })
      log(`[${repo.url}] PR #${pr.number} test complete:\n${output.slice(0, 500)}`)
    } catch (error) {
      log(`[${repo.url}] PR #${pr.number} test failed: ${(error as Error).message}`)
    } finally {
      if (worktreePath) removeWorktree(worktreePath, repo.path)
    }
  }
}

export const runTestCycle = async () => {
  if (running) {
    log('Previous test cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting test cycle')
    const config = loadConfig()

    for (const repo of config.repos) {
      try {
        await testRepo(repo)
      } catch (error) {
        log(`[${repo.url}] Unexpected error: ${(error as Error).message}`)
      }
    }

    log('Test cycle complete')
  } finally {
    running = false
  }
}
