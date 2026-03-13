---
name: unit-test
description: Unit test writer — analyzes a diff and writes unit tests for what changed, or explains why a unit test is not possible
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, AskUserQuestion, mcp__typescript__*, mcp__ide__getDiagnostics
---

# Unit Test Writer

Write **unit tests only**. A unit test runs in-process with no real I/O — no database, no network, no filesystem, no external services. Dependencies are mocked or injected.

If a change cannot be covered by a unit test, state why and stop. Never write integration, E2E, or any other test type — not even as a suggestion.

`$ARGUMENTS` — PR number, branch name, commit SHA, or empty (current branch vs default).

---

## Step 0: Check for Existing Unit-Tests PR

> Only when `$ARGUMENTS` is a PR number.

Read the original PR description and look for: `Unit-tests PR [#<number>](<url>)`

- **Found** — get the diff (Step 1), fetch the test branch, check what's already covered. If new testable changes exist → update tests on that branch, push, stop. If fully covered → output `Tests are up to date. No changes needed.` and stop.
- **Not found** — proceed to Step 1.

---

## Step 1: Get the Diff

Get the diff for `$ARGUMENTS`. If no testable code changes are found, output `No testable code changes detected.` and stop.

---

## Step 2: Assess and Write Tests

Use **Bun** as the test runner. Follow existing test file conventions.

For each changed unit, determine if it can be tested in isolation with mocked dependencies. If it requires real I/O or external services and cannot be mocked — state why and stop for that unit. Do not write a test that touches real infrastructure.

If ALL units are untestable, stop entirely.

For testable units:

- Add to an existing test file if one exists, otherwise create one following project conventions
- **Hardcode expected values** — never derive them using the same logic as the production code
- **Use `it.each`** for parameterized cases

Run the tests. If they fail, fix once and re-run. If still failing, report the error and leave the file as-is.

Verify zero TypeScript errors after tests pass.

---

## Step 3: Publish as a PR

Get the original branch name via `gh pr view $ARGUMENTS --json headRefName` — do not use `git rev-parse --abbrev-ref HEAD` as HEAD may be detached in the current worktree.

Ensure the label exists: `gh label create "unit-tests" --color "0075ca" --force`

Commit the test files to a new branch named `unit-tests/<original-branch>`, push it, and open a PR targeting the original PR's branch (not main) with:

- **Title**: `test: unit tests for <original PR title> (PR #<number>)` — always include both the title and number of the original PR
- **Body**: `Unit tests for #<number> — <original PR url>` — no other text, no "Generated with Claude Code"
- **Label**: `unit-tests`

Then append to the original PR's description:

```
---
Unit-tests PR [#<number>](<url>)

**Testing summary**
<one-paragraph summary of what was tested and why — which modules/functions were covered, what scenarios were validated, and what was explicitly skipped and why>

**Test plan**
- [ ] <scenario 1 — e.g. returns correct value when input is valid>
- [ ] <scenario 2 — e.g. throws when required field is missing>
- [ ] <scenario 3 — e.g. handles edge case X correctly>
```
