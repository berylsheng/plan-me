# BUG-005: Editing an evening event moves it to another year

| Field | Value |
|---|---|
| Type | Bug |
| Status | Done |
| Priority | High |
| Created | 07/10/2026 |
| Updated | 13/10/2026 |
| Released in | — |

## Summary
`eventToSentence` writes a 22-hour start as `12 October, 22:00-…`, and chrono-node reads `October, 22` as the year 2022, so re-parsing the sentence moves the event to a different year with a garbled name and no time.

## Details
- Steps: add `12 October, 10-11:30pm, late` → Modify → Edit → Save.
- Expected: event unchanged (still 12/10/2026, 22:00–23:30, "late").
- Actual: moves to 12/10/2022 with no time and a garbled name (`:00-23:30, late`). Starts at 20, 21, or 23 similarly move to 2020, 2021, or 2023. Crossing midnight (`22:00-01:00`) also breaks: the event moves to 2022 with startTime `13:00` and name `:00am-, late`.
- Hour range affected: start hour 20–23 (any time where the hour digits match a plausible two-digit year when combined with the month name). 00:30–19:00 and `10pm`-style sentences are unaffected.
- Pinned by `lib/events/__tests__/items.test.ts` ("BUG-005 current behaviour"). Update those cases when fixing.
- Fixed in FEAT-004: editing uses a form, so nothing is re-parsed.

## Links
- Related: CHG-004, [FEAT-004](FEAT-004-event-edit-form.md)
