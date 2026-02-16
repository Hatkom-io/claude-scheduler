# Claude Scheduler

Automated PR reviewer and fixer. Runs as a background daemon during working hours, reviews PRs with Claude Code CLI, posts inline comments, and automatically fixes them.

## How it works

### Review cycle
1. Every 30 minutes (during 9:00-19:00 Mon-Fri, local time), the daemon checks for open PRs with the `ready for review` label
2. PRs that already have the `claude-reviewed` label are skipped
3. For each eligible PR, it spawns `claude --print` with the `pr-review` prompt
4. The review command posts inline comments on GitHub and adds the `claude-reviewed` label when done
5. Outside working hours, the daemon sleeps until the next workday morning

### Fix cycle
15 minutes after each review cycle, the daemon runs a fix cycle:

1. Finds open PRs with the `claude-reviewed` label (PRs with `locked` label are skipped)
2. For each PR, fetches unresolved review comments (those without a bot reply)
3. If no unresolved comments — skips the PR
4. Spawns Claude in agentic mode (no `--print`) to checkout the branch, classify each comment, apply fixes, commit, and push
5. Replies on each comment: "Fixed" or "Could not fix automatically"
6. Keeps monitoring every cycle — new comments on reviewed PRs get fixed automatically

**To prevent fixes:** Add the `locked` label to the PR.

## Labels

| Label | Purpose |
| --- | --- |
| `ready for review` | Triggers the review cycle |
| `claude-reviewed` | Added after review; fixer monitors these PRs |
| `locked` | Blocks auto-fix for a PR |

> **Quick start:** See [INSTRUCTION.md](INSTRUCTION.md) for a step-by-step setup guide.

## Prerequisites

- [Bun](https://bun.sh) (or Node.js 22+)
- [GitHub CLI](https://cli.github.com) authenticated (`gh auth login`)
- [Claude Code CLI](https://claude.ai/claude-code) authenticated

## Install as background service

```bash
bun install.ts
```

This registers a background service that auto-starts on login:

| OS      | Mechanism       | Service name          |
| ------- | --------------- | --------------------- |
| macOS   | launchd         | `com.sfs.review-bot`  |
| Linux   | systemd (user)  | `sfs-review-bot`      |
| Windows | Task Scheduler  | `SFS-ReviewBot`       |

The daemon starts immediately after install.

## Uninstall

```bash
bun install.ts --uninstall
```

## Check if running

**macOS:**

```bash
launchctl print gui/$(id -u)/com.sfs.review-bot
```

**Linux:**

```bash
systemctl --user status sfs-review-bot
```

**Windows:**

```powershell
schtasks /query /tn "SFS-ReviewBot"
```

**Any OS — check the logs:**

```bash
tail -f logs/stdout.log
```

## Run manually

### Daemon mode (continuous, working-hours only)

```bash
bun daemon.ts
```

### One-shot against any repo

```bash
bun run.ts <owner/repo> <local-path> [review|fix|all]
```

Examples:

```bash
# Full cycle: review + fix
bun run.ts owner/repo ~/projects/repo

# Only review
bun run.ts owner/repo ~/projects/repo review

# Only fix
bun run.ts owner/repo ~/projects/repo fix
```

If the local path doesn't exist, the repo will be cloned automatically.

## Files

| File           | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `daemon.ts`    | Scheduler — interval timer with working-hours gate |
| `reviewer.ts`  | Review cycle — fetches PRs via `gh`, spawns `claude --print` |
| `fixer.ts`     | Fix cycle — fixes review comments via `claude` in agentic mode |
| `run.ts`       | CLI runner — one-shot review/fix against any repo |
| `install.ts`   | Registers OS-level autostart service             |
| `tsconfig.json`| Type checking config                             |
| `logs/`        | Created at install — stdout/stderr logs          |
| `daemon.pid`   | Lockfile — prevents duplicate instances           |

## Configuration

Edit the `config` object at the top of `daemon.ts`:

```typescript
const config = {
  intervalMinutes: 30,
  workingHours: { start: 9, end: 19 },
  workingDays: [1, 2, 3, 4, 5], // 0=Sun, 6=Sat
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}
```

After changing config, restart the daemon:

```bash
bun install.ts --uninstall && bun install.ts
```

## Custom repo path

By default the daemon operates on whichever repo it lives inside. To point it at a different repo:

```bash
REVIEW_BOT_REPO_PATH=/path/to/repo bun install.ts
```

The env var is baked into the service definition, so it persists across restarts.
