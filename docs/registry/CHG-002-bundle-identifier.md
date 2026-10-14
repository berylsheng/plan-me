# CHG-002: Replace `com.anonymous.planme` bundle ID

| Field | Value |
|---|---|
| Type | Change |
| Status | In progress |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 14/10/2026 |
| Released in | — |

## Summary
`android.package` is `com.anonymous.planme` (the Expo default) and `ios.bundleIdentifier` isn't set. Set both to `com.berylsheng.planme` before the first App Store build; it can't be changed after release.

## Details
- [x] Confirm the final ID with the owner (confirmed 06/10/2026)
- [x] Set `ios.bundleIdentifier` and `android.package` in `app.json` (CHG-005)
- [ ] Register the ID in the Apple Developer portal (EAS does this on the first build)

## Links
- Related: FEAT-003
