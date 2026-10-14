# FEAT-002 Plan 6: settings, photos and account deletion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in users a Settings screen (name, tag, profile photo, change password, sign out, delete account), show members' photos instead of tag circles, remove the Expo template screens (BUG-002), and hand FEAT-002 over to FEAT-003 (App Store).

**Architecture:** One migration adds a private `avatars` storage bucket whose files can be read only by the owner and their current family. `lib/profile/avatars.ts` uploads, replaces, signs and deletes photos; `lib/profile/pickAvatar.ts` wraps the photo picker and resizes to a 256 × 256 JPEG. `FamilyProvider` loads short-lived signed URLs for members' photos and `MemberAvatar` shows them. Account deletion calls Plan 2's `delete_account()` function, then forgets this user's data on the phone exactly like a user-initiated sign-out.

**Tech Stack:** Expo SDK 54 (adds `expo-image-picker` and `expo-image-manipulator`), expo-router 6, React 19.1, React Native 0.81, TypeScript (strict), supabase-js 2.117 (Storage), Jest (jest-expo) with @testing-library/react-native 12.9, local Supabase (Docker) for integration tests.

**Spec:** [2026-10-06-accounts-family-sharing-design.md](../specs/2026-10-06-accounts-family-sharing-design.md) — §1 (Apple's account rules), §4 (`delete_account`), §5 (`settings/` route: profile, tag, avatar, sign out, delete account). Roadmap notes for Plan 6 in [2026-10-06-feat-002-roadmap.md](2026-10-06-feat-002-roadmap.md).

## Global Constraints

- Read the Expo SDK 54 docs before adding a package (AGENTS.md): https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/ and https://docs.expo.dev/versions/v54.0.0/sdk/imagemanipulator/. Install only with `npx expo install expo-image-picker expo-image-manipulator` (it picks the SDK 54 versions). No other new packages.
- Never connect to a hosted Supabase project; integration tests use the local stack only (`npm run test:integration`). Never push `seed.sql` to hosted projects.
- The service-role key appears only in test code (`test-utils/supabaseTestKit.ts`, `jest.integration.setup.js`).
- Never log or display `AuthResult.code`. Show `message` strings only.
- Photos: stored at `avatars/<userId>/<random-uuid>.jpg`, JPEG only, 256 × 256, at most 1 MB (bucket limit `1048576`). Only the owner writes their folder; the owner and their current family members can read it.
- Local data is deleted only by a user-initiated sign-out or account deletion.
- Password rules: reuse `validateNewPassword` (8–72 characters, a letter and a number) from `lib/auth/validation.ts`.
- NZ English in all copy. Dates in docs: dd/mm/yyyy.
- Test names containing an apostrophe use double quotes.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Rulings made while writing this plan

- **R1 — private photos:** the bucket is private and the app shows photos through signed URLs that last one hour. A public bucket with unguessable names would be simpler, but family photos (often of children) shouldn't be readable by anyone holding a link after someone leaves the family.
- **R2 — profile on two screens:** the same `ProfileForm` (name, tag, photo) appears on the Family tab (where tags matter) and in Settings (where Apple reviewers look for account controls). One component, no duplicated logic.
- **R3 — offline photos:** signed URLs are kept in memory only. Offline (or before the first fetch) members show as tag circles. `expo-image` caches downloaded photos by storage path, so a photo seen once usually still shows.
- **R4 — delete order:** the app deletes the user's photo files before calling `delete_account()`, because after deletion it can't authenticate to Storage. If `delete_account()` then fails, the user keeps their account without a photo and is told so.
- **R5 — change password:** with `secure_password_change` on, Supabase requires a recent sign-in. The screen asks for the current password and signs in with it before `updateUser`, which also confirms the person knows it.

## Review Focus

1. **Deleting the account while offline or when the server fails** → nothing is deleted on the phone, the user stays signed in and sees why. Test: Task 6 provider "keeps everything when the server can't delete the account".
2. **Deleting the account with changes that haven't synced** → the confirmation says they'll be lost before anything happens. Test: Task 6 screen "warns about unsynced changes".
3. **Picking a large or HEIC photo** → it's cropped square and saved as a 256 × 256 JPEG well under 1 MB. Test: Task 3 `pickAvatar` "resizes to a 256 square JPEG".
4. **A member who leaves the family** → their photo is no longer readable by the family, and they can't read the family's photos. Test: Task 1 integration "stops sharing photos when someone leaves".
5. **A wrong current password when changing it** → a clear message, and the password is unchanged. Test: Task 5 api "says the current password is wrong and changes nothing".

---

## File structure

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/20261012120000_avatars.sql` | 1 | `avatars` bucket and its access rules |
| `lib/profile/avatars.ts` | 1 | Upload, replace, remove, sign and delete photos |
| `.github/workflows/ci.yml` | 1 | Start Storage for integration tests |
| `lib/family/types.ts`, `lib/family/api.ts`, `lib/family/cache.ts` | 2 | `Member.avatarPath`; photo calls in `familyApi` |
| `context/FamilyProvider.tsx` | 2 | Signed URLs, `avatarUrl`, `setAvatar`, `removeAvatar` |
| `components/events/MemberAvatar.tsx` | 2 | Show the photo when there is one |
| `lib/profile/pickAvatar.ts` | 3 | Photo picker + resize |
| `components/profile/ProfileForm.tsx` | 3 | Name, tag and photo form (Family tab and Settings) |
| `components/family/FamilyScreen.tsx` | 3 | Use `ProfileForm` |
| `app.json` | 3 | Photo permission text; no camera or microphone |
| `components/settings/SettingsScreen.tsx`, `app/settings/index.tsx` | 4 | Settings screen |
| `components/auth/SignOutButton.tsx` | 4 | Restyle for the Settings list |
| `app/(tabs)/index.tsx` | 4 | Settings button in the planner header |
| `components/navigation/RootNavigator.tsx` | 4 | Settings routes, signed-in only |
| `lib/auth/api.ts`, `app/settings/password.tsx` | 5 | Change password |
| `lib/auth/api.ts`, `context/EventsProvider.tsx`, `app/settings/delete-account.tsx` | 6 | Delete account and forget it on the phone |
| template files, `package.json` | 7 | BUG-002: remove the Expo template |
| docs | 8 | Spec, guide, registry, roadmap; hand-over to FEAT-003 |

---

### Task 1: Avatars bucket and photo storage

**Files:**
- Create: `supabase/migrations/20261012120000_avatars.sql`, `lib/profile/avatars.ts`
- Modify: `.github/workflows/ci.yml` (stop excluding `storage-api`)
- Test: `lib/profile/__tests__/avatars.test.ts`, `lib/profile/__tests__/avatars.integration.test.ts`

**Interfaces:**
- Consumes: `FamilyResult` from `lib/family/types.ts`; `FAMILY_MESSAGES` from `lib/family/api.ts`; `classifyFailure` from `lib/events/failures.ts`; test kit `signedInPhone`, `adminClient`.
- Produces (`lib/profile/avatars.ts`):
  - `AVATAR_BUCKET = 'avatars'`, `AVATAR_SIZE = 256`
  - `avatarPath(userId, fileId): string` → `'<userId>/<fileId>.jpg'`
  - `base64ToBytes(base64): Uint8Array`
  - `uploadAvatar(client, userId, fileId, base64, previousPath): Promise<FamilyResult<string>>` — uploads, sets `profiles.avatar_url` to the new path, then deletes the previous file (best effort); returns the new path
  - `removeAvatar(client, userId, path): Promise<FamilyResult>` — clears `avatar_url`, then deletes the file (best effort)
  - `avatarUrls(client, paths): Promise<Record<string, string>>` — signed URLs (one hour) keyed by path; `{}` on any failure
  - `deleteAllAvatars(client, userId): Promise<boolean>` — removes every file in the user's folder; true when the folder is empty afterwards

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261012120000_avatars.sql`:

```sql
-- FEAT-002 Plan 6: profile photos. Private bucket; the owner writes their folder,
-- the owner and their current family read it. Paths: <user id>/<random uuid>.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- The first folder of the path is the owner's user id.
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read: your own photos, and those of people currently in your family.
create policy avatars_select_family on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
         where p.id::text = (storage.foldername(name))[1]
           and p.family_id is not null
           and p.family_id = public.my_family_id()
      )
    )
  );
```

Apply it locally: `npx supabase db reset` (this re-runs every migration and the seed against the local database only).

- [ ] **Step 2: Start Storage in CI**

In `.github/workflows/ci.yml`, change the `supabase start -x` line so it no longer excludes `storage-api`:

```yaml
      - run: supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta
```

- [ ] **Step 3: Write the failing unit test**

`lib/profile/__tests__/avatars.test.ts`:

```ts
import { avatarPath, base64ToBytes } from '../avatars';

describe('avatars', () => {
  it('builds the path in the owner folder', () => {
    expect(avatarPath('user-1', 'abc')).toBe('user-1/abc.jpg');
  });

  it('decodes base64 to bytes', () => {
    expect(Array.from(base64ToBytes('aGk='))).toEqual([104, 105]);
    expect(base64ToBytes('').length).toBe(0);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx jest lib/profile/__tests__/avatars.test.ts`
Expected: FAIL — `Cannot find module '../avatars'`.

- [ ] **Step 5: Write avatars.ts**

`lib/profile/avatars.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure } from '@/lib/events/failures';
import { FAMILY_MESSAGES } from '@/lib/family/api';
import type { FamilyResult } from '@/lib/family/types';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_SIZE = 256;
const SIGNED_URL_SECONDS = 60 * 60;

export const avatarPath = (userId: string, fileId: string): string => `${userId}/${fileId}.jpg`;

/** Hermes and Node both have atob. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const failed = (message: string, offline = false): FamilyResult<never> => ({ ok: false, message, offline });

/** Storage reports HTTP problems with a status; anything without one never reached the server. */
function storageFailure(error: { status?: number | string; statusCode?: string; message?: string }): FamilyResult<never> {
  const status = Number(error.status ?? error.statusCode ?? 0);
  if (!status) return failed(FAMILY_MESSAGES.offline, true);
  if (status === 413) return failed('That photo is too big. Try another one.');
  return failed(FAMILY_MESSAGES.unknown);
}

function profileFailure(error: { code?: string; message?: string }, status: number): FamilyResult<never> {
  const kind = classifyFailure(error, status);
  if (kind === 'network') return failed(FAMILY_MESSAGES.offline, true);
  if (kind === 'auth') return failed(FAMILY_MESSAGES.signInAgain);
  return failed(FAMILY_MESSAGES.unknown);
}

async function removeFiles(client: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client.storage.from(AVATAR_BUCKET).remove(paths);
  } catch {
    // Best effort: an orphaned file costs storage, not privacy (the folder is still private).
  }
}

/** Upload a new photo, point the profile at it, then delete the old one. Returns the new path. */
export async function uploadAvatar(
  client: SupabaseClient,
  userId: string,
  fileId: string,
  base64: string,
  previousPath: string | null,
): Promise<FamilyResult<string>> {
  const path = avatarPath(userId, fileId);
  try {
    const { error: uploadError } = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: false });
    if (uploadError) return storageFailure(uploadError as { status?: number; statusCode?: string });

    const { error, status } = await client.from('profiles').update({ avatar_url: path }).eq('id', userId);
    if (error) {
      await removeFiles(client, [path]);
      return profileFailure(error, status);
    }
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
  // Only ever delete inside the user's own folder.
  if (previousPath && previousPath !== path && previousPath.startsWith(`${userId}/`)) {
    await removeFiles(client, [previousPath]);
  }
  return { ok: true, value: path };
}

/** Clear the profile photo, then delete the file. */
export async function removeAvatar(client: SupabaseClient, userId: string, path: string | null): Promise<FamilyResult> {
  try {
    const { error, status } = await client.from('profiles').update({ avatar_url: null }).eq('id', userId);
    if (error) return profileFailure(error, status);
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
  if (path && path.startsWith(`${userId}/`)) await removeFiles(client, [path]);
  return { ok: true, value: undefined };
}

/** Signed URLs (one hour) for the photos this user may see, keyed by path. Failures give no URL. */
export async function avatarUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  try {
    const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error || !data) return {};
    const urls: Record<string, string> = {};
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
    }
    return urls;
  } catch {
    return {};
  }
}

/** Delete every photo in the user's folder (before deleting the account). True when none are left. */
export async function deleteAllAvatars(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const bucket = client.storage.from(AVATAR_BUCKET);
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) return false;
    const paths = (data ?? []).map(file => `${userId}/${file.name}`);
    if (paths.length === 0) return true;
    const { error: removeError } = await bucket.remove(paths);
    return !removeError;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the unit test**

Run: `npx jest lib/profile`
Expected: PASS.

- [ ] **Step 7: Write the integration tests**

`lib/profile/__tests__/avatars.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { signedInPhone } from '@/test-utils/supabaseTestKit';

import { AVATAR_BUCKET, avatarUrls, deleteAllAvatars, removeAvatar, uploadAvatar } from '../avatars';

// A tiny valid JPEG header is enough: the bucket checks the declared content type, not the pixels.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64');

type Phone = Awaited<ReturnType<typeof signedInPhone>>;

async function family(a: Phone, b: Phone) {
  await a.client.rpc('create_family', { p_name: 'Photos' });
  const { data } = await a.client.from('families').select('invite_code').single();
  await b.client.rpc('join_family', { p_code: data?.invite_code });
}

async function upload(phone: Phone, previous: string | null = null) {
  const result = await uploadAvatar(phone.client, phone.userId, randomUUID(), JPEG, previous);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('Photos against local Supabase', () => {
  it('saves a photo in your folder and points your profile at it', async () => {
    const alice = await signedInPhone('photo');
    const path = await upload(alice);
    expect(path.startsWith(`${alice.userId}/`)).toBe(true);
    const { data } = await alice.client.from('profiles').select('avatar_url').eq('id', alice.userId).single();
    expect(data?.avatar_url).toBe(path);
    expect(Object.keys(await avatarUrls(alice.client, [path]))).toEqual([path]);
  });

  it('shows your photo to your family and to no one else', async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    const carol = await signedInPhone('photo');
    await family(alice, bob);
    const path = await upload(alice);
    const url = (await avatarUrls(bob.client, [path]))[path];
    expect(url).toBeDefined();
    expect((await fetch(url)).status).toBe(200);
    expect(await avatarUrls(carol.client, [path])).toEqual({});
  });

  it('stops sharing photos when someone leaves', async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    await family(alice, bob);
    const alicePath = await upload(alice);
    const bobPath = await upload(bob);
    await bob.client.rpc('leave_family');
    expect(await avatarUrls(bob.client, [alicePath])).toEqual({});
    expect(await avatarUrls(alice.client, [bobPath])).toEqual({});
  });

  it("won't let you write in someone else's folder", async () => {
    const alice = await signedInPhone('photo');
    const bob = await signedInPhone('photo');
    const { error } = await bob.client.storage
      .from(AVATAR_BUCKET)
      .upload(`${alice.userId}/${randomUUID()}.jpg`, Buffer.from(JPEG, 'base64'), { contentType: 'image/jpeg' });
    expect(error).not.toBeNull();
  });

  it('refuses a file over 1 MB', async () => {
    const alice = await signedInPhone('photo');
    const big = Buffer.alloc(1_100_000, 1).toString('base64');
    const result = await uploadAvatar(alice.client, alice.userId, randomUUID(), big, null);
    expect(result.ok).toBe(false);
  });

  it('deletes the old photo when you pick a new one, and both when removed', async () => {
    const alice = await signedInPhone('photo');
    const first = await upload(alice);
    const second = await upload(alice, first);
    const { data } = await alice.client.storage.from(AVATAR_BUCKET).list(alice.userId);
    expect(data?.map(f => `${alice.userId}/${f.name}`)).toEqual([second]);

    expect(await removeAvatar(alice.client, alice.userId, second)).toEqual({ ok: true, value: undefined });
    const { data: after } = await alice.client.from('profiles').select('avatar_url').eq('id', alice.userId).single();
    expect(after?.avatar_url).toBeNull();
    expect(await deleteAllAvatars(alice.client, alice.userId)).toBe(true);
  });
});
```

- [ ] **Step 8: Run the integration tests**

Run: `npm run test:integration -- lib/profile`
Expected: PASS (6 tests). Local Supabase must be running with Storage (`npm run db:start`).

- [ ] **Step 9: Check and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run db:test`

```bash
git add supabase/migrations/20261012120000_avatars.sql lib/profile .github/workflows/ci.yml
git commit -m "FEAT-002: Store profile photos that only you and your family can see

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Members' photos in the app

**Files:**
- Modify: `lib/family/types.ts`, `lib/family/api.ts`, `lib/family/cache.ts`, `context/FamilyProvider.tsx`, `components/events/MemberAvatar.tsx`, `test-utils/fakeFamily.ts`, `context/__tests__/FamilyProvider.test.tsx` (its `fakeApi`)
- Test: `components/events/__tests__/MemberAvatar.test.tsx`, `context/__tests__/FamilyProvider.test.tsx`, `lib/family/__tests__/cache.test.ts`

**Interfaces:**
- Consumes: Task 1 (`uploadAvatar`, `removeAvatar`, `avatarUrls`); `newUuid` from `lib/events/ids.ts`.
- Produces:
  - `Member.avatarPath?: string | null` (absent in old caches means none)
  - `familyApi` gains `uploadAvatar`, `removeAvatar`, `avatarUrls` (so `FamilyApi` includes them)
  - `FamilyValue` gains `avatarUrl(member): string | null`, `setAvatar(base64): Promise<FamilyResult>`, `removeAvatar(): Promise<FamilyResult>`
  - `MemberAvatar({ member, faded?, size? })` shows the photo when `FamilyContext` has a URL for it

- [ ] **Step 1: Write the failing tests**

Add to `components/events/__tests__/MemberAvatar.test.tsx`:

```tsx
import { FamilyContext } from '@/context/FamilyProvider';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';

describe('MemberAvatar with a photo', () => {
  it('shows the photo when the family has a URL for it', () => {
    const withPhoto = { ...bob, avatarPath: 'user-2/p.jpg' };
    render(
      <FamilyContext.Provider value={fakeFamilyValue({ avatarUrl: m => (m.avatarPath ? `https://x/${m.avatarPath}` : null) })}>
        <MemberAvatar member={withPhoto} />
      </FamilyContext.Provider>,
    );
    expect(screen.getByLabelText('Bob')).toBeTruthy();
    expect(screen.queryByText('BE')).toBeNull();
  });

  it('falls back to the tag circle without a URL', () => {
    render(
      <FamilyContext.Provider value={fakeFamilyValue()}>
        <MemberAvatar member={{ ...bob, avatarPath: 'user-2/p.jpg' }} />
      </FamilyContext.Provider>,
    );
    expect(screen.getByText('BE')).toBeTruthy();
  });
});
```

Add to `context/__tests__/FamilyProvider.test.tsx` (extend that file's `fakeApi` with `uploadAvatar: jest.fn(async () => ok('user-1/new.jpg'))`, `removeAvatar: jest.fn(async () => ok(undefined))`, `avatarUrls: jest.fn(async (_c, paths: string[]) => Object.fromEntries(paths.map(p => [p, `https://signed/${p}`])))` so it still `satisfies FamilyApi`):

```tsx
  it('loads signed URLs for members with photos', async () => {
    const api = fakeApi(ok({ ...inFamily, members: [FAKE_ME, { ...FAKE_BOB, avatarPath: 'user-2/b.jpg' }] }));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.avatarUrl({ ...FAKE_BOB, avatarPath: 'user-2/b.jpg' })).toBe('https://signed/user-2/b.jpg'));
    expect(result.current.avatarUrl(FAKE_ME)).toBeNull();
  });

  it('uploads a new photo, replacing the old one', async () => {
    const api = fakeApi(ok({ ...inFamily, me: { ...FAKE_ME, avatarPath: 'user-1/old.jpg' } }));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.me?.avatarPath).toBe('user-1/old.jpg'));
    await act(async () => {
      await result.current.setAvatar('BASE64');
    });
    expect(api.uploadAvatar).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.any(String), 'BASE64', 'user-1/old.jpg');
  });
```

Add to `lib/family/__tests__/cache.test.ts`:

```ts
  it('reads an older cache without photo paths', async () => {
    const storage = memoryStorage();
    await storage.setItem(familyKeys('user-1').family, JSON.stringify(snapshot)); // members have no avatarPath
    expect((await readFamilyCache(storage, 'user-1'))?.me.avatarPath ?? null).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/events context lib/family`
Expected: FAIL — `avatarUrl` is not on `FamilyValue`; `fakeApi` has extra keys.

- [ ] **Step 3: Add the photo path to members**

1. `lib/family/types.ts` — add to `Member`: `/** Storage path of the profile photo, if any. */ avatarPath?: string | null;`
2. `lib/family/api.ts`:
   - `PROFILE_COLUMNS = 'id, display_name, tag, avatar_url, family_id, joined_family_at'`
   - add `avatar_url: string | null` to `ProfileRow`
   - `toMember`: `({ id: row.id, displayName: row.display_name, tag: row.tag, joinedAt: row.joined_family_at, avatarPath: row.avatar_url })`
   - import `{ avatarUrls, removeAvatar, uploadAvatar }` from `@/lib/profile/avatars` and add them to `familyApi`.
3. `lib/family/cache.ts` — in `isMember`, also accept the field: `(m.avatarPath === undefined || isNullableString(m.avatarPath))`.
4. `test-utils/fakeFamily.ts` — add to the returned value: `avatarUrl: () => null,`, `setAvatar: jest.fn(ok),`, `removeAvatar: jest.fn(ok),` (before `...overrides`).

- [ ] **Step 4: Load signed URLs and add the photo actions in FamilyProvider**

In `context/FamilyProvider.tsx`:

1. Import `newUuid` from `@/lib/events/ids`.
2. Add to `FamilyValue`:

```ts
  /** A short-lived URL for this member's photo, or null (no photo, offline, or not loaded yet). */
  avatarUrl: (member: Member) => string | null;
  setAvatar: (base64: string) => Promise<FamilyResult>;
  removeAvatar: () => Promise<FamilyResult>;
```

3. Add state after `state`: `const [avatarState, setAvatarState] = useState<{ userId: string | null; urls: Record<string, string> }>({ userId: null, urls: {} });`
4. Keep a ref to the snapshot for the actions: after `const snapshot = current?.snapshot ?? null;` add `const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;` (move the `snapshot` line above the actions if needed so it is declared first).
5. In `refresh`, after a successful fetch (`setState({ userId: uid, snapshot: result.value, ... })`), load the URLs:

```ts
      const paths = result.value.members.flatMap(m => (m.avatarPath ? [m.avatarPath] : []));
      void api.avatarUrls(client, paths).then(urls => {
        if (userRef.current === uid) setAvatarState({ userId: uid, urls });
      });
```

6. In the user-change effect, also reset: `setAvatarState({ userId, urls: {} });`
7. Add the actions next to the others:

```tsx
  const setAvatar = useCallback(
    (base64: string) =>
      withUser(
        uid => api.uploadAvatar(client, uid, newUuid(), base64, snapshotRef.current?.me.avatarPath ?? null).then(r => (r.ok ? { ok: true as const, value: undefined } : r)),
        false,
      ),
    [withUser, api, client],
  );
  const removeAvatar = useCallback(
    () => withUser(uid => api.removeAvatar(client, uid, snapshotRef.current?.me.avatarPath ?? null), false),
    [withUser, api, client],
  );
  const urls = avatarState.userId === userId ? avatarState.urls : {};
  const avatarUrl = useCallback((member: Member) => (member.avatarPath ? urls[member.avatarPath] ?? null : null), [urls]);
```

8. Add `avatarUrl`, `setAvatar`, `removeAvatar` to the `value` object and its dependency list.

- [ ] **Step 5: Show the photo in MemberAvatar**

Replace `components/events/MemberAvatar.tsx`'s `MemberAvatar` (keep `avatarColour` and `avatarText`):

```tsx
import { Image } from 'expo-image';
import React, { useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FamilyContext } from '@/context/FamilyProvider';
import type { Member } from '@/lib/family/types';

// … COLOURS, avatarColour, avatarText unchanged …

/** A member's photo when the family has a URL for it, otherwise a coloured circle with their tag. */
export function MemberAvatar({ member, faded = false, size = 30 }: { member: Member; faded?: boolean; size?: number }) {
  // Optional: screens outside FamilyProvider (and some tests) just get the circle.
  const family = useContext(FamilyContext);
  const uri = family?.avatarUrl(member) ?? null;
  const label = member.displayName?.trim() || (member.tag ? `@${member.tag}` : 'Member');
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        accessibilityLabel={label}
        // Cache by storage path: the signed URL changes every hour, the photo doesn't.
        source={{ uri, cacheKey: member.avatarPath ?? undefined }}
        contentFit="cover"
        style={[styles.circle, box, faded && styles.faded]}
      />
    );
  }
  return (
    <View accessibilityLabel={label} style={[styles.circle, box, { backgroundColor: avatarColour(member.id) }, faded && styles.faded]}>
      <Text style={[styles.text, { fontSize: Math.round(size / 3) }]}>{avatarText(member)}</Text>
    </View>
  );
}
```

and change `styles.circle` to `{ marginLeft: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }` and `styles.text` to `{ color: '#fff', fontWeight: 'bold' }`.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add lib/family lib/profile context components/events test-utils
git commit -m "FEAT-002: Show family members' photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Choosing a photo, and the shared profile form

**Files:**
- Install: `npx expo install expo-image-picker expo-image-manipulator`
- Create: `lib/profile/pickAvatar.ts`, `components/profile/ProfileForm.tsx`
- Modify: `app.json`, `components/family/FamilyScreen.tsx`
- Test: `lib/profile/__tests__/pickAvatar.test.ts`, `components/profile/__tests__/ProfileForm.test.tsx`

**Interfaces:**
- Consumes: `AVATAR_SIZE` (Task 1); `useFamily()` → `updateProfile`, `setAvatar`, `removeAvatar` (Task 2); `MemberAvatar` with `size` (Task 2); `FormField`, `Notice`, `PrimaryButton`.
- Produces: `PickedAvatar = { ok: true; base64: string } | { ok: false; reason: 'canceled' | 'denied' | 'failed' }`; `pickAvatar(): Promise<PickedAvatar>`; `ProfileForm({ me })`.

- [ ] **Step 1: Install the packages and set the permission text**

Run: `npx expo install expo-image-picker expo-image-manipulator`

In `app.json`, add to `expo.plugins`:

```json
      [
        "expo-image-picker",
        {
          "photosPermission": "Plan-Me uses your photos so you can choose a profile picture.",
          "cameraPermission": false,
          "microphonePermission": false
        }
      ]
```

- [ ] **Step 2: Write the failing picker test**

`lib/profile/__tests__/pickAvatar.test.ts`:

```ts
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';

import { pickAvatar } from '../pickAvatar';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const saveAsync = jest.fn();
const renderAsync = jest.fn(async () => ({ saveAsync }));
const resize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn(() => ({ resize, renderAsync })) },
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

beforeEach(() => {
  jest.clearAllMocks();
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://big.heic' }] } as never);
  saveAsync.mockResolvedValue({ base64: 'SMALL' });
});

describe('pickAvatar', () => {
  it('resizes to a 256 square JPEG', async () => {
    expect(await pickAvatar()).toEqual({ ok: true, base64: 'SMALL' });
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] }),
    );
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file://big.heic');
    expect(resize).toHaveBeenCalledWith({ width: 256, height: 256 });
    expect(saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8, base64: true });
  });

  it('says when permission is refused', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false } as never);
    expect(await pickAvatar()).toEqual({ ok: false, reason: 'denied' });
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('does nothing when you cancel', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never);
    expect(await pickAvatar()).toEqual({ ok: false, reason: 'canceled' });
  });

  it('reports a photo it could not convert', async () => {
    saveAsync.mockRejectedValue(new Error('decode'));
    expect(await pickAvatar()).toEqual({ ok: false, reason: 'failed' });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx jest lib/profile/__tests__/pickAvatar.test.ts`
Expected: FAIL — `Cannot find module '../pickAvatar'`.

- [ ] **Step 4: Write pickAvatar.ts**

`lib/profile/pickAvatar.ts`:

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_SIZE } from './avatars';

export type PickedAvatar = { ok: true; base64: string } | { ok: false; reason: 'canceled' | 'denied' | 'failed' };

/** Let the user choose a photo, cropped square, and shrink it to a small JPEG for upload. */
export async function pickAvatar(): Promise<PickedAvatar> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'denied' };

  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return { ok: false, reason: 'canceled' };

  try {
    const context = ImageManipulator.manipulate(asset.uri);
    context.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
    return saved.base64 ? { ok: true, base64: saved.base64 } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
```

- [ ] **Step 5: Write the failing form test**

`components/profile/__tests__/ProfileForm.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { FamilyContext } from '@/context/FamilyProvider';
import { pickAvatar } from '@/lib/profile/pickAvatar';
import { FAKE_ME, fakeFamilyValue } from '@/test-utils/fakeFamily';

import { ProfileForm } from '../ProfileForm';

jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));
const pick = pickAvatar as jest.MockedFunction<typeof pickAvatar>;

function renderForm(family = fakeFamilyValue(), me = FAKE_ME) {
  render(
    <FamilyContext.Provider value={family}>
      <ProfileForm me={me} />
    </FamilyContext.Provider>,
  );
  return family;
}

describe('ProfileForm', () => {
  it('saves your name and tag', async () => {
    const family = renderForm();
    fireEvent.changeText(screen.getByLabelText('Your tag'), 'ali');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(family.updateProfile).toHaveBeenCalledWith({ displayName: 'Alice', tag: 'ali' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('uploads a chosen photo', async () => {
    pick.mockResolvedValueOnce({ ok: true, base64: 'SMALL' });
    const family = renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(family.setAvatar).toHaveBeenCalledWith('SMALL'));
  });

  it('explains how to allow photos', async () => {
    pick.mockResolvedValueOnce({ ok: false, reason: 'denied' });
    renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(await screen.findByText('To choose a photo, allow Plan-Me to use your photos in the Settings app.')).toBeTruthy();
  });

  it('says nothing when you cancel', async () => {
    pick.mockResolvedValueOnce({ ok: false, reason: 'canceled' });
    const family = renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(family.setAvatar).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers to remove a photo you have', async () => {
    const family = renderForm(fakeFamilyValue(), { ...FAKE_ME, avatarPath: 'user-1/a.jpg' });
    fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(family.removeAvatar).toHaveBeenCalled());
  });

  it("doesn't offer to remove a photo you don't have", () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx jest components/profile`
Expected: FAIL — `Cannot find module '../ProfileForm'`.

- [ ] **Step 7: Write ProfileForm and use it on the Family tab**

`components/profile/ProfileForm.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { BLUE } from '@/components/auth/styles';
import { MemberAvatar } from '@/components/events/MemberAvatar';
import { useFamily } from '@/context/FamilyProvider';
import type { FamilyResult, Member } from '@/lib/family/types';
import { pickAvatar } from '@/lib/profile/pickAvatar';

type Message = { tone: 'error' | 'info'; text: string } | null;

const PICK_PROBLEMS = {
  denied: 'To choose a photo, allow Plan-Me to use your photos in the Settings app.',
  failed: "Couldn't use that photo. Try another one.",
} as const;

/** Your name, tag and photo. Used on the Family tab and in Settings. */
export function ProfileForm({ me }: { me: Member }) {
  const { updateProfile, setAvatar, removeAvatar } = useFamily();
  const [name, setName] = useState(me.displayName ?? '');
  const [tag, setTag] = useState(me.tag ?? '');
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  // When the server's version arrives (or changes), show it.
  useEffect(() => {
    setName(me.displayName ?? '');
    setTag(me.tag ?? '');
  }, [me.displayName, me.tag]);

  const report = (result: FamilyResult, done: string) =>
    setMessage(result.ok ? { tone: 'info', text: done } : { tone: 'error', text: result.message });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await updateProfile({ displayName: name, tag });
    setBusy(false);
    report(result, 'Saved.');
  };

  const choosePhoto = async () => {
    setMessage(null);
    const picked = await pickAvatar();
    if (!picked.ok) {
      if (picked.reason !== 'canceled') setMessage({ tone: 'error', text: PICK_PROBLEMS[picked.reason] });
      return;
    }
    setPhotoBusy(true);
    const result = await setAvatar(picked.base64);
    setPhotoBusy(false);
    report(result, 'Photo saved.');
  };

  const clearPhoto = async () => {
    setMessage(null);
    setPhotoBusy(true);
    const result = await removeAvatar();
    setPhotoBusy(false);
    report(result, 'Photo removed.');
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>You</Text>
      <Text style={styles.hint}>Your tag lets family members add you to an event by typing @ and the tag, like @AZ.</Text>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <View style={styles.photoRow}>
        <MemberAvatar member={me} size={64} />
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose photo" disabled={photoBusy} onPress={() => void choosePhoto()} hitSlop={8}>
            <Text style={styles.link}>Choose photo</Text>
          </Pressable>
          {me.avatarPath ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" disabled={photoBusy} onPress={() => void clearPhoto()} hitSlop={8}>
              <Text style={styles.danger}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <FormField label="Your name" value={name} onChangeText={setName} kind="name" />
      <FormField label="Your tag" value={tag} onChangeText={setTag} kind="tag" />
      <PrimaryButton title="Save" onPress={save} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  hint: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  photoActions: { marginLeft: 16, gap: 10 },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
  danger: { color: '#dc3545', fontSize: 15, fontWeight: '600' },
});
```

In `components/family/FamilyScreen.tsx`: delete the `ProfileSection` function, import `ProfileForm` from `@/components/profile/ProfileForm`, and render `{me ? <ProfileForm me={me} /> : null}` where `ProfileSection` was. Remove imports that become unused. The existing FamilyScreen tests ("Your name and tag") must still pass; add `jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));` at the top of `components/family/__tests__/FamilyScreen.test.tsx` so the native picker isn't loaded.

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Check and commit**

Run: `npm run typecheck && npm run lint && npx expo-doctor`

```bash
git add package.json package-lock.json app.json lib/profile components/profile components/family
git commit -m "FEAT-002: Choose a profile photo from your library

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings screen

**Files:**
- Create: `components/settings/SettingsScreen.tsx`, `app/settings/index.tsx`
- Modify: `components/auth/SignOutButton.tsx`, `app/(tabs)/index.tsx`, `components/navigation/RootNavigator.tsx`
- Test: `components/settings/__tests__/SettingsScreen.test.tsx`, `components/auth/__tests__/SignOutButton.test.tsx` (unchanged behaviour), `components/navigation/__tests__/RootNavigator.test.tsx`

**Interfaces:**
- Consumes: `ProfileForm` (Task 3); `useAuth()` → `user.email`; `useFamily()` → `me`, `offline`; `SignOutButton`.
- Produces: route `/settings` (signed-in only), with links to `/settings/password` (Task 5) and `/settings/delete-account` (Task 6).

- [ ] **Step 1: Write the failing tests**

`components/settings/__tests__/SettingsScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext } from '@/context/FamilyProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { SettingsScreen } from '../SettingsScreen';

jest.mock('@/lib/profile/pickAvatar', () => ({ pickAvatar: jest.fn() }));

function renderSettings() {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fakeAuthClient(fakeSession('alice@test.nz')).client}>
          <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
            <FamilyContext.Provider value={fakeFamilyValue()}>
              <Slot />
            </FamilyContext.Provider>
          </EventsProvider>
        </AuthProvider>
      ),
      settings: SettingsScreen,
      'settings/password': () => <Text>Password screen</Text>,
      'settings/delete-account': () => <Text>Delete screen</Text>,
    },
    { initialUrl: '/settings' },
  );
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('Settings', () => {
  it('shows your email, profile and account actions', async () => {
    renderSettings();
    expect(await screen.findByText('alice@test.nz')).toBeTruthy();
    expect(screen.getByLabelText('Your tag')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('opens Change password', async () => {
    renderSettings();
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password screen')).toBeTruthy();
  });

  it('opens Delete account', async () => {
    renderSettings();
    fireEvent.press(await screen.findByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('Delete screen')).toBeTruthy();
  });
});
```

In `components/navigation/__tests__/RootNavigator.test.tsx`, add `settings`, `'settings/password'` and `'settings/delete-account'` stubs to its route map and add a test, following the file's existing signed-out pattern, that a signed-out user opening `/settings` lands on the sign-in screen.

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/settings components/navigation`
Expected: FAIL — `Cannot find module '../SettingsScreen'`; the signed-out `/settings` test fails (no route guard yet).

- [ ] **Step 3: Restyle SignOutButton for a list**

In `components/auth/SignOutButton.tsx`, replace the styles (the behaviour stays the same):

```ts
const styles = StyleSheet.create({
  button: { paddingVertical: 14 },
  text: { color: '#dc3545', fontSize: 16, fontWeight: '600' },
});
```

- [ ] **Step 4: Write the Settings screen**

`components/settings/SettingsScreen.tsx`:

```tsx
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/auth/Notice';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { BLUE } from '@/components/auth/styles';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { useAuth } from '@/context/AuthProvider';
import { useFamily } from '@/context/FamilyProvider';

export function SettingsScreen() {
  const { user } = useAuth();
  const { me, offline } = useFamily();
  const router = useRouter();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {offline ? <Notice tone="info">You&apos;re offline, so some changes will have to wait.</Notice> : null}
      {me ? <ProfileForm me={me} /> : null}
      <View style={styles.section}>
        <Text style={styles.heading}>Account</Text>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Change password" onPress={() => router.push('/settings/password')} style={styles.row}>
          <Text style={styles.link}>Change password</Text>
        </Pressable>
        <SignOutButton />
        <Pressable accessibilityRole="button" accessibilityLabel="Delete account" onPress={() => router.push('/settings/delete-account')} style={styles.row}>
          <Text style={styles.danger}>Delete account</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 20, paddingBottom: 40 },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#777', marginTop: 4 },
  value: { fontSize: 16, color: '#333', marginBottom: 8 },
  row: { paddingVertical: 14 },
  link: { color: BLUE, fontSize: 16, fontWeight: '600' },
  danger: { color: '#dc3545', fontSize: 16, fontWeight: '600' },
});
```

`app/settings/index.tsx`:

```tsx
import { SettingsScreen } from '@/components/settings/SettingsScreen';

export default SettingsScreen;
```

- [ ] **Step 5: Register the routes and replace the header button**

1. `components/navigation/RootNavigator.tsx` — inside the first `Stack.Protected guard={signedIn}` group, add:

```tsx
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/password" options={{ title: 'Change password' }} />
        <Stack.Screen name="settings/delete-account" options={{ title: 'Delete account' }} />
```

2. `app/(tabs)/index.tsx` — remove the `SignOutButton` import and its use in the header; import `router` from `expo-router` (the imperative router, so the screen still renders in tests without a navigator) and put this in the header instead:

```tsx
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          hitSlop={8}
          style={styles.settingsButton}
        >
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
```

with styles `settingsButton: { position: 'absolute', right: 16, bottom: 14 }` and `settingsText: { color: 'white', fontSize: 14, fontWeight: '600' }`.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add components/settings app/settings components/auth/SignOutButton.tsx "app/(tabs)/index.tsx" components/navigation
git commit -m "FEAT-002: Add Settings with your profile, sign out and account links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Change password

**Files:**
- Modify: `lib/auth/api.ts`
- Create: `app/settings/password.tsx`
- Test: `lib/auth/__tests__/api.test.ts` (or the file the existing api unit tests live in — find it with `grep -rln "updatePassword" lib/auth/__tests__`), `components/settings/__tests__/password.test.tsx`

**Interfaces:**
- Consumes: `run`, `updatePassword`, `normaliseEmail` (already in `lib/auth/api.ts` / `validation.ts`); `validateNewPassword({ password, confirmPassword })`; `useAuth()` → `client`, `user.email`.
- Produces: `changePassword(client, email, currentPassword, newPassword): Promise<AuthResult>`; route `/settings/password`.

- [ ] **Step 1: Write the failing api tests**

Add to the auth api unit test file (it already builds a fake client with `fakeAuthClient`):

```ts
describe('changePassword', () => {
  it('signs in with the current password, then sets the new one', async () => {
    const fake = fakeAuthClient(fakeSession());
    expect(await changePassword(fake.client, ' Alice@Test.NZ ', 'old-pass1', 'new-pass2')).toEqual({ ok: true });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'old-pass1' });
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass2' });
  });

  it('says the current password is wrong and changes nothing', async () => {
    const fake = fakeAuthClient(fakeSession());
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'invalid_credentials'),
    } as never);
    const result = await changePassword(fake.client, 'alice@test.nz', 'wrong', 'new-pass2');
    expect(result).toMatchObject({ ok: false, message: 'Your current password is incorrect.' });
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });

  it('asks for the current password', async () => {
    const fake = fakeAuthClient(fakeSession());
    expect(await changePassword(fake.client, 'alice@test.nz', '', 'new-pass2')).toEqual({ ok: false, message: 'Enter your current password.' });
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
```

(Import `AuthApiError` from `@supabase/supabase-js`, `changePassword` from `../api`, and `fakeAuthClient`, `fakeSession` from `@/test-utils/fakeAuthClient` if the file doesn't already.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/auth`
Expected: FAIL — `changePassword` is not exported.

- [ ] **Step 3: Add changePassword**

Append to `lib/auth/api.ts`:

```ts
/** Change the password. Supabase needs a recent sign-in (secure_password_change), so sign in with the
 * current password first; that also confirms the person knows it. */
export async function changePassword(
  client: SupabaseClient,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  if (!currentPassword) return { ok: false, message: 'Enter your current password.' };
  const check = await run(() => client.auth.signInWithPassword({ email: normaliseEmail(email), password: currentPassword }));
  if (!check.ok) {
    return check.code === 'invalid_credentials' ? { ok: false, code: check.code, message: 'Your current password is incorrect.' } : check;
  }
  return updatePassword(client, newPassword);
}
```

- [ ] **Step 4: Write the failing screen test**

`components/settings/__tests__/password.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import ChangePasswordScreen from '../../../app/settings/password';

function renderScreen(fake = fakeAuthClient(fakeSession('alice@test.nz'))) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      settings: () => <Text>Settings screen</Text>,
      'settings/password': ChangePasswordScreen,
    },
    { initialUrl: '/settings/password' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Change password', () => {
  it('checks the new password before calling the server', async () => {
    const fake = renderScreen();
    fill('Current password', 'old-pass1');
    fill('New password', 'short');
    fill('Confirm new password', 'short');
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/at least 8 characters/)).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('changes the password and says so', async () => {
    const fake = renderScreen();
    fill('Current password', 'old-pass1');
    fill('New password', 'new-pass2');
    fill('Confirm new password', 'new-pass2');
    fireEvent.press(await screen.findByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass2' }));
    expect(await screen.findByText('Your password is changed.')).toBeTruthy();
  });
});
```

The validation messages come from `validateNewPassword`; match the test's regex to the exact wording in `lib/auth/validation.ts` if it differs.

- [ ] **Step 5: Write the screen**

`app/settings/password.tsx`:

```tsx
import React, { useState } from 'react';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { useAuth } from '@/context/AuthProvider';
import { changePassword } from '@/lib/auth/api';
import { type FieldErrors, validateNewPassword } from '@/lib/auth/validation';

export default function ChangePasswordScreen() {
  const { client, user } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setMessage(null);
    const problems = validateNewPassword({ password, confirmPassword });
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const result = await changePassword(client, user?.email ?? '', current, password);
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setPassword('');
      setConfirmPassword('');
      setMessage({ tone: 'info', text: 'Your password is changed.' });
    } else {
      setMessage({ tone: 'error', text: result.message });
    }
  };

  return (
    <AuthScreen>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormField label="Current password" value={current} onChangeText={setCurrent} kind="password" />
      <FormField label="New password" value={password} onChangeText={setPassword} kind="newPassword" error={errors.password} />
      <FormField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} kind="newPassword" error={errors.confirmPassword} />
      <PrimaryButton title="Change password" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx jest lib/auth components/settings`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add lib/auth app/settings/password.tsx components/settings
git commit -m "FEAT-002: Change your password from Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Delete account

**Files:**
- Modify: `lib/auth/api.ts`, `context/EventsProvider.tsx`
- Create: `app/settings/delete-account.tsx`
- Test: the auth api unit test file, `context/__tests__/EventsProvider.test.tsx`, `components/settings/__tests__/delete-account.test.tsx`, `lib/auth/__tests__/deleteAccount.integration.test.ts`

**Interfaces:**
- Consumes: `deleteAllAvatars` (Task 1); `clearFamilyData` (`lib/family/cache.ts`); `activeClaim`, `releaseLegacyClaim` (`lib/events/legacy.ts`); `useAuth().signOut`; `GENERIC_MESSAGE` (`lib/auth/errors.ts`).
- Produces: `deleteAccount(client): Promise<AuthResult>`; `useEvents().deleteAccountAndForget(): Promise<AuthResult>`; route `/settings/delete-account`.

- [ ] **Step 1: Write the failing api and provider tests**

Add to the auth api unit test file:

```ts
describe('deleteAccount', () => {
  const rpcClient = (response: { error: { code?: string; message?: string } | null; status: number } | Error) =>
    ({
      rpc: jest.fn(async () => {
        if (response instanceof Error) throw response;
        return { data: null, ...response };
      }),
    }) as unknown as SupabaseClient;

  it('deletes the account', async () => {
    expect(await deleteAccount(rpcClient({ error: null, status: 204 }))).toEqual({ ok: true });
  });

  it('says offline when the request fails', async () => {
    expect(await deleteAccount(rpcClient(new TypeError('Network request failed')))).toEqual({
      ok: false,
      code: 'network',
      message: "You're offline. Connect to the internet to delete your account.",
    });
  });

  it('asks to try again when the server fails', async () => {
    expect(await deleteAccount(rpcClient({ error: { code: '40P01', message: 'deadlock' }, status: 500 }))).toEqual({
      ok: false,
      code: '40P01',
      message: 'Something went wrong. Please try again.',
    });
  });
});
```

Add to `context/__tests__/EventsProvider.test.tsx` (it has `setup()`, `engine()`, `FakeEngine`):

```tsx
  it('forgets everything on the phone after deleting the account', async () => {
    const { result, fake, storage } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => ({ data: null, error: null, status: 204 }));
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    await storage.setItem('planme:family:user-1', '{}');
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome).toEqual({ ok: true });
    expect(engine().cleared).toBe(true);
    expect(await storage.getItem('planme:family:user-1')).toBeNull();
    expect(fake.auth.signOut).toHaveBeenCalled();
  });

  it("keeps everything when the server can't delete the account", async () => {
    const { result, fake, storage } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    await storage.setItem('planme:family:user-1', '{}');
    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome?.ok).toBe(false);
    expect(engine().cleared).toBe(false);
    expect(await storage.getItem('planme:family:user-1')).toBe('{}');
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/auth context`
Expected: FAIL — `deleteAccount` and `deleteAccountAndForget` don't exist.

- [ ] **Step 3: Add deleteAccount**

Append to `lib/auth/api.ts` (import `GENERIC_MESSAGE` from `./errors`):

```ts
const DELETE_OFFLINE = "You're offline. Connect to the internet to delete your account.";

/** Delete the account on the server (Plan 2's delete_account): personal events go, shared events stay
 * with the family as "Former member", and the server session ends. */
export async function deleteAccount(client: SupabaseClient): Promise<AuthResult> {
  try {
    const { error, status } = await client.rpc('delete_account');
    if (!error) return { ok: true };
    if (!status) return { ok: false, code: 'network', message: DELETE_OFFLINE };
    return { ok: false, code: error.code, message: GENERIC_MESSAGE };
  } catch {
    return { ok: false, code: 'network', message: DELETE_OFFLINE };
  }
}
```

- [ ] **Step 4: Add deleteAccountAndForget to EventsProvider**

In `context/EventsProvider.tsx`:

1. Imports: `deleteAccount` from `@/lib/auth/api`; `deleteAllAvatars` from `@/lib/profile/avatars`.
2. Add to `EventsValue`, after `signOutAndForget`:

```ts
  /** Delete the account on the server, then forget this user's data on the phone and sign out. */
  deleteAccountAndForget: () => Promise<AuthResult>;
```

3. Add after `signOutAndForget` (it captures the engine and user before any await, like `signOutAndForget`):

```tsx
  const deleteAccountAndForget = useCallback(async (): Promise<AuthResult> => {
    const currentEngine = engineRef.current;
    const currentUserId = userId;
    if (!currentUserId) return { ok: false, message: 'Sign in again to do this.' };
    // Photos first: once the account is gone the app can't authenticate to Storage (ruling R4).
    await deleteAllAvatars(client, currentUserId);
    const result = await deleteAccount(client);
    if (!result.ok) return result;
    await currentEngine?.clearLocalData();
    await clearFamilyData(storage, currentUserId).catch(() => undefined);
    // The old pre-accounts events (if this account claimed them) can be offered to the next account.
    if (await activeClaim(storage, currentUserId).catch(() => null)) {
      await releaseLegacyClaim(storage, currentUserId).catch(() => undefined);
    }
    // The server already ended the session; this clears it on the phone.
    await signOut();
    return { ok: true };
  }, [client, signOut, userId, storage]);
```

4. Add `deleteAccountAndForget` to the `value` object and its dependency list. If any test file builds an `EventsValue` by hand, add `deleteAccountAndForget: jest.fn()` there.

- [ ] **Step 5: Write the failing screen test**

`components/settings/__tests__/delete-account.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Alert } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { memoryStorage } from '@/test-utils/memoryStorage';

import DeleteAccountScreen from '../../../app/settings/delete-account';

function renderScreen() {
  const fake = fakeAuthClient(fakeSession());
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
            <Slot />
          </EventsProvider>
        </AuthProvider>
      ),
      'settings/delete-account': DeleteAccountScreen,
    },
    { initialUrl: '/settings/delete-account' },
  );
  return fake;
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

describe('Delete account', () => {
  it('explains what happens', async () => {
    renderScreen();
    expect(await screen.findByText(/Your personal events and your photo are deleted/)).toBeTruthy();
    expect(screen.getByText(/Events you shared stay with your family/)).toBeTruthy();
  });

  it('asks to confirm before deleting', async () => {
    renderScreen();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(await screen.findByRole('button', { name: 'Delete my account' }));
    expect(alert).toHaveBeenCalledWith('Delete your account?', expect.any(String), expect.any(Array));
  });

  it('warns about unsynced changes', async () => {
    renderScreen();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await act(async () => {
      FakeEngine.instances[0].options.onChange({}, { state: 'idle', pending: 2, lastSyncedAt: null });
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    expect(alert.mock.calls[0][1]).toMatch(/2 changes haven't synced/);
  });
});
```

- [ ] **Step 6: Write the screen**

`app/settings/delete-account.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { Notice } from '@/components/auth/Notice';
import { authStyles } from '@/components/auth/styles';
import { useEvents } from '@/context/EventsProvider';

export default function DeleteAccountScreen() {
  const { status, deleteAccountAndForget } = useEvents();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    const result = await deleteAccountAndForget();
    setBusy(false);
    // On success the route guard takes over and shows sign-in.
    if (!result.ok) setError(result.message);
  };

  const confirm = () => {
    const n = status.pending;
    const unsynced = n > 0 ? ` ${n} ${n === 1 ? "change hasn't" : "changes haven't"} synced yet and will be lost.` : '';
    Alert.alert('Delete your account?', `This can't be undone.${unsynced}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ]);
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>
        Your personal events and your photo are deleted, and you leave your family. Events you shared stay with your family and show as
        &quot;Former member&quot;. This can&apos;t be undone.
      </Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete my account"
        accessibilityState={{ disabled: busy || status.state === 'loading', busy }}
        disabled={busy || status.state === 'loading'}
        onPress={confirm}
        style={[styles.button, busy && styles.busy]}
      >
        <Text style={styles.text}>{busy ? 'Deleting…' : 'Delete my account'}</Text>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#dc3545', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  busy: { opacity: 0.7 },
  text: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
```

- [ ] **Step 7: Write the integration test**

`lib/auth/__tests__/deleteAccount.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { adminClient, signedInPhone } from '@/test-utils/supabaseTestKit';

import { deleteAccount } from '../api';

describe('Deleting an account against local Supabase', () => {
  it('deletes the user and their personal events, and keeps shared ones', async () => {
    const alice = await signedInPhone('delete');
    const bob = await signedInPhone('delete');
    await alice.client.rpc('create_family', { p_name: 'Bye' });
    const { data: fam } = await alice.client.from('families').select('invite_code').single();
    await bob.client.rpc('join_family', { p_code: fam?.invite_code });

    const personal = randomUUID();
    const shared = randomUUID();
    await alice.client.from('events').insert([
      { id: personal, owner_id: alice.userId, visibility: 'personal', title: 'Mine', date: '2026-11-03' },
      { id: shared, owner_id: alice.userId, visibility: 'shared', title: 'Ours', date: '2026-11-03' },
    ]);

    expect(await deleteAccount(alice.client)).toEqual({ ok: true });

    const { data: user } = await adminClient.auth.admin.getUserById(alice.userId);
    expect(user.user).toBeNull();
    const { data: rows } = await adminClient.from('events').select('id, owner_id').in('id', [personal, shared]);
    expect(rows).toEqual([{ id: shared, owner_id: null }]);
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 9: Check and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add lib/auth context app/settings/delete-account.tsx components/settings
git commit -m "FEAT-002: Delete your account from Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Remove the Expo template (BUG-002)

**Files:**
- Delete: `app/modal.tsx`, `components/hello-wave.tsx`, `components/parallax-scroll-view.tsx`, `components/external-link.tsx`, `components/ui/collapsible.tsx`, `components/themed-text.tsx`, `components/themed-view.tsx`, `hooks/use-theme-color.ts`, `assets/images/react-logo.png`, `assets/images/react-logo@2x.png`, `assets/images/react-logo@3x.png`, `assets/images/partial-react-logo.png`, `scripts/reset-project.js`
- Modify: `components/navigation/RootNavigator.tsx`, `components/navigation/__tests__/RootNavigator.test.tsx`, `package.json`, `docs/registry/BUG-002-*.md`, `docs/registry/INDEX.md`

**Interfaces:** none.

- [ ] **Step 1: Confirm each file is unused before deleting it**

For each file in the Delete list (except `app/modal.tsx` and `scripts/reset-project.js`), run `grep -rn "<file name without extension>" app components context lib hooks constants --include=*.ts --include=*.tsx` and delete it only when nothing outside the template files themselves uses it. Keep anything still used (for example `hooks/use-color-scheme*` and `constants/theme.ts`, which the tab layout uses) and say which you kept in your report.

- [ ] **Step 2: Remove the modal route**

- `components/navigation/RootNavigator.tsx`: delete the `<Stack.Screen name="modal" … />` line.
- `components/navigation/__tests__/RootNavigator.test.tsx`: remove the `modal` stub; change any test that opens `/modal` to open `/settings` instead (the signed-out redirect test written in Task 4 may already cover it — keep one).

- [ ] **Step 3: Delete the files and the script**

Delete the confirmed files. In `package.json`, remove the `"reset-project": "node ./scripts/reset-project.js"` script.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npx expo export --platform ios --output-dir "$TEMP/planme-export"`
Expected: all pass; the export builds (it fails if a deleted asset is still referenced). Delete the export folder afterwards.

- [ ] **Step 5: Close BUG-002**

In `docs/registry/BUG-002-*.md`: Status → `Done`, Updated → `12/10/2026`, add under Details: `- Fixed in FEAT-002 Plan 6: Explore became Family (Plan 5); modal, template components, images and reset script removed.` Update its row in `docs/registry/INDEX.md` (status and Updated).

- [ ] **Step 6: Commit**

```bash
git add -A app components hooks assets scripts package.json docs/registry
git commit -m "BUG-002: Remove the Expo template screens and files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and hand-over to FEAT-003

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-accounts-family-sharing-design.md`, `docs/specs/architecture.md`, `docs/specs/features.md`, `docs/specs/infrastructure.md`, `docs/guides/supabase-hosted-setup.md`, `docs/guides/app-store-release.md`, `docs/registry/FEAT-002-accounts-family-sharing.md`, `docs/registry/FEAT-003-*.md`, `docs/registry/INDEX.md`, `docs/superpowers/plans/2026-10-06-feat-002-roadmap.md`, `docs/README.md`, `CHANGELOG.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the spec**

- §2: add a row `| D13 | Profile photos | Private Storage bucket, 256 × 256 JPEG, readable by the owner and their current family (signed URLs) |`.
- §3: under `profiles`, note `avatar_url` holds the Storage path `<user id>/<uuid>.jpg`.
- §4: add a bullet: `**avatars bucket (Storage):** owners insert, update and delete files in their own folder; the owner and current family members can read them. 1 MB limit, JPEG only.`
- §5: change the `settings/` route to `settings/` (profile, tag, photo, change password, sign out, delete account); add `lib/profile/` (`avatars.ts`, `pickAvatar.ts`) and `components/settings/`, `components/profile/`.
- §7: add `- Deleting the account offline → "You're offline. Connect to the internet to delete your account." Nothing on the phone changes.` and `- Changing the password asks for the current one (Supabase requires a recent sign-in).`

- [ ] **Step 2: Update the other docs**

- `docs/specs/architecture.md`: list the Plan 6 files from the table at the top of this plan as `(built, Plan 6)`; remove the template files from any list.
- `docs/specs/features.md`: Accounts heading → `### Accounts — FEAT-002 (built; device testing next)`; add bullets for Settings (photo, change password, sign out, delete account).
- `docs/specs/infrastructure.md`: add the `avatars` Storage bucket (created by migration `20261012120000_avatars.sql`; no dashboard setup) and that CI starts Storage for integration tests.
- `docs/guides/supabase-hosted-setup.md`: note that `supabase db push` creates the bucket and its policies; add phone checklist items:
  - `- [ ] Settings → Choose photo → allow photos → pick one → it shows in Settings and, on the other phone, on the Family tab and on events tagged with you`
  - `- [ ] Remove photo → the circle with your tag comes back`
  - `- [ ] Change password with a wrong current password → "Your current password is incorrect."; with the right one → "Your password is changed." and you can sign in with it`
  - `- [ ] Delete account (on a test account) → confirm → sign-in screen; on the other phone the account's shared events show "Former member"; signing in with the old email fails`
- `docs/guides/app-store-release.md`: in the App Privacy / review notes section, add: account deletion is in Settings → Delete account (guideline 5.1.1(v)); data collected: email address, name, photos (user content, linked to the user, used for app functionality); photo library permission text "Plan-Me uses your photos so you can choose a profile picture."; no camera or microphone use.
- `docs/registry/FEAT-002-accounts-family-sharing.md`: Status → `In testing` (device checklist next), Updated → `12/10/2026`. `docs/registry/FEAT-003-*.md`: Updated → `12/10/2026`, add `- Unblocked by FEAT-002 Plan 6: in-app account deletion and settings are built; App Privacy answers are in the release guide.` Update both rows in `INDEX.md`.
- Roadmap: Plan 6 row → `[6](2026-10-12-feat-002-plan-6-settings.md)`, `Written`; remove the three Plan 6 bullets under "Notes for later plans" (all handled here).
- `docs/README.md` Implementation plans table: add `| 12/10/2026 | [Plan 6: settings, photos and account deletion](superpowers/plans/2026-10-12-feat-002-plan-6-settings.md) |`.
- `CHANGELOG.md`: under the unreleased section, add one line each for family sharing (Plan 5), settings and profile photos, account deletion, and BUG-002 (template removed), following the file's existing style.

- [ ] **Step 3: Check and commit**

Run: `npm run typecheck && npm test`

```bash
git add docs CHANGELOG.md
git commit -m "FEAT-002: Document settings, photos and account deletion; hand over to FEAT-003

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
