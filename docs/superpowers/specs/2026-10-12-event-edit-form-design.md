# Event edit form — design (FEAT-004)

Date: 12/10/2026. Status: approved in conversation, awaiting written review.
Fixes on the way: BUG-004 (one occurrence too many), BUG-005 (editing an evening event moves it to another year).

## Intent

- **Said by the user:** tapping Edit should open a proper form where you can change how the event repeats (weekly, …), when it ends, its tags, and the other details, instead of the sentence going back into the input box.
- **Agreed:** the form is for editing only; the sentence box stays the way to add events. Every field of the event is editable. Dates show as dd/mm/yyyy, NZ time.
- **Success:** open any event, see every field filled in, change one, save, and only that change happens — on this phone and, for shared events, for the family.

## 1. The form

Edit (in Modify mode) opens a full-screen route `app/event/[id]/edit.tsx` with **Cancel** and **Save** in the header. Fields, filled in from the event:

| Field | Behaviour |
|---|---|
| Name | Text, required, at most 200 characters (same rule as today). |
| Date | Shown as dd/mm/yyyy; tapping opens the month calendar the app already uses (react-native-calendars). |
| Start / end time | Optional; shown as "6:00 pm"; native time picker (`@react-native-community/datetimepicker`, the version pinned for Expo SDK 54 — check the v54 docs before adding). Each has **Clear**. End needs a start and must be after it. |
| Repeat | Doesn't repeat / Daily / Weekly / Fortnightly / Monthly / Custom. Custom shows "Every [N] [days \| weeks \| months]", N 1–99. |
| Ends on | Shown only when repeating. Required; on or after the event's date; at most 1 year after it. dd/mm/yyyy, month calendar. |
| People | A chip per family member (photo or tag circle, the existing `MemberAvatar`); tap to toggle. Leftover tags (`@AZ`, `@GS` not yet mapped) show as removable chips. Members with no tag and former members stay on the event and show as chips too — nothing is dropped silently. |
| Shared with family | The existing `ShareToggle`, only when in a family; locked when you're not the creator of a shared event (as today). |

- Save is disabled until something changed. Validation messages appear under their field and stop Save.
- Cancel with unsaved changes asks "Discard changes?" (Keep editing / Discard), built into the screen.
- If the event disappears while the form is open (deleted elsewhere), the screen shows "This event was deleted." with a Back link.
- The sentence-edit flow in the planner (the "Editing: …" banner, putting `eventToSentence` back in the input, `planEdit`) is removed. With nothing re-parsed on save, BUG-005 is fixed; `eventToSentence`, `planEdit` and their BUG-005 pin tests are deleted if nothing else uses them.

## 2. Storing a repeat

- `RepeatRule = { every: number /* 1–99 */, unit: 'day' | 'week' | 'month', until: string /* 'yyyy-mm-dd', inclusive */ }`.
- Presets are shorthand: Daily = 1 day, Weekly = 1 week, Fortnightly = 2 weeks, Monthly = 1 month. Anything else is Custom.
- Monthly keeps the start's day of month, clamped to the month's last day (31 Jan → 28 Feb → 31 Mar).
- `until` is at most 1 year after the series' first date.
- **Database:** migration adds `repeat jsonb null` to `public.events`, with a check constraint: null, or an object with exactly `every` (integer 1–99), `unit` (one of the three) and `until` (a `yyyy-mm-dd` date). RLS is unchanged. Every occurrence of a series carries the same rule beside its `series_id`. The user pushes the migration to hosted (`npx supabase db push`, never `--include-seed`).
- **Phone and sync:** `EventRecord` gains `repeat?: RepeatRule`. `rows.ts` maps it both ways, the pull's column list includes it, and the stored-data check accepts it (old stored data without it stays valid).
- **One generator:** pure `occurrenceDates(start, rule): string[]` (date keys, including `start`, up to and including `until`). The sentence box converts its phrase to a rule and uses the same generator: "for N weeks/months" ends the day before the window closes, so `weekly for 4 weeks` makes 4 events. This fixes BUG-004; its pinned recurrence tests are updated.
- **Series without a rule** (made before this change): the form infers one once from the series' remaining dates — the smallest gap gives `every`/`unit` (a whole number of months on the same day counts as months), the last date gives `until`. A single remaining date shows "Doesn't repeat". Nothing is written until Save.

## 3. What Save does

Let *this* be the occurrence being edited, *later* the same series' occurrences with a later date, *earlier* those before it.

**A non-repeating event**
- Repeat left as "Doesn't repeat": update the event in place.
- Repeat chosen: update the event in place, giving it a new series id and the rule; create the later occurrences from `occurrenceDates`.

**An occurrence of a series** — Save asks **This event only / This and all future / Cancel**, unless Repeat or Ends on changed (then it's always this and all future, with no question).
- *This event only:* update *this* in place. If its date changed it leaves the series (series id and rule cleared).
- *This and all future*, Repeat and Ends on unchanged: update *this* and every *later* in place (ids kept). Name, times, people and sharing are set to the form's values; a date change moves each by the same number of days, moves their rule's `until` by the same amount, and trims *earlier* occurrences' `until` to the day before *this*'s original date (they are now a separate run).
- *Repeat or Ends on changed:* delete *this* and *later*; create new occurrences from the form's date with the new rule under a new series id; set *earlier* occurrences' rule `until` to the day before *this*'s original date. Choosing "Doesn't repeat" instead deletes *later*, updates *this* in place with series id and rule cleared, and trims *earlier* the same way.
- *Earlier* occurrences are otherwise never changed.

**Family rule:** only the event's creator can change Repeat or Ends on (re-creating occurrences would make the editor their owner). For anyone else those two fields are locked with "Only <name> can change how this repeats" (`memberLabel`). Everything else stays editable, for one occurrence or all future ones.

**Sync:** every save is ordinary creates, updates and deletes through the existing `EventsProvider`/sync engine — offline-first, synced on reconnect, live for family members, latest save wins.

## 4. Structure, errors, testing

**New**
- `lib/events/repeat.ts` (pure): `RepeatRule`, `isRepeatRule`, `occurrenceDates`, `inferRule`, preset ↔ rule mapping.
- `lib/events/editForm.ts` (pure): `formFromRecord(record, series, members)`, `validateForm(form)` → errors per field, `planFormSave(form, original, series, scope)` → `{ update: EventInput[]; create: EventInput[]; remove: string[] }`.
- `components/events/EventForm.tsx`: controlled form, no data access; contains the repeat picker, people picker and time fields.
- `app/event/[id]/edit.tsx`: route; reads `useEvents`/`useFamily`, asks the scope question, applies the plan via `updateEvent`, `addEvents`, `deleteEvents`.
- Migration `supabase/migrations/<timestamp>_event_repeat.sql`.

**Changed**
- `app/(tabs)/index.tsx`: Edit navigates to the route; sentence-edit state removed.
- `lib/events/rows.ts`, `pull.ts`, store check: the `repeat` field.
- `lib/parse/recurrence.ts` returns a rule; `lib/events/items.ts` uses `occurrenceDates`.
- Docs: `docs/specs/features.md` (Edit section; FEAT-004 under Planned), `docs/specs/architecture.md` (new files), new registry item FEAT-004 plus INDEX, BUG-004 and BUG-005 marked Done, CHANGELOG.

**Errors**
- The phone fails to store the change: "Couldn't save. Try again." — the form stays open with your edits.
- Validation errors block Save, shown under the field.
- Changes the server refuses use the existing refused-change handling.

**Testing (TDD)**
- `repeat.ts`: month-end clamping, `until` inclusive, 1-year limit, every unit, inference with gaps and with a single date.
- `planFormSave`: one case per rule in section 3, including the creator lock and the "Doesn't repeat" trim.
- RNTL: fields filled in, Save disabled until a change, the scope question, "Discard changes?", the lock message, the deleted-event screen.
- Recurrence tests updated for BUG-004.
- pgTAP: the check constraint accepts a valid rule and null, rejects bad shapes; existing RLS tests still pass.
- Sync integration: `repeat` round-trips through local Supabase.

## Out of scope
- A form for adding events; weekly-on-chosen-weekdays; editing past occurrences with "all events"; reminders.
