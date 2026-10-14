# FEAT-001: Natural-language planner (v1 single device)

| Field | Value |
|---|---|
| Type | Feature |
| Status | Done |
| Priority | — |
| Created | 05/06/2026 (backfilled 06/10/2026) |
| Updated | 06/10/2026 |
| Released in | — (built, not yet on the App Store; ships with FEAT-003) |

## Summary
The current single-device app: type an event as a sentence and it lands on the calendar. Data is stored on the device only. This item is backfilled to record what v1 contains. It runs on dev builds but has never been released.

## Details
- chrono-node date/time parsing with shorthand range expansion (`2-5pm`, `11-4`).
- Recurrence (`weekly for 4 months`, `every 2 weeks for 6 months`), expanded into separate events linked by `occurrenceId`.
- `@AZ` / `@GS` person tags with avatars.
- Week strip, month picker, Today / Week / All views; past events dimmed; NZ timezone.
- Modify mode: edit (round-trips the event back into a sentence) and delete (single or this-and-future).
- AsyncStorage persistence with migration of older data shapes.

## Links
- Spec: [features.md](../specs/features.md#built-v100-single-device--not-yet-released)
- Commits: `9542f51`, `f866c2f`, `d63bc05`
