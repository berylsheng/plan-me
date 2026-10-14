# BUG-002: Expo template placeholder screens still in the app

| Field | Value |
|---|---|
| Type | Bug |
| Status | Done |
| Priority | High |
| Created | 06/10/2026 |
| Updated | 12/10/2026 |
| Released in | — |

## Summary
The Explore tab and `modal.tsx` are still the create-expo-app sample content ("This app includes example code…"). Apple rejects apps containing placeholder content (Guidelines 2.1 / 4.2).

## Details
- Steps: open the app → tap the **Explore** tab.
- Expected: no template content.
- Actual: Expo's sample screen with react-logo images.
- Fix: remove `app/(tabs)/explore.tsx`, `app/modal.tsx`, the unused template components and images, and `scripts/reset-project.js`. FEAT-002 replaces the tab with **Family**.
- Fixed in FEAT-002 Plan 6: Explore became Family (Plan 5); modal, template components, images and reset script removed.

## Links
- Related: FEAT-003, FEAT-002
