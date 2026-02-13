# Setup Instructions

## 1. Install code-sentinel plugin in Claude Code

1. Open Claude Code CLI:
   ```bash
   claude
   ```
2. Run the `/plugin` command
3. Navigate to **Marketplace**
4. Select **Add Marketplace**
5. Enter the URL:
   ```
   https://github.com/Hatkom-io/code-sentinel
   ```
6. Install the plugin
7. Reload the session (exit and reopen `claude`)

## 2. Configure the scheduler

Copy and edit the config with your repos:

```bash
cp config.json config.example.json   # optional: save the template
```

Edit `config.json` — set your repos. Use a string for simple repos, or an object with `path` to point Claude at a local checkout (so it picks up `CLAUDE.md` rules):

```json
{
  "repos": [
    { "repo": "your-org/repo1", "path": "/Users/you/projects/repo1" },
    "your-org/repo2"
  ],
  "intervalMinutes": 30,
  "workingHours": { "start": 9, "end": 19 },
  "workingDays": [1, 2, 3, 4, 5],
  "label": "ready for review",
  "reviewedLabel": "claude-reviewed"
}
```

## 3. Install as a background service

```bash
bun run install-service
```

This registers an OS-level daemon that auto-starts on login and restarts on crash.

## 4. Verify it's running

```bash
bun run logs
```

You should see log lines like:
```
[2026-02-13T...] Review bot starting
[2026-02-13T...] Repos: your-org/repo1, your-org/repo2
```

## Alternative: run manually (without installing as a service)

```bash
bun start
```

## Uninstall

```bash
bun run uninstall
```
