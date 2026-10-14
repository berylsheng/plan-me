# App Store release — step by step (FEAT-003)

Goal: Plan-Me downloadable from the Apple App Store. You're on Windows, so every iOS build runs in the cloud on **EAS Build**; you don't need a Mac. You need an iPhone for testing.

Steps marked 💰 cost money. Steps marked ⏳ involve waiting on Apple.

## Phase 1 — Accounts (≈1–2 days, mostly waiting)

1. **Apple ID with two-factor authentication** turned on.
2. 💰⏳ **Enrol in the Apple Developer Program** at developer.apple.com/programs (US$99/year).
   - Enrol as an **Individual** unless you have a company with a D-U-N-S number. Your legal name appears as the seller.
   - Approval usually takes 24–48 h.
3. **Create an Expo account** at expo.dev, then on your PC:
   ```bash
   npm install -g eas-cli
   eas login
   eas init
   ```
   `eas init` links the project and adds `extra.eas.projectId` (and `owner`) to `app.json`. **Commit that change to `main`**: every non-interactive build, including the release pipeline, needs it.

## Phase 2 — Make the app submittable (code changes)

Steps 4–7 and 10 are done in the code (CHG-005); check them off. Step 8 (the icon) and the demo account in step 9 are still yours.

4. **Set the app identity** in `app.json` (CHG-002):
   - `expo.name`: "Plan-Me" (the name under the icon)
   - `ios.bundleIdentifier` and `android.package`: `com.berylsheng.planme`. **This is permanent once released.**
   - `version`: `1.0.0`; build numbers are handled by EAS (`autoIncrement`).
   Done (CHG-005): name "Plan-Me", `com.berylsheng.planme` for both, `version` 1.0.0, iPhone only (`supportsTablet: false`, so no iPad screenshots).
5. **Remove template leftovers** (BUG-002): done in FEAT-002 Plan 6 (the Explore tab became Family; `modal.tsx`, the react-logo images and `scripts/reset-project.js` are gone). Apple rejects placeholder content (Guideline 2.1 / 4.2).
6. **Permissions** (BUG-001): delete the microphone and speech-recognition `infoPlist` entries until voice input exists. Apple rejects permission requests the app doesn't use. Done (CHG-005).
7. **Encryption declaration:** add `ios.config.usesNonExemptEncryption: false`, which avoids a compliance question on every build. Done (CHG-005). The app uses HTTPS and encrypts the sign-in session on the phone (AES, to protect the user's own data); both are normally exempt. Confirm the answer once against the export-compliance questions in App Store Connect before the first submission.
   - Notifications: `expo-notifications` adds the push entitlement whenever it's installed; it's set to `production` so App Store builds sign correctly. The app only uses local notifications (FEAT-005).
8. **App icon:** a 1024×1024 px PNG with no transparency and no rounded corners. Replace the placeholder `assets/images/icon.png`. The splash screen should match.
9. **Account rules** (needed once FEAT-002 ships):
   - Account deletion must be possible **inside the app** (Guideline 5.1.1(v)). Built in FEAT-002 Plan 6: **Settings → Delete account**. Say so in the review notes.
   - Photo library permission text (set by the `expo-image-picker` plugin in `app.json`): "Plan-Me uses your photos so you can choose a profile picture." The app doesn't use the camera or microphone.
   - Provide a **demo account** for the reviewer, ideally already in a family with shared events.
10. **Create `eas.json`** (done, CHG-005):
    ```json
    {
      "cli": { "appVersionSource": "remote" },
      "build": {
        "development": { "developmentClient": true, "distribution": "internal", "channel": "development", "environment": "development" },
        "preview": { "distribution": "internal", "channel": "preview", "environment": "preview" },
        "production": { "autoIncrement": true, "channel": "production", "environment": "production" }
      },
      "submit": { "production": { "ios": {} } }
    }
    ```
    Set the Supabase URL and publishable key for the production environment (from the `plan-me-prod` dashboard → Project Settings → API Keys). The publishable key is safe in the app; never use the secret key:
    ```bash
    eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<prod-ref>.supabase.co --visibility plaintext
    eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_... --visibility plaintext
    ```
    A build without them opens on "Plan-Me can't start" and lists what's missing; the release pipeline also stops before building if they aren't set.
10b. **Over-the-air fixes (do before the first store build):** `eas update` only reaches builds that include `expo-updates`. Install and configure it (needs `eas init` first), then commit:
    ```bash
    npx expo install expo-updates
    eas update:configure
    ```
    This adds `updates.url` and `runtimeVersion` to `app.json`. Without it, every fix needs a new build and App Review. Done (CHG-005): `expo-updates` ~29.0.20 with `runtimeVersion: { "policy": "fingerprint" }`, so an update only reaches builds whose native code matches it. `expo-updates` does nothing in Expo Go; it works in EAS builds.

## Phase 3 — Publish the legal pages (≈half a day)

11. **Privacy policy URL** (required). It must say what you collect (email, display name, avatar, events), where it's stored (Supabase, Sydney), that it isn't sold or used for tracking, and how to delete it. Host it anywhere public, e.g. GitHub Pages from this repo.
12. **Support URL** (required): a page with a way to contact you.

## Phase 4 — Create the App Store listing

13. In **App Store Connect** → Apps → **+ New App**: platform iOS, name "Plan-Me" (must be unique on the store; have a fallback ready, such as "Plan-Me Family Planner"), primary language English (NZ or UK), bundle ID `com.berylsheng.planme`, SKU `planme-ios`.
14. **App Privacy** questionnaire ("nutrition label"): Contact Info → Email and Name (app functionality, linked to the user); User Content → Photos (profile photo) and Other (events), both app functionality, linked to the user; Identifiers → User ID. Tracking: **No**.
15. **Age rating** questionnaire, which will most likely come out as 4+.
16. **Pricing and availability:** free; choose your countries (start with NZ and Australia, or all).

## Phase 5 — Build and test on TestFlight

After the first time, use the release pipeline below instead of steps 17–18.

17. Build in the cloud:
    ```bash
    eas build --platform ios --profile production
    ```
    The first time, EAS asks to sign in to your Apple account and creates the certificates and provisioning profile for you. Say yes.
18. Upload it to App Store Connect:
    ```bash
    eas submit --platform ios --latest
    ```
19. ⏳ Processing takes 10–30 min. Then in **TestFlight**, add yourself and family as **internal testers** (up to 100, no review needed). Install the TestFlight app on the iPhone and accept the invite.
20. Run the two-device checklist from the [design spec](../superpowers/specs/2026-10-06-accounts-family-sharing-design.md#8-testing) on real phones. Fix, rebuild, repeat.

## Phase 6 — Store assets

21. **Screenshots:** at least one set for the 6.9" iPhone (1320×2868 px), 3–10 images. Take them on a large-screen iPhone or a simulator via a cloud Mac. If `supportsTablet` stays `true` you also need iPad 13" screenshots, so set it to `false` unless you want iPad.
22. **Text:** subtitle (≤30 chars), description, keywords (≤100 chars, comma-separated), promotional text, copyright ("2026 Beryl Sheng").

## Phase 7 — Submit for review

23. On the version page: select the TestFlight build, fill in **App Review Information** (demo account email and password, contact phone, notes such as "Create or join a family from the Family tab; invite code for the demo family is XXXX"), and choose manual or automatic release.
24. ⏳ **Submit for Review.** Typically 24–48 h.
25. If rejected: read the message in Resolution Center, fix it, rebuild (step 17), and reply or resubmit. Common reasons for this app: placeholder content, unused permissions, missing account deletion, no working demo login.
26. When approved: **Release**. It goes live on the store within a few hours.

## Phase 8 — After release

27. **Bug fixes that are JS only:** `eas update --channel production --message "…"`. Users get them on next launch, with no review needed. Needs step 10b.
28. **Native changes** (new native package, permission, icon, `app.json` native config): bump `version` and repeat steps 17–26.
29. Record each release in `CHANGELOG.md` and close the related registry items.
30. Renew the Apple Developer membership every year, or the app is removed from the store.

## Release pipeline

`.github/workflows/release.yml` does a release from GitHub: the CI checks, then (after your approval) the database migrations to `plan-me-prod`, then the iOS build and the upload to TestFlight. Making a TestFlight build live on the App Store stays a manual step in App Store Connect.

### One-time set-up
1. **Prod database:** create the Supabase project `plan-me-prod` (Sydney), set its auth settings and SMTP as for dev (see [hosted setup](supabase-hosted-setup.md)), and note its project ref and database password.
2. **Expo token:** expo.dev → Account settings → Access tokens → Create (name it `github-release`).
3. **Supabase token:** supabase.com → Account → Access tokens → Generate.
4. **Apple upload key (so CI never sees your Apple password):** run `eas credentials`, choose iOS → production → App Store Connect: Manage your API Key → Set up a new key. EAS stores it.
5. **First build by hand** (steps 17–18 above) so EAS creates the signing certificate and the app record. Then copy the app's **Apple ID** (App Store Connect → the app → App Information, a number like `6740000000`) into `eas.json` as `submit.production.ios.ascAppId`. Commit it to `main` together with the `app.json` change from `eas init` (`extra.eas.projectId`). The pipeline checks both before it changes anything.
6. **GitHub environment:** repo → Settings → Environments → New environment `production`.
   - Required reviewers: yourself. Deployment branches: `main` only. The approval step depends on this.
   - **Check your plan first:** environments with required reviewers are available on public repositories, and on private ones only with a paid plan (required reviewers on private repos need GitHub Enterprise). On a private repo without them, environment secrets don't exist and the job can't get its secrets; see "If the approval step isn't available" below.
   - Environment secrets:
     | Name | Value |
     |---|---|
     | `EXPO_TOKEN` | the Expo token |
     | `SUPABASE_ACCESS_TOKEN` | the Supabase token |
     | `SUPABASE_DB_PASSWORD` | `plan-me-prod` database password |
     | `SUPABASE_PROD_PROJECT_REF` | `plan-me-prod` project ref |

### Each release
1. Merge everything for the release into `main`; CI must be green.
2. Actions → **Release** → Run workflow on `main`. Untick *database* or *app* to do only one of them.
3. When the checks pass, the run waits on **production**: open it and **Approve**.
4. The migrations go to `plan-me-prod` first, then the build (about 15–30 min) and the upload. The build appears in TestFlight 10–30 min later.
5. Test it in TestFlight, then submit it for review in App Store Connect (Phase 7).

Notes:
- The checks (EAS link, App Store Connect ID, server settings) run before anything changes in prod; then the database, then the build, which uploads that exact build to TestFlight (`--auto-submit`).
- The database goes first and isn't rolled back if the build fails. Migrations must keep working with the app version people already have (add columns; don't rename or drop in the same release).
- JS-only fixes can go out with `eas update --channel production` without a new build (Phase 8, needs step 10b); that isn't part of the pipeline.

### If the approval step isn't available
On a private repository without a plan that supports environment reviewers, either make the repository public (the code holds no secrets: keys live in GitHub and EAS), or upgrade the plan. Until then, the pipeline can't reach its secrets and stops at the first step that needs one; build and submit by hand (steps 17–18) and push migrations with `npx supabase db push` linked to prod.

## Checklist

- [ ] Apple Developer Program approved
- [ ] Expo account + `eas init`
- [x] Bundle ID set to the final value
- [x] Template screens removed, unused permissions removed
- [ ] Real icon and splash
- [ ] In-app account deletion (done) + demo account
- [ ] `eas.json` (done) + environment variables
- [ ] Release pipeline set up (GitHub `production` environment and secrets)
- [ ] Privacy policy and support URLs live
- [ ] App Store Connect app, privacy label, age rating
- [ ] TestFlight build tested on two devices
- [ ] Screenshots and listing text
- [ ] Submitted → approved → released
