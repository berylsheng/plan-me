# CHG-005: Prepare the app for the App Store, and a release pipeline

| Field | Value |
|---|---|
| Type | Change |
| Status | In progress |
| Priority | High |
| Created | 14/10/2026 |
| Updated | 14/10/2026 |
| Released in | — |

## Summary
The code side of FEAT-003: final app identity, store-ready `app.json`, EAS build profiles, and a manual GitHub Actions pipeline that pushes migrations to `plan-me-prod` and builds and submits the iOS app to TestFlight.

## Details
- [x] `app.json`: name "Plan-Me", bundle ID and Android package `com.berylsheng.planme` (CHG-002), iPhone only (`supportsTablet: false`), `usesNonExemptEncryption: false`, microphone/speech permissions removed (BUG-001), notifications signed for production (`expo-notifications` mode `production`). Pinned by `__tests__/app-config.test.ts`.
- [x] `expo` ~54.0.37 and `expo-constants` ~18.0.14 (the versions SDK 54 expects).
- [x] A build without its Supabase settings shows "Plan-Me can't start" with the missing names instead of crashing.
- [x] `eas.json` with development, preview and production profiles (`appVersionSource: remote`, `autoIncrement`).
- [x] `.github/workflows/release.yml`: manual, main only; CI checks → approval in the `production` environment → `supabase db push` to prod → `eas build` → `eas submit` to TestFlight.
- [x] Linked to the EAS project (`eas init`: owner `yueyinsq`), and `expo-updates` set up for over-the-air fixes (`runtimeVersion` fingerprint policy).
- [x] App Store Connect app created; its Apple ID (6823371977) is `submit.production.ios.ascAppId` in `eas.json`.
- [ ] First real run, once the Apple Developer account, Expo account, `plan-me-prod` and the secrets exist (see the release guide, "Release pipeline").

## Links
- Guide: [app-store-release.md](../guides/app-store-release.md)
- PR: —
- Related: FEAT-003, CHG-002, BUG-001
