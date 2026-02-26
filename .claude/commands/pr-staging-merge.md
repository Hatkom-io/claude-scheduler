---
name: pr-staging-merge
description: Merge a PR to the staging branch. Called automatically when a PR has the staging trigger label.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# PR Staging Merge

Merge PR #$ARGUMENTS to the `$STAGING_BRANCH` branch.

## Steps

1. **Get PR info**:
   ```bash
   gh pr view $ARGUMENTS --json headRefName,title,baseRefName,url
   ```
   Extract `headRefName` (source branch) and `title`.

2. **Check if a staging PR already exists**:
   ```bash
   gh pr list --base $STAGING_BRANCH --head {headRefName} --state open --json number,title
   ```
   If already merged — skip to step 6.
   If open — note its number and go to step 3.
   If none — create it:
   ```bash
   gh pr create \
     --base $STAGING_BRANCH \
     --head {headRefName} \
     --title "Staging: {title}" \
     --body "Auto-merge to staging from PR #$ARGUMENTS"
   ```

3. **Check mergeability** of the staging PR:
   ```bash
   gh pr view {staging_pr_number} --json mergeable,mergeStateStatus
   ```
   If status is `UNKNOWN`, wait 5 seconds and retry once.

4. **If conflicts** (`mergeable: CONFLICTING`) — resolve them on the feature branch:

   a. Create a worktree of the feature branch:
      ```bash
      git fetch origin $STAGING_BRANCH {headRefName}
      git worktree add /tmp/staging-merge-$ARGUMENTS origin/{headRefName}
      cd /tmp/staging-merge-$ARGUMENTS
      ```

   b. Merge staging into the feature branch to surface the conflicts:
      ```bash
      git merge origin/$STAGING_BRANCH --no-commit || true
      ```

   c. Identify conflicted files:
      ```bash
      git diff --name-only --diff-filter=U
      ```

   d. **Resolve each conflict**: open each conflicted file, understand both sides (`<<<<<<<`, `=======`, `>>>>>>>`), and produce the correct merged result. Preserve the intent of both sides where possible; prefer the feature branch changes when they are logically incompatible.

   e. Stage and commit:
      ```bash
      git add -A
      git commit -m "Resolve merge conflicts with $STAGING_BRANCH"
      ```

   f. **Run lint** to catch any errors introduced by the merge:
      ```bash
      cat package.json | grep -E '"lint"'
      ```
      Run the appropriate command (`bun run lint` / `npm run lint` / `yarn lint`).

   g. **If lint errors** — fix them, then commit:
      ```bash
      git add -A
      git commit -m "Fix lint errors after conflict resolution"
      ```

   h. Push back to the feature branch:
      ```bash
      git push origin HEAD:{headRefName}
      ```

   i. Clean up the worktree:
      ```bash
      git worktree remove /tmp/staging-merge-$ARGUMENTS --force
      ```

   j. Re-check mergeability (GitHub needs a moment to recompute):
      ```bash
      sleep 5
      gh pr view {staging_pr_number} --json mergeable,mergeStateStatus
      ```

5. **Merge the staging PR**:
   ```bash
   gh pr merge {staging_pr_number} --merge --no-delete-branch
   ```

6. **Add label** to the original PR #$ARGUMENTS:
   ```bash
   gh label create "claude-staging" --description "Merged to staging by Claude" --color "0075ca" --force
   gh pr edit $ARGUMENTS --add-label "claude-staging"
   ```

## Rules

- Never delete any branches (always use `--no-delete-branch`)
- Resolve conflicts on the feature branch — the staging PR stays untouched
- When resolving conflicts, preserve the intent of both sides — do not silently drop changes
- Fix only lint errors introduced by the merge — do not refactor surrounding code
- Always clean up the git worktree even if an error occurs

## Output

```
## Status
[MERGED / CONFLICTS_RESOLVED_AND_MERGED / ALREADY_MERGED]

## Details
[What happened: which files had conflicts, what lint errors were fixed, PR numbers involved]
```
