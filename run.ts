#!/usr/bin/env bun

import { resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { execSync } from 'node:child_process'

const repo = process.argv[2]
const localPath = process.argv[3]
const mode = process.argv[4] || 'all'

if (!repo || !localPath) {
  console.error('Usage: bun run.ts <owner/repo> <local-path> [review|fix|all]')
  console.error('')
  console.error('Examples:')
  console.error('  bun run.ts owner/repo ~/projects/repo')
  console.error('  bun run.ts owner/repo ~/projects/repo review')
  console.error('  bun run.ts owner/repo ~/projects/repo fix')
  process.exit(1)
}

const resolved = resolve(localPath)

// Clone if local path doesn't exist
if (!existsSync(resolved)) {
  console.log(`Cloning ${repo} into ${resolved}...`)
  execSync(`gh repo clone ${repo} ${resolved}`, { stdio: 'inherit' })
}

// Ensure .claude/commands/pr-review.md exists
const prReviewPath = resolve(resolved, '.claude/commands/pr-review.md')
if (!existsSync(prReviewPath)) {
  mkdirSync(dirname(prReviewPath), { recursive: true })
  writeFileSync(prReviewPath, `---
description: Review a PR and post comments on GitHub
---

Review PR #$ARGUMENTS on this repository.

## Instructions

1. Run \`gh pr diff $ARGUMENTS\` to get the full diff
2. Analyze each changed file for:
   - **Bugs**: Logic errors, race conditions, null pointer issues, off-by-one errors
   - **Security**: XSS, injection, exposed secrets, unsafe patterns (dangerouslySetInnerHTML, console.log with sensitive data)
   - **Performance**: Memory leaks, missing cleanup, unnecessary re-renders, removed debounce/throttle
   - **Best practices**: Missing error handling, loose equality (== vs ===), removed confirmations, type safety issues
3. Post inline comments on specific lines using \`gh api\` for each issue found
4. Add the \`claude-reviewed\` label when done

## Posting comments

Use this format to post a review with inline comments:

\`\`\`bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER/reviews \\
  -f event="COMMENT" \\
  -f body="Review complete" \\
  -f 'comments[][path]=file.ts' \\
  -f 'comments[][line]=42' \\
  -f 'comments[][body]=Description of the issue'
\`\`\`

Get the repo owner/name from \`gh repo view --json owner,name\`.

Be specific and actionable in your comments. Explain what's wrong and suggest a fix.
`)
  console.log('Created .claude/commands/pr-review.md')
}

process.env.REVIEW_BOT_REPO_PATH = resolved

const { runReviewCycle } = await import('./reviewer.ts')
const { runFixCycle } = await import('./fixer.ts')

console.log(`\nRepo: ${repo}`)
console.log(`Path: ${resolved}`)
console.log(`Mode: ${mode}\n`)

if (mode === 'review' || mode === 'all') {
  await runReviewCycle()
}

if (mode === 'fix' || mode === 'all') {
  await runFixCycle()
}
