# Review Bot

Automated PR reviewer. Runs as a background daemon during working hours, picks up PRs labeled `ready for review`, and runs the Claude Code `pr-review` command against each one.

## How it works

1. Every 30 minutes (during 9:00–19:00 Mon–Fri, local time), the daemon checks for open PRs with the `ready for review` label
2. PRs that already have the `claude-reviewed` label are skipped
3. For each eligible PR, it spawns `claude --print` with the `pr-review` prompt
4. The review command posts inline comments on GitHub and adds the `claude-reviewed` label when done
5. Outside working hours, the daemon sleeps until the next workday morning

## Prerequisites

- [Bun](https://bun.sh) (or Node.js 22+)
- [GitHub CLI](https://cli.github.com) authenticated (`gh auth login`)
- [Claude Code CLI](https://claude.ai/claude-code) authenticated

## Install

```bash
bun review-bot/install.ts
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
bun review-bot/install.ts --uninstall
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
tail -f review-bot/logs/stdout.log
```

## Run manually (without installing)

```bash
bun review-bot/daemon.ts
```

## Files

| File           | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `daemon.ts`    | Scheduler — interval timer with working-hours gate |
| `reviewer.ts`  | Core — fetches PRs via `gh`, spawns `claude` CLI |
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
bun review-bot/install.ts --uninstall && bun review-bot/install.ts
```

## Custom repo path

By default the bot assumes it lives inside the monorepo (`review-bot/` at repo root). To point it at a different clone:

```bash
REVIEW_BOT_REPO_PATH=/path/to/sfs-monorepo bun review-bot/install.ts
```

The env var is baked into the service definition, so it persists across restarts.
# claude-scheduler
