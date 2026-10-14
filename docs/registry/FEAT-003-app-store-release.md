# FEAT-003: Apple App Store release

| Field | Value |
|---|---|
| Type | Feature |
| Status | In progress |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 14/10/2026 |
| Released in | — |

## Summary
Make Plan-Me downloadable from the Apple App Store, built and submitted with EAS from Windows.

## Details
Follow the [release guide](../guides/app-store-release.md). Blocked by BUG-001, BUG-002, CHG-002, and (for the account features) FEAT-002.

- Unblocked by FEAT-002 Plan 6: in-app account deletion and settings are built; App Privacy answers are in the release guide.
- CHG-005 did the code side (app identity, `app.json`, `eas.json`, release pipeline). What's left is accounts, the prod Supabase project, the icon, the legal pages and the store listing — all owner steps in the guide.

## Links
- Guide: [app-store-release.md](../guides/app-store-release.md)
- Related: FEAT-002, BUG-001, BUG-002, CHG-002, CHG-005
