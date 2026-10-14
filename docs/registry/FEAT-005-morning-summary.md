# FEAT-005: Morning summary notification

| Field | Value |
|---|---|
| Type | Feature |
| Status | In testing |
| Priority | Medium |
| Created | 14/10/2026 |
| Updated | 14/10/2026 |
| Released in | — |

## Summary
Each morning at a time you choose (default 7:00 am), your iPhone shows a notification listing that day's events.

## Details
- iOS only. Built on the phone with local notifications (`expo-notifications`), scheduled 14 days ahead; no server.
- Turned on and off, and the time chosen, in Settings → Morning summary. Off until turned on; iOS asks for permission the first time.
- Lists your personal events and the family's shared ones for the day, timed ones first, up to 6 then "+N more". No notification on a day with nothing planned.
- Rescheduled when the app opens or returns to the foreground, when events change, and when the setting changes. Cancelled on sign-out and account deletion.
- Known limits: shared events a family member adds while your app is closed appear in the summary only after you next open the app; after 14 days with the app closed the summaries stop until it is opened.

## Links
- Design: [2026-10-14-morning-summary-design.md](../superpowers/specs/2026-10-14-morning-summary-design.md)
- Plan: [2026-10-14-feat-005-morning-summary.md](../superpowers/plans/2026-10-14-feat-005-morning-summary.md)
- PR: —
- Related: [FEAT-002](FEAT-002-accounts-family-sharing.md), [FEAT-003](FEAT-003-app-store-release.md)
