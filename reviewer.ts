import { loadConfig, loadPrompt, getPRs, spawnClaude } from './runner.ts'
import type { RepoConfig } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [reviewer] ${msg}`)
}

const maxConcurrency = 5
const timeoutMs = 10 * 60 * 1000

let running = false

const reviewRepo = async (repo: RepoConfig) => {
  if (repo.prReview === false) {
    log(`[${repo.url}] Skipping — prReview disabled in config`)
    return
  }

  let promptTemplate: string
  try {
    promptTemplate = loadPrompt('pr-review.md', repo.path)
  } catch (error) {
    log(`[${repo.url}] Skipping — prompt not found: ${(error as Error).message}`)
    return
  }

  const prs = getPRs('ready for review', 'claude-reviewed', repo)

  if (prs.length === 0) {
    log(`[${repo.url}] No PRs pending review`)
    return
  }

  log(
    `[${repo.url}] Found ${prs.length} PR(s): ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
  )

  for (let i = 0; i < prs.length; i += maxConcurrency) {
    const batch = prs.slice(i, i + maxConcurrency)

    const results = await Promise.allSettled(
      batch.map(async (pr) => {
        log(`[${repo.url}] Reviewing PR #${pr.number}: ${pr.title}`)
        const prompt = promptTemplate.replaceAll('$ARGUMENTS', String(pr.number))
        const output = await spawnClaude({
          prompt,
          cwd: repo.path,
          prNumber: pr.number,
          timeoutMs,
          label: 'reviewer',
        })
        log(`[${repo.url}] PR #${pr.number} review complete:\n${output.slice(0, 500)}`)
      }),
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'rejected') {
        log(`[${repo.url}] PR #${batch[j].number} review failed: ${result.reason}`)
      }
    }
  }
}

export const runReviewCycle = async () => {
  if (running) {
    log('Previous cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting review cycle')
    const config = loadConfig()

    await Promise.allSettled(
      config.repos.map(async (repo) => {
        try {
          await reviewRepo(repo)
        } catch (error) {
          log(`[${repo.url}] Unexpected error: ${(error as Error).message}`)
        }
      }),
    )

    log('Review cycle complete')
  } finally {
    running = false
  }
}
