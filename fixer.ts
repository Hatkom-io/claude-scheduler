import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveRepoRoot = () => {
  if (process.env.REVIEW_BOT_REPO_PATH) {
    const custom = resolve(process.env.REVIEW_BOT_REPO_PATH)
    if (!existsSync(custom)) {
      throw new Error(`REVIEW_BOT_REPO_PATH="${custom}" does not exist`)
    }
    return custom
  }
  return resolve(import.meta.dirname, '..')
}

const repoRoot = resolveRepoRoot()

const log = (message: string) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [fixer] ${message}`)
}

const exec = (command: string) => {
  return execSync(command, { cwd: repoRoot, encoding: 'utf-8' }).trim()
}

const getRepoInfo = (): { owner: string; name: string } => {
  const json = exec('gh repo view --json owner,name')
  const { owner, name } = JSON.parse(json)
  return { owner: owner.login, name }
}

type PullRequest = {
  number: number
  title: string
  labels: Array<{ name: string }>
}

type ReviewComment = {
  id: number
  path: string
  line: number | null
  original_line: number | null
  body: string
  user: { login: string }
  in_reply_to_id?: number
}

const getPendingFixPRs = (): PullRequest[] => {
  try {
    const json = exec(
      'gh pr list --label "claude-reviewed" --json number,labels,title',
    )
    const prs: PullRequest[] = JSON.parse(json)

    return prs.filter((pr) => {
      const labels = pr.labels.map((label) => label.name)
      return !labels.includes('locked')
    })
  } catch (error) {
    log(`Failed to fetch PRs: ${(error as Error).message}`)
    return []
  }
}

const getUnresolvedComments = (
  prNumber: number,
  owner: string,
  repo: string,
): ReviewComment[] => {
  try {
    const json = exec(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`,
    )
    const allComments: ReviewComment[] = JSON.parse(json)

    // Build a map of reply chains to find bot responses
    const botReplies = new Set<number>()
    for (const comment of allComments) {
      if (
        comment.in_reply_to_id &&
        (comment.body.includes('✅ Fixed') ||
          comment.body.includes('❌ Could not fix'))
      ) {
        botReplies.add(comment.in_reply_to_id)
      }
    }

    // Return top-level comments that don't have a bot reply yet
    return allComments.filter(
      (comment) => !comment.in_reply_to_id && !botReplies.has(comment.id),
    )
  } catch (error) {
    log(`Failed to fetch comments for PR #${prNumber}: ${(error as Error).message}`)
    return []
  }
}

const timeoutMs = 20 * 60 * 1000
const killGraceMs = 10 * 1000

type FixResult = {
  commentId: number
  fixed: boolean
}

const fixPR = (
  prNumber: number,
  comments: ReviewComment[],
): Promise<FixResult[]> => {
  const commentList = comments
    .map((c, i) => {
      const location = c.line
        ? `${c.path}:${c.line}`
        : c.original_line
          ? `${c.path}:${c.original_line} (outdated)`
          : c.path
      return `${i + 1}. [Comment ID: ${c.id}] ${location}\n   "${c.body}"`
    })
    .join('\n')

  const prompt = `You are a code fixer bot. A PR (#${prNumber}) has unresolved review comments that need fixing.

Here are the unresolved review comments:

${commentList}

Your task:
1. First, checkout the PR branch: run \`gh pr checkout ${prNumber}\`
2. For each comment, classify it:
   - ACTIONABLE: The comment requests a specific code change, fix, or improvement
   - NOT ACTIONABLE: The comment is a question, discussion point, praise, or general observation
3. For actionable comments, read the relevant files and apply the requested fixes
4. After applying ALL fixes, create a single commit with message "fix: address review comments" and push it

IMPORTANT: After you're done, you MUST output a JSON block with your results in exactly this format:
\`\`\`json
{"results": [{"commentId": <id>, "fixed": true/false}, ...]}
\`\`\`

Set "fixed" to true for comments you successfully fixed, and false for comments that are not actionable or that you could not fix.
Every comment ID from the list above must appear in your results.`

  return new Promise((resolve, reject) => {
    const args = [
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--no-session-persistence',
      prompt,
    ]

    log(`Spawning claude for PR #${prNumber} (${comments.length} comments, agentic mode)`)

    const env = { ...process.env }
    delete env.CLAUDECODE

    const child = spawn('claude', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const killTimer = setTimeout(() => {
      killed = true
      log(`PR #${prNumber}: fix timed out after ${timeoutMs / 60000}min, sending SIGTERM`)
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
        reject(new Error(`claude timed out fixing PR #${prNumber}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`))
        return
      }

      // Parse results from Claude's output
      const jsonMatch = stdout.match(/```json\s*\n?([\s\S]*?)\n?\s*```/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1])
          resolve(parsed.results as FixResult[])
          return
        } catch {
          log(`PR #${prNumber}: failed to parse results JSON`)
        }
      }

      // Fallback: mark all as unfixed if we can't parse results
      log(`PR #${prNumber}: no parseable results, marking all as unfixed`)
      resolve(comments.map((c) => ({ commentId: c.id, fixed: false })))
    })

    child.on('error', (error) => {
      clearTimeout(killTimer)
      reject(error)
    })
  })
}

const markComments = (
  prNumber: number,
  results: FixResult[],
  owner: string,
  repo: string,
) => {
  for (const result of results) {
    const body = result.fixed
      ? '✅ Fixed'
      : '❌ Could not fix automatically'

    try {
      exec(
        `gh api repos/${owner}/${repo}/pulls/${prNumber}/comments -f body='${body}' -F in_reply_to=${result.commentId}`,
      )
      log(`PR #${prNumber}: replied to comment ${result.commentId}: ${body}`)
    } catch (error) {
      log(
        `PR #${prNumber}: failed to reply to comment ${result.commentId}: ${(error as Error).message}`,
      )
    }
  }

}

let running = false

export const runFixCycle = async () => {
  if (running) {
    log('Previous fix cycle still running, skipping')
    return
  }

  running = true

  try {
    log('Starting fix cycle')

    const { owner, name: repo } = getRepoInfo()
    const prs = getPendingFixPRs()

    if (prs.length === 0) {
      log('No PRs pending fixes')
      return
    }

    log(
      `Found ${prs.length} PR(s) to fix: ${prs.map((pr) => `#${pr.number} "${pr.title}"`).join(', ')}`,
    )

    // Process PRs sequentially — each fixPR checks out a branch in the same repo
    for (const pr of prs) {
      const comments = getUnresolvedComments(pr.number, owner, repo)

      if (comments.length === 0) {
        log(`PR #${pr.number}: no unresolved comments, skipping`)
        continue
      }

      try {
        log(`PR #${pr.number}: ${comments.length} unresolved comment(s), fixing`)
        const fixResults = await fixPR(pr.number, comments)
        markComments(pr.number, fixResults, owner, repo)
        log(`PR #${pr.number}: fix complete`)
      } catch (error) {
        log(`PR #${pr.number} fix failed: ${(error as Error).message}`)
      }
    }

    log('Fix cycle complete')
  } finally {
    running = false
  }
}
