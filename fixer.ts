import { loadPrompt, getPRs, spawnClaude, exec, createWorktree, removeWorktree } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [fixer] ${msg}`)
}

const timeoutMs = 20 * 60 * 1000

let running = false

export const runFixCycle = async () => {
  if (running) {
    log('Previous fix cycle still running, skipping')
    return
  }

  running = true

  try {
    const promptTemplate = loadPrompt('pr-fix.md')

    log('Starting fix cycle')
    const prs = getPRs('fix-requested', 'claude-fixed')

    if (prs.length === 0) {
      log('No PRs pending fixes')
      return
    }

    log(
      `Found ${prs.length} PR(s) to fix: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
    )

    for (const pr of prs) {
      let worktreePath: string | undefined

      try {
        const branch = exec(
          `gh pr view ${pr.number} --json headRefName --jq '.headRefName'`,
        )
        worktreePath = createWorktree(pr.number, branch)

        log(`Fixing PR #${pr.number}: ${pr.title} (branch: ${branch})`)
        const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(pr.number))
        const output = await spawnClaude({
          prompt,
          cwd: worktreePath,
          prNumber: pr.number,
          timeoutMs,
          label: 'fixer',
        })
        log(`PR #${pr.number} fix complete:\n${output.slice(0, 500)}`)
      } catch (error) {
        log(`PR #${pr.number} fix failed: ${(error as Error).message}`)
      } finally {
        if (worktreePath) removeWorktree(worktreePath)
      }
    }

    log('Fix cycle complete')
  } finally {
    running = false
  }
}
