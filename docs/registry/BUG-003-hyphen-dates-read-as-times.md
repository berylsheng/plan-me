# BUG-003: Hyphenated dates are read as time ranges

| Field | Value |
|---|---|
| Type | Bug |
| Status | Proposed |
| Priority | Medium |
| Created | 06/10/2026 |
| Updated | 06/10/2026 |
| Released in | — |

## Summary
`preprocessInput` treats any `N-N` as a time range, so day-month dates written with a hyphen become times.

## Details
- Steps: select 8 October, type `12-10 party`, press Add.
- Expected: "party" on 12 October (or a prompt asking what was meant).
- Actual: "party" from 12:00 to 22:00 on 8 October. `10-06` becomes `10am-06pm`.
- Pinned by `lib/parse/__tests__/preprocess.test.ts` ("BUG-003 current behaviour"). Update those cases when fixing.

## Links
- Related: CHG-004
