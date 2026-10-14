# Registry — how it works

Every new feature, bug, and change to Plan-Me gets one markdown file here. The registry is versioned with the code, so the history of *why* something changed sits next to the change.

## Types and IDs

| Prefix | Use for | Example |
|---|---|---|
| `FEAT-NNN` | New user-facing capability | FEAT-002 Accounts and family sharing |
| `BUG-NNN` | Something that behaves wrongly | BUG-001 Duplicate RECORD_AUDIO permission |
| `CHG-NNN` | Change with no new capability: refactor, config, dependency, infra, docs | CHG-002 Bundle ID |

Numbers are sequential per type and never reused. File name: `<ID>-<short-slug>.md`.

## Status

`Proposed` → `Approved` → `In progress` → `Done` (shipped in a release), or `Won't do`.
Bugs can also be `Can't reproduce`.

## Workflow

1. **Create:** copy the template below into a new file, take the next free ID, and add a row to [INDEX.md](INDEX.md).
2. **Work:** put the ID in the branch name (`feat-002-accounts`) and in the PR title (`FEAT-002: Add sign-in screens`).
3. **Update:** keep `Status` and `Updated` current, and add PR links under **Links**.
4. **Ship:** set `Done`, fill in `Released in`, and add a line to [CHANGELOG.md](../../CHANGELOG.md) under that version.

## Template

```markdown
# <ID>: <Title>

| Field | Value |
|---|---|
| Type | Feature / Bug / Change |
| Status | Proposed |
| Priority | High / Medium / Low |
| Created | dd/mm/yyyy |
| Updated | dd/mm/yyyy |
| Released in | — |

## Summary
What and why, in two or three sentences.

## Details
Feature/Change: scope and acceptance criteria.
Bug: steps to reproduce, expected result, actual result, device/OS/app version.

## Links
- Design / spec:
- PRs:
- Related:
```
