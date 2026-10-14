# Design: Accounts and family sharing (FEAT-002)

- Date: 06/10/2026
- Status: Draft, awaiting review
- Registry: [FEAT-002](../../registry/FEAT-002-accounts-family-sharing.md)

## 1. Intent

Let family members plan together. Each person signs in with an email and a password, joins one family with an invite code, and marks each event as **personal** (private) or **shared** (whole family). Events follow the user across devices and survive a reinstall.

**Success criteria**
- Two people on two phones in the same family see each other's shared events within seconds, and never see each other's personal events.
- The app keeps working offline and syncs on reconnect without losing changes.
- Existing on-device events carry over to the account the first time the user signs in.
- The app meets Apple's account rules: deleting an account is possible inside the app.

**Out of scope:** multiple groups per user, email invitations, social sign-in, per-event permissions beyond the rules below, field-level merging.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Backend | Supabase (Auth, Postgres + RLS, Realtime, Storage), Sydney region |
| D2 | Sign-in method | Email + password, email confirmation, reset by link |
| D3 | Family model | One family per user; join with an 8-character invite code |
| D4 | Shared event access | All family members can view, edit, and delete |
| D5 | Default visibility | Personal |
| D6 | Making an event personal again | Only the event's creator |
| D7 | Leaving | A member can leave; their shared events stay with the family |
| D8 | Removing members | The owner can remove members and regenerate the invite code |
| D9 | Attribution | Shared events show the creator's display name (falls back to their @tag, then 'Member'; someone no longer in the family shows as 'Former member') |
| D10 | Offline / conflicts | Local-first cache + outbox; server `updated_at`, latest save wins |
| D11 | Person tags | `@tag` maps to a family member; one-time mapping of `@AZ`/`@GS` |
| D12 | Bundle ID | `com.berylsheng.planme` (confirmed 06/10/2026) |
| D13 | Profile photos | Private Storage bucket, 256 × 256 JPEG, readable by the owner and their current family (signed URLs) |

## 3. Data model

```sql
profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  tag           text check (tag ~ '^[A-Z]{2,4}$'),
  avatar_url    text,                  -- Storage path <user id>/<uuid>.jpg in the avatars bucket
  family_id     uuid references families on delete set null,
  joined_family_at timestamptz,
  created_at    timestamptz default now(),
  unique (family_id, tag)
)

families (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  owner_id     uuid not null references profiles,
  invite_code  text not null unique,     -- 8 chars, no ambiguous letters (0/O, 1/I)
  created_at   timestamptz default now()
)

events (
  id             uuid primary key,       -- generated on the device so offline creates work
  owner_id       uuid references profiles on delete set null,  -- null = former member (account deleted)
  family_id      uuid references families,
  visibility     text not null default 'personal' check (visibility in ('personal','shared')),
  title          text not null,
  date           date not null,          -- NZ calendar date
  start_time     time,
  end_time       time,
  people         uuid[] default '{}',    -- profile ids
  legacy_people  text[] default '{}',    -- unmapped old tags
  series_id      uuid,                   -- recurring occurrences (was occurrenceId)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),   -- set by trigger, never by the client
  updated_by     uuid references profiles on delete set null,
  deleted_at     timestamptz,
  check ((visibility = 'shared') = (family_id is not null)),
  check (owner_id is not null or visibility = 'shared')   -- orphaned events are always shared
)
-- index: (family_id, updated_at), (owner_id, updated_at)
```

Recurring events stay expanded into separate rows linked by `series_id`, which matches today's behaviour.

## 4. Access rules (RLS + triggers)

| Actor | Personal event | Shared event |
|---|---|---|
| Creator | Read, edit, delete | Read, edit, delete, make personal |
| Same-family member | Can't see it | Read, edit, delete |
| Anyone else | Can't see it | Can't see it |

- **select / update:** (`visibility = 'personal'` AND `owner_id = auth.uid()`) OR (`visibility = 'shared'` AND `family_id = my_family_id()`). Creators reach their own shared events through the second clause, so leaving the family removes their access (D7). Updates use the same rule for the new row.
- **insert:** `owner_id = auth.uid()`; if shared, `family_id = my_family_id()` (the trigger fills it in when omitted).
- **delete:** soft delete only (`deleted_at`). Hard `DELETE` is revoked from clients.
- **Last member leaves:** their shared events become personal and the family is deleted, along with events earlier ex-members left in it.
- **join_family** returns a status (`joined` | `invalid_code` | `rate_limited` | `already_in_family`) instead of raising, so failed attempts are recorded.
- **App users cannot change an event's id** (trigger), so device-generated ids stay stable sync keys.
- **Trigger `events_guard`** runs before every update:
  - sets `updated_at = now()` and `updated_by = auth.uid()`;
  - rejects changes to `owner_id`;
  - rejects shared → personal unless `auth.uid() = owner_id`;
  - when made personal, clears `family_id`.
- **profiles:** users can read their own row and their family members' rows. They can update only `display_name`, `tag`, and `avatar_url` on their own row. `family_id` is only changed through RPCs.
- **families:** members can read their own family. Only the owner can update the name.
- **avatars bucket (Storage):** owners insert, update and delete files in their own folder; the owner and current family members can read them. 1 MB limit, JPEG only.

### RPC functions (`security definer`)

| Function | Rule |
|---|---|
| `create_family(name)` | Caller must not already be in a family. Generates the code and sets the caller as owner and member |
| `join_family(code)` | Caller must not be in a family. Rate-limited to 5 failed tries per hour per user |
| `leave_family()` | Clears the caller's `family_id`. If the owner leaves: ownership passes to the longest-standing member, or the family is deleted if they were the last |
| `remove_member(user_id)` | Owner only. Same effect as that member leaving |
| `regenerate_invite_code()` | Owner only |
| `delete_account()` | Hard-deletes the caller's personal events, leaves the family (rules above), deletes `auth.users`. Their shared events stay, shown as "Former member" |

When someone leaves or is removed, their shared events keep their `family_id` (D7). They lose access to them, because the RLS check uses their current family.

## 5. App structure

- `lib/supabase.ts`: client; session stored in `expo-secure-store` (adapter pattern from Supabase's Expo guide).
- `lib/parse/`: `preprocessInput`, `parseRecurrence`, tag extraction, and chrono date/time resolution, moved out of `index.tsx` unchanged and unit tested. Tag extraction checks the family's tags instead of a hard-coded `AZ|GS`.
- `lib/events/syncEngine.ts` (one user's local-first sync: outbox, full re-fetch, Realtime, retries) and `context/EventsProvider.tsx` (React access; the planner's only data source). `lib/events/rows.ts`, `outbox.ts`, `store.ts`, `pull.ts`, `merge.ts`, `legacy.ts` hold the parts. `AuthProvider` also keeps the last signed-in user (`planme:lastUser`) so the planner opens offline.
- `context/AuthProvider.tsx`: session, profile, sign in/up/out, reset.
- `context/FamilyProvider.tsx`: family, members, tag → member lookup; cached per user (`planme:family:<userId>`) for offline start; refreshed on sign-in, foreground and after each family action. `lib/family/` holds the calls (`api.ts`), rules (`validation.ts`), tag helpers (`tags.ts`) and the tag mapping (`tagMapping.ts`).
- Routes: `(auth)/sign-in`, `(auth)/sign-up`, `(auth)/forgot-password`, `(auth)/reset-password` (deep link); `(tabs)/` (signed-in only; the Explore placeholder is replaced by **Family**); `family/create`, `family/join` (members are listed on the Family tab); `settings/` (profile, tag, photo, change password, sign out, delete account). `lib/profile/` holds the photo storage (`avatars.ts`) and picker (`pickAvatar.ts`); `components/profile/ProfileForm.tsx` is shared by the Family tab and Settings.
- Event UI: a personal/shared toggle in the input row (it remembers the last choice per session, starting from personal), a shared badge and creator name on list items, and an avatar per tagged member. Members show their profile photo, or a coloured circle with their tag when they have none.

## 6. Sync

1. **Cache:** AsyncStorage holds `planme:events:<userId>` (rows the user can see), `planme:outbox:<userId>`, and `planme:sync:<userId>`. `planme:lastUser` holds the last signed-in user for offline start.
2. **Outbox:** every local change is applied to the cache immediately, then queued as `{ opId, kind: insert|update|delete, record | id + deletedAt, attempted }` in `planme:outbox:<userId>`. A flush sends each queued change in order: creates as INSERT, edits and deletes as UPDATE (row-level security rejects upserts of another member's shared event); it stops at the first network or sign-in failure and retries with backoff (2 s doubling up to 5 min), and also on foreground, a fresh session and Realtime (re)connect. A later edit to an event whose create may already have reached the server is sent as its own UPDATE (a retried create that hits a duplicate key counts as done), and a delete of an event the server never saw cancels it locally.
3. **Re-fetch:** on start, foreground, a fresh session, Realtime (re)connect, and after a refused change, fetch every visible non-deleted event (1000 per page) and replace the cache with it, except events with changes still queued here. (Decided in Plan 4 instead of an incremental pull: a family planner is small, and a full fetch handles deletes, un-sharing, lost access and late commits with no cursor.)
4. **Realtime:** subscribe to `events` changes for the user's family and their own rows; merge with the same rule.
5. **Lost access and cascade deletes:** lost access, un-sharing and cascade deletes are handled by the full re-fetch (events no longer returned are removed). Changes the server refuses are dropped from the outbox; the next re-fetch shows the server's version.
6. **Events from before accounts:** the first account to sign in is asked once whether to add them (as personal events with new uuids, one new series id per old occurrence id). The claim — the account and the new events with their ids — is saved on the phone (`planMeTasks:claim`) before anything is queued, so a crash or a failed upload re-queues the same events and a retry never duplicates them. "Keep them off my account" isn't asked again for that account; the next account to sign in is asked. The old copy (`planMeTasks`) is deleted only after a clean sync that ran after the claim has returned every claimed event from the server; if the claimer signs out before that, the events are offered again (to the same account they reuse the same ids). An event the server refuses keeps the old copy on the phone. An event deleted after it was claimed is dropped from the claim.
7. **Tag mapping:** when a family is joined or created and legacy tags exist, prompt "Who is @AZ?" with a list of members. Mapped tags move into `people`; unmapped tags stay in `legacy_people` and show as plain text. Answers are kept per user (`planme:tagMap:<userId>`); "No one" keeps the tag as text and isn't asked again. Old `@AZ`/`@GS` stay recognised (with their icons) until mapped.
8. **Offline sign-in:** opened offline, the app shows the last user's saved events and queues changes; only a server-confirmed end of the session returns to sign-in. Local data is deleted only by a user-initiated sign-out or account deletion (after a warning if changes haven't synced). Saving writes the outbox before the events, so a crash between the two can't lose a queued change.

## 7. Errors and edge cases

- Wrong password or unconfirmed email → a clear inline message; resend confirmation.
- Invalid or expired invite code → "Code not found". Too many tries → "Try again in an hour".
- Joining while already in a family → the user must leave first.
- An edit is rejected by RLS (for example, an event was made personal by its creator in the meantime) → drop it from the outbox, refresh the row, and show a toast.
- A change the server keeps answering with a server error (5xx) while the server is otherwise healthy (a re-fetch works) is dropped after five tries and counted the same way, so it can't block the queue. During an outage nothing is dropped.
- Signing out: clear the cache, outbox, and session for that user. If the outbox isn't empty, warn first.
- Deleting the account offline → "You're offline. Connect to the internet to delete your account." Nothing on the phone changes. The photo is deleted first; if the account deletion then fails, the user is told the photo was removed.
- Changing the password asks for the current one (Supabase requires a recent sign-in).

## 8. Testing

- **Jest unit tests:** the parsers (current behaviour captured first, before the refactor), merge logic, outbox ordering and retry, legacy migration.
- **pgTAP:** a test for each row in the access table and each RPC rule (non-owner can't remove members, a member can't make an event personal, a non-member can't see shared events, and so on).
- **Manual two-device checklist:** share, edit, delete, make personal, leave, remove, offline edit + reconnect, delete account.

## 9. Rollout

1. Phase A: refactor the parsers into `lib/parse` with tests (no behaviour change).
2. Phase B: Supabase schema, RLS, RPCs, and pgTAP tests.
3. Phase C: auth screens + AuthProvider; the app still runs local-only.
4. Phase D: sync engine, offline start, and the one-time import of the phone's events; events move to Supabase.
5. Phase E: family screens, sharing toggle, member tags.
6. Phase F: settings, account deletion, then TestFlight (FEAT-003).
