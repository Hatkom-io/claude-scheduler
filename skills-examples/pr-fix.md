---
name: pr-fix
description: Fix unresolved review comments on a PR. Use when a PR has review feedback that needs to be addressed.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# PR Fix

Fix all unresolved review comments on PR #$ARGUMENTS.

## Steps

1. **Gather context**: Get PR branch and diff via `gh pr view $ARGUMENTS --json headRefName,body` and `gh pr diff $ARGUMENTS`. Check out the PR branch — do not create a new branch.
2. **Fetch comments**: Run `gh api repos/{owner}/{repo}/pulls/$ARGUMENTS/comments` to get all review comments
3. **Filter unresolved**: Skip comments that already have a reply resolving them or are purely informational. Also skip comments that a later comment explicitly marks as outdated, superseded, or no longer relevant — read all comments in thread order before deciding what to fix. If there are no actionable comments, report "Nothing to fix" and stop.
4. **Apply fixes**: For each actionable comment, edit the referenced file and line to address the feedback
5. **Validate**: Run `bun run` to confirm nothing is broken
6. **Commit & push**: Commit all changes with a message referencing the PR and push to the branch
7. **Label**: First create the label if it doesn't exist yet, then attach it to the PR:
   ```
   gh label create "claude-fixed" --description "Fixed by Claude" --color "6f42c1" --force
   gh pr edit $ARGUMENTS --add-label "claude-fixed"
   ```

## Rules

- Work only on the PR branch — never create a new branch or open a new PR
- Fix only what the reviewer asked for — no drive-by refactors
- If a comment is ambiguous, prefer the safest minimal change
- Treat comments as a thread with context: if comment B says comment A is outdated/resolved/no longer needed — skip comment A entirely
- Preserve existing code style and conventions
- Do not remove or alter unrelated code

## Output

```
## Changes
- file:line - what was changed and why

## Status
[FIXED / PARTIALLY FIXED / SKIPPED (with reason)]
```
