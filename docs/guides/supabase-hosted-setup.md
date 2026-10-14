# Hosted Supabase dev project — your steps

The local stack (Docker) runs the automated tests, but a phone can't open its email links (they point at `127.0.0.1`). For testing on a phone, use a free hosted project called `plan-me-dev`. Do these steps yourself; they need your accounts and passwords.

## 1. Create the project
1. Sign up at https://supabase.com with a **personal** email (this is a personal app).
2. **New project** → name `plan-me-dev`, region **Oceania (Sydney) — ap-southeast-2**, Free plan.
3. Generate a strong database password and save it in your password manager. You need it in step 2.

## 2. Push the schema and auth settings
From the repo root:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <project-ref>
```

The project ref is in the dashboard URL: `supabase.com/dashboard/project/<project-ref>`.

```bash
npx supabase db push
```

This applies the migrations. **Never add `--include-seed`**: `seed.sql` holds test helpers that must not exist on a hosted project. Also leave **Branching** turned off. Run it again after pulling FEAT-004: it adds the `repeat` column. Run `npx supabase db push` on the hosted project before installing this build on any phone.

```bash
npx supabase config push
```

Read the diff it shows; it should set `site_url = planme://`, the redirect URLs, the password rule and email confirmation. Accept it. To preview first, run `npx supabase config diff`; `config push` also asks before each change.

## 3. Check account deletion will work
In the dashboard: **SQL Editor** → run:

```sql
select has_table_privilege('postgres', 'auth.users', 'DELETE');
```

It must return `true`. If it returns `false`, tell Claude: account deletion will need an Edge Function instead.

## 4. Email that reaches your family (do this before step 6)
Supabase's built-in email only reaches members of your own Supabase organisation, so step 6's second account needs a custom sender. Add one before you run the checklist:

1. Sign up at https://www.brevo.com (free, 300 emails a day), verify a sender address (e.g. your Gmail), and create an **SMTP key**.
2. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable custom SMTP: host `smtp-relay.brevo.com`, port `587`, username = your Brevo login, password = the SMTP key, sender = the verified address, sender name `Plan-Me`.

In Brevo, turn off click tracking for these emails (Transactional → Settings), so link scanners don't use up the one-time links.

## 5. Point the app at it
Dashboard → **Project Settings → API Keys**. Copy the project URL and the **publishable** key (never the secret key) into `.env.local`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Restart `npx expo start` after changing `.env.local`.

## 6. Try it on your phone

- [ ] Create an account → "Check your email" → open the link **on the phone** → the planner opens
- [ ] Create a second account but don't open the link yet → try to sign in → "Confirm your email first. Check your inbox for the link." and a **Resend confirmation email** button → tap it → "We sent a new confirmation email." → the new link signs you in
- [ ] Open the same link again → "This link has expired…" (not a crash)
- [ ] Sign out (top right) → sign-in screen; back button doesn't return to the planner
- [ ] Sign in with the email in capitals → works
- [ ] Wrong password → "Email or password is incorrect."
- [ ] Airplane mode → sign in → "Can't reach the server…"; button usable again
- [ ] Forgot password → link on the phone → new password → planner; old password no longer works
- [ ] Close and reopen the app → still signed in
- [ ] First sign-in on a phone that already had events → "Add them to your account?" → Add → they appear; on a second device (or after reinstalling) signed in as you, they appear too
- [ ] Airplane mode → close and reopen the app → the planner opens with your events and "Offline. Showing what's saved on this phone."
- [ ] Still offline: add an event → "Offline. 1 change will sync when you're back online." → back online → the message goes away; the event is on your other device
- [ ] With an unsynced change, Sign out → a warning about deleting it; Cancel keeps you signed in

**Two phones**
- [ ] Phone A: Family tab → Create a family → the code shows; Share code works
- [ ] Phone B (another account): Join with a code → both phones list two members
- [ ] Both: set a tag on the Family tab; a clash says "Someone in your family already uses @XX."
- [ ] A: switch the input to Shared, add "6pm dinner @<B's tag>" → B sees it with "Shared · <A's name>" and B's circle
- [ ] B edits it → A sees the edit; B can't switch it to Personal (the switch is greyed out)
- [ ] A switches it to Personal → it disappears from B (switch away from the app and back, or reopen the app)
- [ ] On a phone with old @AZ/@GS events, after joining: "Who is @AZ?" → pick a member → the event shows their circle
- [ ] A (owner) removes B → B's Family tab shows no family after reopening; A's shared events disappear from B
- [ ] B leaves (after rejoining) → B's shared events stay on A's phone

**Settings, photos and account deletion** (`supabase db push` creates the `avatars` bucket and its policies)
- [ ] Settings → Choose photo → allow photos → pick one → it shows in Settings and, on the other phone, on the Family tab and on events tagged with you
- [ ] Remove photo → the circle with your tag comes back
- [ ] Change password with a wrong current password → "Your current password is incorrect."; with the right one → "Your password is changed." and you can sign in with it
- [ ] Delete account (on a test account) → confirm → sign-in screen; on the other phone the account's shared events show "Former member"; signing in with the old email fails

## Notes
- Free projects pause after a week of no use; restore them from the dashboard.
- `exp://**` is in the redirect allow-list so Expo Go works. Remove it from the production project.
