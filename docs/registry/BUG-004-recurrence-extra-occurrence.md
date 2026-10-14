# BUG-004: Recurring events get one occurrence too many

| Field | Value |
|---|---|
| Type | Bug |
| Status | Done |
| Priority | Medium |
| Created | 06/10/2026 |
| Updated | 13/10/2026 |
| Released in | — |

## Summary
`generateDates` counts the duration from the start date and the start date is added on top, so every recurrence creates one extra event.

## Details
- Steps: type `swim, 13 October 7am, weekly for 4 weeks`.
- Expected: 4 swims (13, 20, 27 Oct, 3 Nov). Decided that "for 4 weeks" means a 4-week window from the first date.
- Actual: 5 swims (adds 10 Nov). `monthly for 3 months` gives 4 events; `every 2 weeks for 2 months` gives 5.
- Pinned by `lib/parse/__tests__/recurrence.test.ts`. Update those cases when fixing.
- Fixed in FEAT-004: `for 4 weeks` means a 4-week window from the first date, so `weekly for 4 weeks` makes 4 events.

## Links
- Related: CHG-004, [FEAT-004](FEAT-004-event-edit-form.md)
