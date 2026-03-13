# claude-scheduler

Automated PR reviewer, fixer, and unit test writer. Runs as a background daemon during working hours, picks up PRs across multiple repositories, reviews them with Claude, fixes unresolved review comments, and writes unit tests for approved PRs.

## How it works

1. Every 30 minutes (during 9:00–19:00 Mon–Fri, local time), the daemon checks all configured repositories
2. **Reviewer** — finds PRs labeled `ready for review` (without `claude-reviewed`) and posts inline review comments via Claude
3. **Fixer** — finds PRs with unresolved review comments and applies fixes via Claude in an isolated git worktree
4. **Tester** — finds PRs labeled `Approved` and writes unit tests via Claude, publishing them as a separate PR targeting the original branch
5. Outside working hours, the daemon sleeps until the next workday morning

## Prerequisites

- [Bun](https://bun.sh) (or Node.js 22+)
- [GitHub CLI](https://cli.github.com) authenticated (`gh auth login`)
- [Claude Code CLI](https://claude.ai/claude-code) authenticated

## Setup

### 1. Configure repositories

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "repos": [
    {
      "url": "owner/repo-name",
      "path": "/absolute/path/to/repo-name"
    },
    {
      "url": "owner/another-repo",
      "path": "/absolute/path/to/another-repo"
    }
  ]
}
```

Each repo needs:
- `url` — GitHub repo in `owner/repo` format
- `path` — absolute path to the local clone

Each repo must have `.claude/commands/pr-review.md`, `.claude/commands/pr-fix.md`, and `.claude/commands/pr-test.md` prompt files.

### 2. Install dependencies

```bash
bun install
```

### 3. Install the daemon

```bash
bun run install:service
```

This registers a background service that auto-starts on login:

| OS      | Mechanism       | Service name          |
| ------- | --------------- | --------------------- |
| macOS   | launchd         | `com.sfs.review-bot`  |
| Linux   | systemd (user)  | `sfs-review-bot`      |
| Windows | Task Scheduler  | `SFS-ReviewBot`       |

## Uninstall

```bash
bun run uninstall:service
```

## Available commands

| Command | Description |
| --- | --- |
| `bun start` | Run the daemon manually (without installing a service) |
| `bun run install:service` | Install as a system service |
| `bun run uninstall:service` | Remove the system service |
| `bun run logs` | Tail stdout logs |
| `bun run logs:err` | Tail stderr logs |

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
bun run logs
```

## Configuration

Edit the `config` object at the top of `daemon.ts` to adjust the schedule:

```typescript
const config = {
  intervalMinutes: 30,
  workingHours: { start: 9, end: 19 },
  workingDays: [1, 2, 3, 4, 5], // 0=Sun, 6=Sat
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}
```

After changing, restart the daemon:

```bash
bun run uninstall:service && bun run install:service
```

## Files

| File                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `config.json`         | Repository list (created from `config.example.json`) |
| `config.example.json` | Template for `config.json`                           |
| `daemon.ts`           | Scheduler — interval timer with working-hours gate   |
| `reviewer.ts`         | Fetches PRs via `gh`, spawns Claude for review       |
| `fixer.ts`            | Fetches PRs with comments, applies fixes via Claude  |
| `tester.ts`           | Fetches approved PRs, writes unit tests via Claude   |
| `runner.ts`           | Shared utilities — config, git, Claude, GitHub       |
| `install.ts`          | Registers OS-level autostart service                 |
| `package.json`        | Dev dependencies and convenience scripts             |
| `logs/`               | Created at install — stdout/stderr logs              |
| `daemon.pid`          | Lockfile — prevents duplicate instances              |
