import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig, getPRs, spawnClaude } from './runner.ts'
import type { RepoConfig } from './runner.ts'

const log = (msg: string) => {
  console.log(`[${new Date().toISOString()}] [staging] ${msg}`)
}

const timeoutMs = 20 * 60 * 1000

let running = false

const loadStagingPrompt = (repoPath: string): string => {
  const repoPromptPath = resolve(repoPath, '.claude/commands', 'pr-staging-merge.md')
  const bundledPath = resolve(import.meta.dirname, '.claude/commands', 'pr-staging-merge.md')

  const path = existsSync(repoPromptPath) ? repoPromptPath : bundledPath

  if (!existsSync(path)) {
    throw new Error(`pr-staging-merge.md not found in ${repoPath} or bundled fallback`)
  }

  return readFileSync(path, 'utf-8')
    .replace(/^---[\s\S]*?---\n*/m, '')
    .trim()
}

const mergeRepoToStaging = async (repo: RepoConfig) => {
  const { stagingLabel, stagingBranch = 'staging' } = repo

  if (!stagingLabel) {
    log(`[${repo.url}] No stagingLabel configured, skipping`)
    return
  }

  let promptTemplate: string
  try {
    promptTemplate = loadStagingPrompt(repo.path)
  } catch (error) {
    log(`[${repo.url}] Skipping — prompt not found: ${(error as Error).message}`)
    return
  }

  const prs = getPRs(stagingLabel, 'claude-staging', repo)

  if (prs.length === 0) {
    log(`[${repo.url}] No PRs pending staging merge`)
    return
  }

  log(
    `[${repo.url}] Found ${prs.length} PR(s) to stage: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
  )

  for (const pr of prs) {
    try {
      log(`[${repo.url}] Staging PR #${pr.number}: ${pr.title}`)
      const prompt = promptTemplate
        .replaceAll('$ARGUMENTS', String(pr.number))
        .replaceAll('$STAGING_BRANCH', stagingBranch)

      const output = await spawnClaude({
        prompt,
        cwd: repo.path,
        prNumber: pr.number,
        timeoutMs,
        label: 'staging',
      })
      log(`[${repo.url}] PR #${pr.number} staging complete:\n${output.slice(0, 500)}`)
    } catch (error) {
      log(`[${repo.url}] PR #${pr.number} staging failed: ${(error as Error).message}`)
    }
  }
}

export const runStagingCycle = async () => {
  if (running) {
    log('Previous staging cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting staging cycle')
    const config = loadConfig()

    for (const repo of config.repos) {
      try {
        await mergeRepoToStaging(repo)
      } catch (error) {
        log(`[${repo.url}] Unexpected error: ${(error as Error).message}`)
      }
    }

    log('Staging cycle complete')
  } finally {
    running = false
  }
}
