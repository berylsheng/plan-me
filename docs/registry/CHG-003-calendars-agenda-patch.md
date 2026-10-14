# CHG-003: Review the unused react-native-calendars Agenda patch

| Field | Value |
|---|---|
| Type | Change |
| Status | Proposed |
| Priority | Low |
| Created | 06/10/2026 |
| Updated | 06/10/2026 |
| Released in | — |

## Summary
`patches/react-native-calendars+1.1314.0.patch` fixes `Agenda` and `ReservationList`, but the app now only imports `Calendar`. If Agenda really is unused, remove the patch to make library upgrades easier.

## Details
- [ ] Confirm nothing imports `Agenda`
- [ ] Remove the patch (and `patch-package` if nothing else needs it)

## Links
- Related:
