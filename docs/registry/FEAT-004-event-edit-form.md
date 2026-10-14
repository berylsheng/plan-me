# FEAT-004: Event edit form

| Field | Value |
|---|---|
| Type | Feature |
| Status | In testing |
| Priority | High |
| Created | 12/10/2026 |
| Updated | 13/10/2026 |
| Released in | — |

## Summary
Edit opens a full-screen form for every field of an event, including how it repeats and when it ends, for one occurrence or this and all future ones.

## Details
Acceptance criteria:
- [ ] Edit event: name, date (dd/mm/yyyy), start and end time (or all-day), repeat (Doesn't repeat, Daily, Weekly, Fortnightly, Monthly or every N days/weeks/months), ending on a date at most a year on (series made before this limit can still be edited as they are), people tags, and sharing
- [ ] For a non-repeating event, Save closes the form
- [ ] For a repeating event with later events, Save opens a dialog asking "This event only" or "This and all future" (the last event of a series just changes that event)
- [ ] Edit on Supabase: new `repeat` column on the events table, schema and RLS intact
- [ ] Editing the repeat rule or end date always changes this and all future events (can't edit just one)
- [ ] A "this and all future" edit that moves the date makes the moved events a separate series from the earlier ones
- [ ] Only the creator of a shared event can edit the repeat rule
- [ ] Form validates date within a year, end time after start time, end date at most a year on
- [ ] Components pass TypeScript, ESLint, and unit tests

## Release
Run `npx supabase db push` on the hosted project before installing this build on any phone.

## Links
- Design: [2026-10-12-event-edit-form-design.md](../superpowers/specs/2026-10-12-event-edit-form-design.md)
- Plan: [2026-10-13-feat-004-edit-form.md](../superpowers/plans/2026-10-13-feat-004-edit-form.md)
- PR: —
- Fixes: [BUG-004](BUG-004-recurrence-extra-occurrence.md), [BUG-005](BUG-005-evening-edit-moves-event.md)
- Related: [FEAT-001](FEAT-001-natural-language-planner.md), [FEAT-002](FEAT-002-accounts-family-sharing.md)
