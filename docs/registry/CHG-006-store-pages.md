# CHG-006: Privacy policy and support pages

| Field | Value |
|---|---|
| Type | Change |
| Status | In progress |
| Priority | High |
| Created | 16/10/2026 |
| Updated | 16/10/2026 |
| Released in | — |

## Summary
The two public pages Apple requires for the App Store listing, published with GitHub Pages from `site/`.

## Details
- [x] `site/privacy/`: what the app stores (account, profile, family, events, on-phone data), what it doesn't, who can see it, the services used (Supabase in Sydney, an email delivery service, Expo for updates, Apple), retention, account deletion (shared events stay as "Former member"), NZ Privacy Act 2020 rights. Contact berylsheng@gmail.com.
- [x] `site/support/`: contact and common questions.
- [x] `.github/workflows/pages.yml` publishes `site/` on changes to `main`.
- [x] Pages switched on (Source: GitHub Actions).
- [ ] Both URLs entered in App Store Connect.
- [x] Store listing text drafted: `docs/store/app-store-listing.md`.

## Links
- Privacy policy: https://berylsheng.github.io/plan-me/privacy/
- Support: https://berylsheng.github.io/plan-me/support/
- Related: FEAT-003, CHG-005
