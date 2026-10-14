# CHG-004: Extract parsers into `lib/` with tests

| Field | Value |
|---|---|
| Type | Change |
| Status | In progress |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 07/10/2026 |
| Released in | — |

## Summary
FEAT-002 phase A. Move date, parsing, and storage-shape logic out of `app/(tabs)/index.tsx` into `lib/`, add Jest, and make `tsc --noEmit` pass. No behaviour change.

## Details
- [x] Jest + jest-expo, NZ timezone in tests
- [x] `lib/dates.ts`, `lib/parse/*`, `lib/events/*` with tests
- [x] `index.tsx` uses them; `npm run typecheck` reports 0 errors

## Links
- Plan: [plan 1](../superpowers/plans/2026-10-06-feat-002-plan-1-parser-extraction.md)
- Related: FEAT-002, BUG-003, BUG-004
