# Review Bot

Automated PR reviewer. Runs as a background daemon during working hours, picks up PRs labeled `ready for review` across multiple repos, and reviews each one using either a local `/pr-review` skill (if available in the project) or the [code-sentinel](https://github.com/Hatkom-io/code-sentinel) `/cs-pr-review` plugin.

## How it works

1. Every 30 minutes (during 9:00–19:00 Mon–Fri, local time), the daemon checks for open PRs with the `ready for review` label across all configured repos
2. PRs that already have the `claude-reviewed` label are skipped
3. For each eligible PR, it spawns `claude -p "<skill> <number> --repo <owner/repo>"`. If the repo has a local `path` with `.claude/commands/pr-review.md`, it uses `/pr-review`; otherwise falls back to `/cs-pr-review` (code-sentinel)
4. The review skill posts inline comments on GitHub and adds the `claude-reviewed` label when done
5. Outside working hours, the daemon sleeps until the next workday morning

## Prerequisites

- [Bun](https://bun.sh) (or Node.js 22+)
- [GitHub CLI](https://cli.github.com) authenticated (`gh auth login`)
- [Claude Code CLI](https://claude.ai/claude-code) authenticated
- [code-sentinel](https://github.com/Hatkom-io/code-sentinel) installed as a Claude Code plugin (unless all repos use a local `/pr-review` skill)

> Step-by-step setup guide: [INSTRUCTION.md](./INSTRUCTION.md)

## Configuration

Edit `config.json` in the scheduler directory:

```json
{
  "repos": [
    { "repo": "owner/repo1", "path": "/path/to/local/repo1" },
    "owner/repo2"
  ],
  "intervalMinutes": 30,
  "workingHours": { "start": 9, "end": 19 },
  "workingDays": [1, 2, 3, 4, 5],
  "label": "ready for review",
  "reviewedLabel": "claude-reviewed"
}
```

| Field | Description |
|-------|-------------|
| `repos` | GitHub repos — string `"owner/name"` (or full URL) or object `{ "repo": "...", "path": "/local/path" }` |
| `repos[].path` | Optional local project path. Claude runs with `cwd` here, picking up `CLAUDE.md` rules. If `.claude/commands/pr-review.md` exists at this path, the local `/pr-review` skill is used instead of `/cs-pr-review` |
| `intervalMinutes` | Check frequency during working hours |
| `workingHours` | Start/end hour (24h, local time) |
| `workingDays` | Days of week (0=Sun, 6=Sat) |
| `label` | PRs must have this label to be reviewed |
| `reviewedLabel` | Added after review to prevent re-review |

After changing config, restart the daemon:

```bash
bun run uninstall && bun run install-service
```

## Install

```bash
bun run install-service
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
bun run uninstall
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
bun run logs
```

## Run manually (without installing)

```bash
bun start
```

## Files

| File           | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `utils.ts`     | Shared types (`Config`, `RepoEntry`) and `log()`  |
| `config.json`  | Repo list, schedule, labels                      |
| `daemon.ts`    | Scheduler — interval timer with working-hours gate |
| `reviewer.ts`  | Core — fetches PRs via `gh`, spawns `claude` CLI |
| `install.ts`   | Registers OS-level autostart service             |
| `package.json` | Scripts and project metadata                     |
| `tsconfig.json`| Type checking config                             |
| `logs/`        | Created at install — stdout/stderr logs          |
| `daemon.pid`   | Lockfile — prevents duplicate instances           |
