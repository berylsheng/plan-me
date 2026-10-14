# FEAT-002: Accounts and family sharing

| Field | Value |
|---|---|
| Type | Feature |
| Status | In testing |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 12/10/2026 |
| Released in | — |

## Summary
Email/password accounts on Supabase, and families joined by invite code. Each event is personal or shared, and every family member can view and edit shared events. Data syncs across devices and works offline.

## Details
Acceptance criteria:
- [ ] Sign up, confirm email, sign in, reset password, sign out
- [ ] Create a family; join one with an invite code; leave it; the owner can remove members and regenerate the code
- [ ] New events are personal by default; can be toggled to shared
- [ ] Family members see, edit, and delete shared events, and never see personal ones
- [ ] Only the creator can make a shared event personal
- [ ] Shared events show the creator; changes appear live on other devices
- [ ] Offline edits sync on reconnect; the latest save wins
- [ ] Existing on-device events upload once to the account
- [ ] `@tag` refers to family members; old `@AZ`/`@GS` are mapped once
- [ ] Account deletion inside the app
- [x] pgTAP tests cover every access rule
- [ ] Jest covers parsers and sync

## Links
- Design: [2026-10-06-accounts-family-sharing-design.md](../superpowers/specs/2026-10-06-accounts-family-sharing-design.md)
- PRs:
- Related: FEAT-003 (App Store requires in-app account deletion)
