import { loadPrompt, getPRs, spawnClaude, repoRoot } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [reviewer] ${msg}`)
}

const maxConcurrency = 5
const timeoutMs = 10 * 60 * 1000

let running = false

export const runReviewCycle = async () => {
  if (running) {
    log('Previous cycle still running, skipping')
    return
  }

  running = true

  try {
    const promptTemplate = loadPrompt('pr-review.md')

    log('Starting review cycle')
    const prs = getPRs('ready for review', 'claude-reviewed')

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
          const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(pr.number))
          const output = await spawnClaude({
            prompt,
            cwd: repoRoot,
            prNumber: pr.number,
            timeoutMs,
            label: 'reviewer',
          })
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
