# How to set up Claude Scheduler

Step-by-step guide to get the scheduler running autonomously — reviewing PRs and fixing comments without any manual intervention.

## 1. Install dependencies

```bash
cd claude-scheduler
bun install
```

## 2. Make sure CLI tools are authenticated

```bash
# GitHub CLI
gh auth status
# If not authenticated:
gh auth login

# Claude Code CLI
claude --version
# If not authenticated, follow https://claude.ai/claude-code
```

## 3. Prepare your target repository

The scheduler needs a local clone of the repo it will monitor.

```bash
gh repo clone owner/repo ~/projects/repo
```

### Create labels in the repo

The scheduler uses GitHub labels to track state. Create them once:

```bash
cd ~/projects/repo
gh label create "ready for review" --color 0E8A16 --description "Triggers Claude review"
gh label create "claude-reviewed" --color 5319E7 --description "Reviewed by Claude"
gh label create "locked" --color D93F0B --description "Blocks auto-fix"
```

### Add the review prompt

The reviewer reads its prompt from `.claude/commands/pr-review.md` inside the target repo. If the repo doesn't have one, `run.ts` creates a default one automatically. To customize it, create the file manually:

```bash
mkdir -p ~/projects/repo/.claude/commands
```

Write your own `pr-review.md` — use `$ARGUMENTS` as placeholder for the PR number.

## 4. Choose how to run

### Option A: One-shot (test first)

Run a single review+fix cycle to verify everything works:

```bash
cd claude-scheduler
bun run.ts owner/repo ~/projects/repo
```

Check the output — you should see the review cycle find PRs (if any have the `ready for review` label) and the fix cycle process comments.

### Option B: Background daemon

Start the daemon that runs continuously during working hours:

```bash
cd claude-scheduler
REVIEW_BOT_REPO_PATH=~/projects/repo bun daemon.ts
```

The daemon will:
- Run review cycle every 30 minutes (9:00-19:00, Mon-Fri)
- Run fix cycle 15 minutes after each review
- Sleep outside working hours
- Prevent duplicate instances via lockfile

### Option C: Install as OS service (auto-start on login)

```bash
cd claude-scheduler
REVIEW_BOT_REPO_PATH=~/projects/repo bun install.ts
```

This creates a system service that:
- Starts automatically on login
- Restarts if it crashes
- Logs to `claude-scheduler/logs/stdout.log`

To check it's running:

```bash
# macOS
launchctl print gui/$(id -u)/com.sfs.review-bot

# Linux
systemctl --user status sfs-review-bot

# Any OS
tail -f logs/stdout.log
```

To stop and remove:

```bash
bun install.ts --uninstall
```

## 5. Workflow

Once the scheduler is running, the workflow for your team is:

1. Developer creates a PR
2. Developer (or CI) adds the `ready for review` label
3. Scheduler picks it up, reviews it, posts inline comments, adds `claude-reviewed`
4. Scheduler automatically monitors for unresolved comments and fixes them
5. If someone leaves new comments — the next fix cycle picks them up
6. To block auto-fix on a specific PR — add the `locked` label

## 6. Configuration

Edit `daemon.ts` to change schedule:

```typescript
const config = {
  intervalMinutes: 30,        // how often to check
  workingHours: { start: 9, end: 19 },  // local time
  workingDays: [1, 2, 3, 4, 5],         // Mon-Fri
}
```

## Troubleshooting

**"Another instance is already running"**
The daemon uses a lockfile (`daemon.pid`). If a previous instance crashed without cleanup:
```bash
rm daemon.pid
```

**"Cannot find .claude/commands/pr-review.md"**
The reviewer needs this file in the target repo. Use `run.ts` which creates it automatically, or create it manually (see step 3).

**"claude exited with code 1: nested session"**
This happens when running inside an existing Claude Code session. The scheduler already handles this by unsetting the `CLAUDECODE` env var, but if you see it, make sure you're running the latest version.

**No PRs found**
Check that:
- The PR has the `ready for review` label
- The PR doesn't already have `claude-reviewed` (for review cycle)
- The PR doesn't have `locked` (for fix cycle)
- `gh pr list` works in the target repo directory
