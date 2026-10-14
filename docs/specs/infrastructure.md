# Infrastructure

Last updated: 06/10/2026

## 1. Current (v1.0.0, unreleased)

- No backend. All data stays on the device (AsyncStorage).
- Run locally with `npx expo start`; native builds with `expo run:ios` / `expo run:android`.
- Source: `github.com/berylsheng/plan-me`. No CI.
- `patch-package` applies `patches/` on `npm install`.

## 2. Target (FEAT-002, FEAT-003)

### 2.1 Services

| Service | Use | Plan / cost |
|---|---|---|
| Supabase (`ap-southeast-2`, Sydney) | Auth, Postgres, Realtime, Storage (avatars) | Free tier; Pro ~US$25/month if needed |
| Expo EAS | Cloud iOS builds, App Store submission, OTA updates | Free tier |
| Apple Developer Program | App Store, TestFlight, signing | US$99/year |
| SMTP provider (Resend or Brevo) | Auth emails in prod | Free tier |
| GitHub Actions | CI, keep-alive job | Free |
| Sentry (optional) | Crash reporting | Free tier |

Licences: PostgreSQL (PostgreSQL License) and Supabase (Apache 2.0) are open source and free for commercial use.

### 2.2 Environments

| | Dev | Prod |
|---|---|---|
| Supabase project | `plan-me-dev` | `plan-me-prod` |
| EAS build profiles | `development`, `preview` | `production` |
| EAS Update channel | `development`, `preview` | `production` |
| Data | Test accounts only | Real users |
| Email | Supabase built-in (rate-limited) | Custom SMTP |

Phone testing uses the hosted `plan-me-dev` project (see [hosted setup](../guides/supabase-hosted-setup.md)); local email links point at 127.0.0.1, which a phone can't open.

Local development runs a local Supabase via the Supabase CLI (`supabase start`, which needs Docker Desktop).

### 2.3 Database as code

- `supabase/migrations/*.sql`: schema, RLS policies, triggers, RPC functions. Never edit prod by hand in the dashboard.
- `supabase/tests/database/*.test.sql`: pgTAP tests for every access rule; helpers in `supabase/seed.sql` (local only). Run with `npm run db:reset && npm run db:test`.
- Deploy: `supabase db push` to dev, check it, then push to prod.
- Storage: the private `avatars` bucket and its access policies are created by migration `20261012120000_avatars.sql`; no dashboard setup.

### 2.4 App identity

- iOS bundle ID / Android package: `com.berylsheng.planme` (replaces `com.anonymous.planme`). **It can't be changed after the first App Store release.**
- URL scheme: `planme://` (used by password-reset and email-confirm links).

### 2.5 Configuration and secrets

| Name | Where | Secret? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | EAS env vars per environment; `.env.local` for local dev | No |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same | No — data is protected by RLS (Supabase now calls it the publishable key) |
| `SUPABASE_SECRET_KEY (service role)` | GitHub Actions secrets only | **Yes — never in the app** |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions secrets | Yes |
| SMTP credentials | Supabase dashboard (prod) | Yes |

`.env.local` is gitignored.

### 2.6 CI (GitHub Actions)

- On every PR: `npm ci`, `expo lint`, `tsc --noEmit`, Jest, then `supabase start` (database, auth, REST, Realtime, Storage, Mailpit) + `supabase test db` + `npm run test:integration`.
- Weekly cron: a lightweight query against prod, so the free-tier project isn't paused for inactivity. Remove it if you upgrade to Pro.
- Production releases: the manual **Release** workflow (`.github/workflows/release.yml`) re-runs these checks, waits for approval in the `production` environment, pushes migrations to `plan-me-prod`, then builds and submits the iOS app to TestFlight (CHG-005).

### 2.7 Release flow

1. Optional device check: `eas build --profile preview` (internal distribution, installed straight onto registered iPhones; not TestFlight).
2. Merge to `main` → Actions → **Release** → approve → migrations to prod, production build, upload to TestFlight.
3. Test in TestFlight → submit for review in App Store Connect → release.
4. JS-only fixes: `eas update --channel production` (no review needed), once `expo-updates` is set up (release guide, step 10b). Anything native (new package, permission, `app.json` native config) needs a new build.

Details: [App Store release guide](../guides/app-store-release.md).
