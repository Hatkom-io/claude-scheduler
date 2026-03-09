---
name: pr-review
description: Review a PR (or current branch if no PR number given)
allowed-tools: Bash
---

Review PR #$ARGUMENTS (or current branch if no number provided).

If PR number given:

1. Get repo: `gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'`
2. `gh pr view $ARGUMENTS` — if not found, stop and report the error
3. `gh pr diff $ARGUMENTS`
4. Get commit SHA: `gh pr view $ARGUMENTS --json headRefOid --jq '.headRefOid'`
5. Review changes for issues
6. For each issue found, add a comment on GitHub using the `line` parameter:
   ```
   gh api repos/OWNER/REPO/pulls/$ARGUMENTS/comments \
     --method POST \
     -f body="**[SEVERITY]** description" \
     -f commit_id="COMMIT_SHA" \
     -f path="file/path.ts" \
     -F line=LINE_NUMBER \
     -f side="RIGHT"
   ```
   When the issue is a concrete code change on a specific line, include a suggestion block in the body:
   ````
   **[SEVERITY]** description
   ```suggestion
   corrected code here
   ```
   ````
   Use a plain comment for architectural issues, missing files, or anything that can't be expressed as a direct code replacement.
   CRITICAL: Use the actual file line number (from the modified file), NOT position in diff.
7. Add label: `gh pr edit $ARGUMENTS --add-label "claude-reviewed"`

If no PR number:

1. `git diff develop...HEAD`
2. `git log develop..HEAD --oneline`
3. Review changes (no GitHub comments for local-only review)

Output:

```
## Review: [APPROVE / REQUEST CHANGES]

### Issues
- file:line - issue (commented on GitHub if PR)

### Questions
- [anything unclear]
```
