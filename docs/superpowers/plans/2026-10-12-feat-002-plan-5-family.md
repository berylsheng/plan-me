# FEAT-002 Plan 5: family screens and sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user create or join a family, share events with it, tag family members on events, map the old `@AZ`/`@GS` tags to members once, and manage the family (invite code, members, leaving). Also close the Plan 4 follow-ups listed in the roadmap.

**Architecture:** No database changes. Plan 2's tables, row-level security and functions (`create_family`, `join_family`, `leave_family`, `remove_member`, `regenerate_invite_code`) already enforce every rule. `lib/family/` wraps those calls and turns errors into plain messages. `context/FamilyProvider.tsx` (inside `EventsProvider`) keeps the user's family, members and a tag → member lookup, cached per user for offline start. Events gain a visibility the planner can set and member ids resolved from `@tags`. The sync engine is unchanged apart from counting refused changes (shown as a notice) and the Plan 4 follow-ups.

**Tech Stack:** Expo SDK 54, expo-router 6, React 19.1, React Native 0.81, TypeScript (strict), supabase-js 2.117, Jest (jest-expo) with @testing-library/react-native 12.9, local Supabase (Docker) for integration tests.

**Spec:** [2026-10-06-accounts-family-sharing-design.md](../specs/2026-10-06-accounts-family-sharing-design.md) — §2 (D3–D9, D11), §4, §5 (FamilyProvider, Family tab, event UI), §6.7 (tag mapping), §7 (errors).

## Global Constraints

- Read the Expo SDK 54 docs (https://docs.expo.dev/versions/v54.0.0/) before adding any package. This plan adds none: `Share`, `Alert`, `Modal` and `AppState` come from `react-native`.
- No database migrations in this plan. Never connect to a hosted Supabase project; integration tests run against the local stack only (`npm run test:integration`).
- The service-role key appears only in test code (`test-utils/supabaseTestKit.ts`, `jest.integration.setup.js`). Never in `app/`, `components/`, `context/` or `lib/`.
- Never log or display `AuthResult.code`. Show `message` strings only.
- Family name: 1–50 characters after trimming. Display name: up to 50 characters. Tag: `^[A-Z]{2,4}$`, unique within a family. Invite code: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O, 1/I).
- Default visibility is personal (D5). Only an event's creator can make a shared event personal (D6). Any family member can edit or delete a shared event (D4). Leaving keeps the leaver's shared events with the family (D7).
- One family per user, joined by invite code (D3). The owner removes members and regenerates the code (D8).
- Shared events show the creator's display name. Profiles hold no email, so the fallback is `@TAG`, then "Member"; a creator no longer in the family shows as "Former member" (D9, adjusted — see ruling R1 below).
- Local data is deleted only by a user-initiated sign-out (`signOutAndForget`).
- Dates in docs: dd/mm/yyyy. NZ English in all copy.
- Test names containing an apostrophe use double quotes.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Rulings made while writing this plan

- **R1 — creator name fallback:** `profiles` has no email column and other members' emails aren't readable, so D9's "falls back to email" becomes "falls back to @TAG, then 'Member'".
- **R2 — avatars:** the avatars storage bucket and photo upload move to Plan 6 (settings: profile, tag, avatar). Plan 5 shows each member as a coloured circle with their tag or initial.
- **R3 — profile editing now:** a tag is needed before `@tag` can mean a member, so the Family tab gets a small "You" section (name and tag). Plan 6 settings will reuse `updateProfile`.
- **R4 — old tags stay recognised:** the parser recognises the family's tags plus `AZ` and `GS`. Unmapped `@AZ`/`@GS` keep showing their icons (as today) until the user maps them, instead of being left in the event name.
- **R5 — family members on one route:** members are listed on the Family tab itself; there is no separate `family/members` route.

## Review Focus

1. **Editing an event tagged with a member who has no tag, or who has left the family** → saving the edit keeps that member on the event (the text can't show them). Test: Task 4, `withPeople` "keeps members the text can't show".
2. **Typing `@AZ` when no family member has tag AZ** → the tag is kept on the event (shown with the AZ icon), not lost and not left in the name. Test: Task 4, `resolvePeople` "keeps a tag no member has".
3. **Family actions while offline** → a clear "You're offline" message and nothing half-done; the tab still shows the cached family. Tests: Task 1 api "says offline when the request can't be sent"; Task 2 provider "keeps the cached family when the server can't be reached".
4. **Sharing an event after being removed from the family (or before joining one)** → the server refuses it, the event comes back as its last saved version, and a notice says so. Test: Task 3 integration "refuses a shared event from someone not in a family".
5. **Switching users on one phone** → user B never sees user A's family, members or tag answers, even for one render. Tests: Task 2 provider "never shows the previous user's family"; Task 7 prompt answers keyed per user.

---

## File structure

| File | Task | Responsibility |
|---|---|---|
| `lib/family/types.ts` | 1 | `Member`, `Family`, `FamilySnapshot`, `FamilyResult` |
| `lib/family/validation.ts` | 1 | Invite code, tag and name rules and formatting |
| `lib/family/api.ts` | 1 | Supabase calls for the family and profile; error → message |
| `lib/family/cache.ts` | 2 | Per-user cache of the family snapshot; keys; forget on sign-out |
| `context/FamilyProvider.tsx` | 2 | React access to the family; refresh; actions |
| `test-utils/fakeEngine.ts` | 2 | A fake `SyncEngineLike` for provider and screen tests |
| `test-utils/fakeFamily.ts` | 2 | A ready-made `FamilyValue` for screen tests |
| `lib/events/rows.ts` | 3 | `EventInput`; visibility in edits |
| `lib/events/syncEngine.ts` | 3, 8, 9 | Refused count; `create` reports whether it saved; 5xx cap; load retry |
| `components/events/SyncBadge.tsx` | 3 | `RefusedNotice` |
| `lib/family/tags.ts` | 4 | Tags ↔ members, labels |
| `components/events/ShareToggle.tsx` | 4 | Personal / Shared switch |
| `components/events/MemberAvatar.tsx` | 4 | Coloured member circle |
| `app/(tabs)/index.tsx` | 3, 4, 7 | Planner: toggle, avatars, shared label, notices |
| `components/auth/FormField.tsx` | 5 | `plain`, `code`, `tag` field kinds |
| `app/family/create.tsx`, `app/family/join.tsx` | 5 | Create and join forms |
| `components/navigation/RootNavigator.tsx` | 5 | Register the family routes as signed-in only |
| `components/family/FamilyScreen.tsx`, `app/(tabs)/family.tsx` | 6 | Family tab: you, family, code, members, leave |
| `app/(tabs)/_layout.tsx`, `components/ui/icon-symbol.tsx` | 6 | Family tab replaces Explore |
| `lib/family/tagMapping.ts`, `components/family/TagMappingPrompt.tsx` | 7 | "Who is @AZ?" |
| `lib/events/legacy.ts`, `context/EventsProvider.tsx` | 8 | Plan 4 follow-ups: claim writes in order; queued only after a save |
| `lib/events/outbox.ts`, `jest.integration.config.js` | 9 | Plan 4 follow-ups: report the failing op; clean test exit |
| docs | 10 | Spec, features, architecture, guide, registry, roadmap |

---

### Task 1: Family data access

**Files:**
- Create: `lib/family/types.ts`, `lib/family/validation.ts`, `lib/family/api.ts`
- Test: `lib/family/__tests__/validation.test.ts`, `lib/family/__tests__/api.test.ts`, `lib/family/__tests__/api.integration.test.ts`

**Interfaces:**
- Consumes: `classifyFailure(error, status): 'network' | 'auth' | 'rejected'` from `lib/events/failures.ts`; test kit `signedInPhone(label)` → `{ client, setOnline, email, userId }` from `test-utils/supabaseTestKit.ts`.
- Produces:
  - `Member = { id: string; displayName: string | null; tag: string | null; joinedAt: string | null }`
  - `Family = { id: string; name: string; ownerId: string; inviteCode: string }`
  - `FamilySnapshot = { me: Member; family: Family | null; members: Member[] }` (`me` is always in `members`)
  - `FamilyResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string; offline: boolean }`
  - `FAMILY_MESSAGES` (constant strings below)
  - `fetchFamily(client, userId): Promise<FamilyResult<FamilySnapshot>>`
  - `createFamily(client, name)`, `joinFamily(client, code)`, `leaveFamily(client)`, `removeMember(client, memberId)`: `Promise<FamilyResult>`
  - `regenerateInviteCode(client): Promise<FamilyResult<string>>`
  - `ProfileChanges = { displayName: string; tag: string }`; `updateProfile(client, userId, changes): Promise<FamilyResult>`
  - `familyApi` (object of the seven functions) and `FamilyApi = typeof familyApi`
  - validation: `normaliseInviteCode`, `formatInviteCode`, `inviteCodeProblem`, `normaliseTag`, `tagProblem`, `familyNameProblem`, `displayNameProblem`

- [ ] **Step 1: Write the failing validation tests**

`lib/family/__tests__/validation.test.ts`:

```ts
import {
  displayNameProblem,
  familyNameProblem,
  formatInviteCode,
  inviteCodeProblem,
  normaliseInviteCode,
  normaliseTag,
  tagProblem,
} from '../validation';

describe('invite codes', () => {
  it.each([
    ['k7qm-2xwp', 'K7QM2XWP'],
    [' K7QM 2XWP ', 'K7QM2XWP'],
  ])('normalises %j', (input, expected) => {
    expect(normaliseInviteCode(input)).toBe(expected);
  });

  it('asks for a code when there is none', () => {
    expect(inviteCodeProblem('')).toBe('Enter the invite code.');
  });

  it.each(['K7QM2XW', 'K7QM2XWP9', 'K7QM2XW0', 'K7QM2XWI'])('rejects %j', code => {
    expect(inviteCodeProblem(code)).toBe('Invite codes are 8 letters and numbers, like K7QM-2XWP.');
  });

  it('accepts a valid code', () => {
    expect(inviteCodeProblem('K7QM2XWP')).toBeNull();
  });

  it('shows a code in two groups of four', () => {
    expect(formatInviteCode('K7QM2XWP')).toBe('K7QM-2XWP');
  });
});

describe('tags', () => {
  it.each([
    ['@az', 'AZ'],
    [' gs ', 'GS'],
    ['', null],
    ['  ', null],
  ])('normalises %j', (input, expected) => {
    expect(normaliseTag(input)).toBe(expected);
  });

  it.each(['A', 'ABCDE', 'A1'])('rejects %j', tag => {
    expect(tagProblem(tag)).toBe('A tag is 2 to 4 letters, like AZ.');
  });

  it('allows no tag', () => {
    expect(tagProblem(null)).toBeNull();
  });
});

describe('names', () => {
  it('asks for a family name', () => {
    expect(familyNameProblem('   ')).toBe('Enter a name for your family.');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(familyNameProblem('😀'.repeat(50))).toBeNull();
    expect(familyNameProblem('a'.repeat(51))).toBe('Keep the name to 50 characters or fewer.');
  });

  it('limits a display name to 50 characters', () => {
    expect(displayNameProblem('a'.repeat(51))).toBe('Keep your name to 50 characters or fewer.');
    expect(displayNameProblem('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/family/__tests__/validation.test.ts`
Expected: FAIL — `Cannot find module '../validation'`.

- [ ] **Step 3: Write the types and validation**

`lib/family/types.ts`:

```ts
/** A person in the user's family (the user included), as their profile row says. */
export type Member = {
  id: string;
  displayName: string | null;
  tag: string | null;
  joinedAt: string | null;
};

export type Family = { id: string; name: string; ownerId: string; inviteCode: string };

/** What the phone knows about the user's family. `me` is always among `members`. */
export type FamilySnapshot = { me: Member; family: Family | null; members: Member[] };

/** The outcome of a family action: a value, or a message to show (and whether we were offline). */
export type FamilyResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string; offline: boolean };
```

`lib/family/validation.ts`:

```ts
// The rules the database also enforces (profiles, families and join_family in supabase/migrations).

const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const TAG = /^[A-Z]{2,4}$/;
const MAX_NAME = 50;

const length = (text: string) => Array.from(text).length;

/** What people type or paste: any case, with spaces or a dash. */
export const normaliseInviteCode = (input: string): string => input.toUpperCase().replace(/[\s-]/g, '');

export const formatInviteCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export function inviteCodeProblem(code: string): string | null {
  if (!code) return 'Enter the invite code.';
  if (!INVITE_CODE.test(code)) return 'Invite codes are 8 letters and numbers, like K7QM-2XWP.';
  return null;
}

/** "@az" → "AZ"; blank → no tag. */
export function normaliseTag(input: string): string | null {
  const tag = input.trim().replace(/^@/, '').toUpperCase();
  return tag === '' ? null : tag;
}

export function tagProblem(tag: string | null): string | null {
  return tag !== null && !TAG.test(tag) ? 'A tag is 2 to 4 letters, like AZ.' : null;
}

export function familyNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for your family.';
  if (length(trimmed) > MAX_NAME) return 'Keep the name to 50 characters or fewer.';
  return null;
}

export function displayNameProblem(name: string): string | null {
  return length(name.trim()) > MAX_NAME ? 'Keep your name to 50 characters or fewer.' : null;
}
```

- [ ] **Step 4: Run the validation tests**

Run: `npx jest lib/family/__tests__/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing api unit tests**

`lib/family/__tests__/api.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { createFamily, FAMILY_MESSAGES, joinFamily, regenerateInviteCode, updateProfile } from '../api';

type Response = { data: unknown; error: { code?: string; message?: string } | null; status: number };

function rpcClient(response: Response | Error) {
  const rpc = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const ok = (data: unknown): Response => ({ data, error: null, status: 200 });

describe('joinFamily', () => {
  it.each([
    ['invalid_code', FAMILY_MESSAGES.codeNotFound],
    ['rate_limited', FAMILY_MESSAGES.rateLimited],
    ['already_in_family', FAMILY_MESSAGES.alreadyInFamily],
  ])('explains %s', async (status, message) => {
    const { client } = rpcClient(ok(status));
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message, offline: false });
  });

  it('sends the normalised code', async () => {
    const { client, rpc } = rpcClient(ok('joined'));
    expect(await joinFamily(client, 'k7qm-2xwp')).toEqual({ ok: true, value: undefined });
    expect(rpc).toHaveBeenCalledWith('join_family', { p_code: 'K7QM2XWP' });
  });

  it('checks the code before calling the server', async () => {
    const { client, rpc } = rpcClient(ok('joined'));
    expect(await joinFamily(client, 'abc')).toEqual({
      ok: false,
      message: 'Invite codes are 8 letters and numbers, like K7QM-2XWP.',
      offline: false,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says offline when the request can't be sent", async () => {
    const { client } = rpcClient(new TypeError('Network request failed'));
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });

  it('says offline when supabase-js reports a failed fetch', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 });
    expect(await joinFamily(client, 'K7QM2XWP')).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });
});

describe('createFamily', () => {
  it('explains a raised already_in_family', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'P0001', message: 'already_in_family' }, status: 400 });
    expect(await createFamily(client, 'Smiths')).toEqual({ ok: false, message: FAMILY_MESSAGES.alreadyInFamily, offline: false });
  });

  it('sends the trimmed name', async () => {
    const { client, rpc } = rpcClient(ok('fam-1'));
    await createFamily(client, '  Smiths ');
    expect(rpc).toHaveBeenCalledWith('create_family', { p_name: 'Smiths' });
  });
});

describe('regenerateInviteCode', () => {
  it('returns the new code', async () => {
    const { client } = rpcClient(ok('P3RT8VWX'));
    expect(await regenerateInviteCode(client)).toEqual({ ok: true, value: 'P3RT8VWX' });
  });

  it('explains not_family_owner', async () => {
    const { client } = rpcClient({ data: null, error: { code: 'P0001', message: 'not_family_owner' }, status: 400 });
    expect(await regenerateInviteCode(client)).toEqual({ ok: false, message: FAMILY_MESSAGES.notOwner, offline: false });
  });
});

describe('updateProfile', () => {
  function tableClient(response: Response) {
    const eq = jest.fn(async () => response);
    const update = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ update }));
    return { client: { from } as unknown as SupabaseClient, update, eq };
  }

  it('saves a trimmed name and a normalised tag', async () => {
    const { client, update, eq } = tableClient(ok(null));
    expect(await updateProfile(client, 'user-1', { displayName: ' Alice ', tag: '@al' })).toEqual({ ok: true, value: undefined });
    expect(update).toHaveBeenCalledWith({ display_name: 'Alice', tag: 'AL' });
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('clears an empty name and tag', async () => {
    const { client, update } = tableClient(ok(null));
    await updateProfile(client, 'user-1', { displayName: '', tag: '' });
    expect(update).toHaveBeenCalledWith({ display_name: null, tag: null });
  });

  it('says which tag is taken', async () => {
    const { client } = tableClient({ data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 });
    expect(await updateProfile(client, 'user-1', { displayName: 'Alice', tag: 'BE' })).toEqual({
      ok: false,
      message: 'Someone in your family already uses @BE.',
      offline: false,
    });
  });

  it('checks the tag before calling the server', async () => {
    const { client, update } = tableClient(ok(null));
    expect(await updateProfile(client, 'user-1', { displayName: 'Alice', tag: 'A' })).toEqual({
      ok: false,
      message: 'A tag is 2 to 4 letters, like AZ.',
      offline: false,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx jest lib/family/__tests__/api.test.ts`
Expected: FAIL — `Cannot find module '../api'`.

- [ ] **Step 7: Write the api**

`lib/family/api.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure } from '@/lib/events/failures';

import type { Family, FamilyResult, FamilySnapshot, Member } from './types';
import { displayNameProblem, familyNameProblem, inviteCodeProblem, normaliseInviteCode, normaliseTag, tagProblem } from './validation';

export const FAMILY_MESSAGES = {
  offline: "You're offline. Try again when you're connected.",
  signInAgain: 'Sign in again to do this.',
  unknown: 'Something went wrong. Try again.',
  alreadyInFamily: "You're already in a family. Leave it first.",
  notOwner: 'Only the family owner can do that.',
  codeNotFound: 'Code not found. Check it with the person who sent it.',
  rateLimited: 'Too many tries. Try again in an hour.',
} as const;

type DbError = { code?: string; message?: string } | null;
type Response<T> = { data: T | null; error: DbError; status: number };

const failed = (message: string, offline = false): FamilyResult<never> => ({ ok: false, message, offline });

function fromError(error: DbError, status: number): FamilyResult<never> {
  const kind = classifyFailure(error, status);
  if (kind === 'network') return failed(FAMILY_MESSAGES.offline, true);
  if (kind === 'auth') return failed(FAMILY_MESSAGES.signInAgain);
  // The family functions raise these names as the exception message.
  if (error?.message === 'already_in_family') return failed(FAMILY_MESSAGES.alreadyInFamily);
  if (error?.message === 'not_family_owner') return failed(FAMILY_MESSAGES.notOwner);
  return failed(FAMILY_MESSAGES.unknown);
}

/** Run one request. A thrown error means the request couldn't be sent. */
async function run<T>(call: () => PromiseLike<Response<T>>): Promise<FamilyResult<T | null>> {
  try {
    const { data, error, status } = await call();
    return error ? fromError(error, status) : { ok: true, value: data };
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
}

const done = (result: FamilyResult<unknown>): FamilyResult => (result.ok ? { ok: true, value: undefined } : result);

const PROFILE_COLUMNS = 'id, display_name, tag, family_id, joined_family_at';
type ProfileRow = { id: string; display_name: string | null; tag: string | null; family_id: string | null; joined_family_at: string | null };
type FamilyRow = { id: string; name: string; owner_id: string; invite_code: string };

const toMember = (row: ProfileRow): Member => ({ id: row.id, displayName: row.display_name, tag: row.tag, joinedAt: row.joined_family_at });
const toFamily = (row: FamilyRow): Family => ({ id: row.id, name: row.name, ownerId: row.owner_id, inviteCode: row.invite_code });

/** The user's profile, family and fellow members (longest-standing first). */
export async function fetchFamily(client: SupabaseClient, userId: string): Promise<FamilyResult<FamilySnapshot>> {
  const mine = await run<ProfileRow>(() => client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single());
  if (!mine.ok) return mine;
  if (!mine.value) return failed(FAMILY_MESSAGES.unknown);
  const me = toMember(mine.value);
  const familyId = mine.value.family_id;
  if (!familyId) return { ok: true, value: { me, family: null, members: [me] } };

  const [family, people] = await Promise.all([
    run<FamilyRow>(() => client.from('families').select('id, name, owner_id, invite_code').eq('id', familyId).single()),
    run<ProfileRow[]>(() => client.from('profiles').select(PROFILE_COLUMNS).eq('family_id', familyId).order('joined_family_at')),
  ]);
  if (!family.ok) return family;
  if (!people.ok) return people;
  if (!family.value) return failed(FAMILY_MESSAGES.unknown);
  const members = (people.value ?? []).map(toMember);
  return {
    ok: true,
    value: { me, family: toFamily(family.value), members: members.some(m => m.id === me.id) ? members : [me, ...members] },
  };
}

export async function createFamily(client: SupabaseClient, name: string): Promise<FamilyResult> {
  const problem = familyNameProblem(name);
  if (problem) return failed(problem);
  return done(await run(() => client.rpc('create_family', { p_name: name.trim() })));
}

export async function joinFamily(client: SupabaseClient, codeInput: string): Promise<FamilyResult> {
  const code = normaliseInviteCode(codeInput);
  const problem = inviteCodeProblem(code);
  if (problem) return failed(problem);
  const result = await run<string>(() => client.rpc('join_family', { p_code: code }));
  if (!result.ok) return result;
  switch (result.value) {
    case 'joined':
      return { ok: true, value: undefined };
    case 'invalid_code':
      return failed(FAMILY_MESSAGES.codeNotFound);
    case 'rate_limited':
      return failed(FAMILY_MESSAGES.rateLimited);
    case 'already_in_family':
      return failed(FAMILY_MESSAGES.alreadyInFamily);
    default:
      return failed(FAMILY_MESSAGES.unknown);
  }
}

export const leaveFamily = async (client: SupabaseClient): Promise<FamilyResult> =>
  done(await run(() => client.rpc('leave_family')));

export const removeMember = async (client: SupabaseClient, memberId: string): Promise<FamilyResult> =>
  done(await run(() => client.rpc('remove_member', { p_user: memberId })));

export async function regenerateInviteCode(client: SupabaseClient): Promise<FamilyResult<string>> {
  const result = await run<string>(() => client.rpc('regenerate_invite_code'));
  if (!result.ok) return result;
  return result.value ? { ok: true, value: result.value } : failed(FAMILY_MESSAGES.unknown);
}

export type ProfileChanges = { displayName: string; tag: string };

/** Change the user's name and tag. Tags are unique within a family. */
export async function updateProfile(client: SupabaseClient, userId: string, changes: ProfileChanges): Promise<FamilyResult> {
  const tag = normaliseTag(changes.tag);
  const problem = displayNameProblem(changes.displayName) ?? tagProblem(tag);
  if (problem) return failed(problem);
  try {
    const { error, status } = await client
      .from('profiles')
      .update({ display_name: changes.displayName.trim() || null, tag })
      .eq('id', userId);
    if (!error) return { ok: true, value: undefined };
    if (error.code === '23505' && tag) return failed(`Someone in your family already uses @${tag}.`);
    return fromError(error, status);
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
}

export const familyApi = { fetchFamily, createFamily, joinFamily, leaveFamily, removeMember, regenerateInviteCode, updateProfile };
export type FamilyApi = typeof familyApi;
```

- [ ] **Step 8: Run the unit tests**

Run: `npx jest lib/family`
Expected: PASS (validation and api).

- [ ] **Step 9: Write the integration tests**

`lib/family/__tests__/api.integration.test.ts`:

```ts
import { signedInPhone } from '@/test-utils/supabaseTestKit';

import {
  createFamily,
  FAMILY_MESSAGES,
  fetchFamily,
  joinFamily,
  leaveFamily,
  regenerateInviteCode,
  removeMember,
  updateProfile,
} from '../api';
import { formatInviteCode } from '../validation';

async function familyOfTwo() {
  const alice = await signedInPhone('fam');
  const bob = await signedInPhone('fam');
  expect(await createFamily(alice.client, 'Smiths')).toEqual({ ok: true, value: undefined });
  const snapshot = await fetchFamily(alice.client, alice.userId);
  if (!snapshot.ok || !snapshot.value.family) throw new Error('no family');
  // People type codes with a dash and in lower case.
  const typed = formatInviteCode(snapshot.value.family.inviteCode).toLowerCase();
  expect(await joinFamily(bob.client, typed)).toEqual({ ok: true, value: undefined });
  return { alice, bob, code: snapshot.value.family.inviteCode };
}

describe('Family api against local Supabase', () => {
  it('creates a family with you as owner', async () => {
    const alice = await signedInPhone('fam');
    await createFamily(alice.client, '  Smiths ');
    const result = await fetchFamily(alice.client, alice.userId);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.family).toMatchObject({ name: 'Smiths', ownerId: alice.userId });
    expect(result.value.family?.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(result.value.members.map(m => m.id)).toEqual([alice.userId]);
  });

  it('lets a second person join with the code, and both see two members', async () => {
    const { alice, bob } = await familyOfTwo();
    for (const phone of [alice, bob]) {
      const result = await fetchFamily(phone.client, phone.userId);
      if (!result.ok) throw new Error(result.message);
      expect(result.value.members.map(m => m.id)).toEqual([alice.userId, bob.userId]);
    }
  });

  it('explains a wrong code and a second family', async () => {
    const { bob } = await familyOfTwo();
    const carol = await signedInPhone('fam');
    expect(await joinFamily(carol.client, 'ZZZZZZZZ')).toEqual({ ok: false, message: FAMILY_MESSAGES.codeNotFound, offline: false });
    expect(await createFamily(bob.client, 'Other')).toEqual({ ok: false, message: FAMILY_MESSAGES.alreadyInFamily, offline: false });
  });

  it('stops guessing after five wrong codes', async () => {
    const carol = await signedInPhone('fam');
    for (let i = 0; i < 5; i++) await joinFamily(carol.client, 'ZZZZZZZZ');
    expect(await joinFamily(carol.client, 'ZZZZZZZZ')).toEqual({ ok: false, message: FAMILY_MESSAGES.rateLimited, offline: false });
  });

  it('lets only the owner make a new code', async () => {
    const { alice, bob, code } = await familyOfTwo();
    expect(await regenerateInviteCode(bob.client)).toEqual({ ok: false, message: FAMILY_MESSAGES.notOwner, offline: false });
    const fresh = await regenerateInviteCode(alice.client);
    if (!fresh.ok) throw new Error(fresh.message);
    expect(fresh.value).not.toBe(code);
  });

  it('keeps tags unique within the family', async () => {
    const { alice, bob } = await familyOfTwo();
    expect(await updateProfile(alice.client, alice.userId, { displayName: 'Alice', tag: 'al' })).toEqual({ ok: true, value: undefined });
    expect(await updateProfile(bob.client, bob.userId, { displayName: 'Bob', tag: 'AL' })).toEqual({
      ok: false,
      message: 'Someone in your family already uses @AL.',
      offline: false,
    });
  });

  it('lets the owner remove a member, and a member leave', async () => {
    const { alice, bob } = await familyOfTwo();
    expect(await removeMember(alice.client, bob.userId)).toEqual({ ok: true, value: undefined });
    const bobView = await fetchFamily(bob.client, bob.userId);
    expect(bobView.ok && bobView.value.family).toBeNull();

    expect(await leaveFamily(alice.client)).toEqual({ ok: true, value: undefined });
    const aliceView = await fetchFamily(alice.client, alice.userId);
    expect(aliceView.ok && aliceView.value.family).toBeNull();
  });

  it("says offline when the phone can't reach the server", async () => {
    const alice = await signedInPhone('fam');
    alice.setOnline(false);
    expect(await fetchFamily(alice.client, alice.userId)).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });
});
```

- [ ] **Step 10: Run the integration tests**

Run: `npm run test:integration -- lib/family`
Expected: PASS (8 tests). Local Supabase must be running (`npm run db:start`).

- [ ] **Step 11: Check and commit**

Run: `npm run typecheck && npm run lint && npx jest lib/family`

```bash
git add lib/family
git commit -m "FEAT-002: Add family and profile calls with plain error messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: FamilyProvider

**Files:**
- Create: `lib/family/cache.ts`, `context/FamilyProvider.tsx`, `test-utils/fakeEngine.ts`, `test-utils/fakeFamily.ts`
- Modify: `context/EventsProvider.tsx` (add `refresh`; forget family data on sign-out), `app/_layout.tsx`
- Test: `lib/family/__tests__/cache.test.ts`, `context/__tests__/FamilyProvider.test.tsx`, `context/__tests__/EventsProvider.test.tsx` (one new test)

**Interfaces:**
- Consumes: Task 1 (`familyApi`, `FamilyApi`, `FamilyResult`, `FamilySnapshot`, `Member`, `Family`, `FAMILY_MESSAGES`, `ProfileChanges`); `useAuth()` → `{ client, user, session }`; `useEvents()`; `KeyValueStorage` from `lib/events/store.ts`; `SyncEngineLike`, `SyncEngineOptions` from `lib/events/syncEngine.ts`.
- Produces:
  - `familyKeys(userId) → { family: 'planme:family:<id>', tagAnswers: 'planme:tagMap:<id>' }`, `readFamilyCache`, `writeFamilyCache`, `clearFamilyData(storage, userId)`
  - `FamilyValue` (below), `FamilyContext`, `FamilyProvider({ children, storage?, api? })`, `useFamily()`
  - `useEvents().refresh(): void` (asks the engine for a full re-fetch)
  - `test-utils/fakeEngine.ts`: `FakeEngine` (records every call; `FakeEngine.instances`, `FakeEngine.reset()`), `createFakeEngine`
  - `test-utils/fakeFamily.ts`: `FAKE_ME`, `FAKE_BOB`, `fakeFamilyValue(overrides?)`

- [ ] **Step 1: Write the failing cache test**

`lib/family/__tests__/cache.test.ts`:

```ts
import { memoryStorage } from '@/test-utils/memoryStorage';

import { clearFamilyData, familyKeys, readFamilyCache, writeFamilyCache } from '../cache';
import type { FamilySnapshot } from '../types';

const me = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: null };
const snapshot: FamilySnapshot = {
  me,
  family: { id: 'fam-1', name: 'Smiths', ownerId: 'user-1', inviteCode: 'K7QM2XWP' },
  members: [me],
};

describe('family cache', () => {
  it('reads back what it wrote, per user', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, 'user-1', snapshot);
    expect(await readFamilyCache(storage, 'user-1')).toEqual(snapshot);
    expect(await readFamilyCache(storage, 'user-2')).toBeNull();
  });

  it('ignores damaged or mismatched data', async () => {
    const storage = memoryStorage();
    await storage.setItem(familyKeys('user-1').family, '{not json');
    expect(await readFamilyCache(storage, 'user-1')).toBeNull();
    await storage.setItem(familyKeys('user-2').family, JSON.stringify(snapshot)); // someone else's snapshot
    expect(await readFamilyCache(storage, 'user-2')).toBeNull();
  });

  it('forgets the family and the tag answers', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, 'user-1', snapshot);
    await storage.setItem(familyKeys('user-1').tagAnswers, '{"AZ":null}');
    await clearFamilyData(storage, 'user-1');
    expect(await storage.getItem(familyKeys('user-1').family)).toBeNull();
    expect(await storage.getItem(familyKeys('user-1').tagAnswers)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx jest lib/family/__tests__/cache.test.ts`
Expected: FAIL — `Cannot find module '../cache'`.

- [ ] **Step 3: Write the cache**

`lib/family/cache.ts`:

```ts
import type { KeyValueStorage } from '@/lib/events/store';

import type { Family, FamilySnapshot, Member } from './types';

/** Where one user's family details live on the phone. */
export const familyKeys = (userId: string) => ({
  family: `planme:family:${userId}`,
  tagAnswers: `planme:tagMap:${userId}`,
});

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

function isMember(v: unknown): v is Member {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && isNullableString(m.displayName) && isNullableString(m.tag) && isNullableString(m.joinedAt);
}

function isFamily(v: unknown): v is Family {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.id === 'string' && typeof f.name === 'string' && typeof f.ownerId === 'string' && typeof f.inviteCode === 'string';
}

function isFamilySnapshot(v: unknown): v is FamilySnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isMember(s.me) && (s.family === null || isFamily(s.family)) && Array.isArray(s.members) && s.members.every(isMember);
}

/** The family as last fetched for this user, for an offline start. Damaged data counts as none. */
export async function readFamilyCache(storage: KeyValueStorage, userId: string): Promise<FamilySnapshot | null> {
  try {
    const raw = await storage.getItem(familyKeys(userId).family);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFamilySnapshot(parsed) && parsed.me.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeFamilyCache(storage: KeyValueStorage, userId: string, snapshot: FamilySnapshot): Promise<void> {
  await storage.setItem(familyKeys(userId).family, JSON.stringify(snapshot));
}

/** Forget this user's family details and tag answers. Only for a user-initiated sign-out. */
export async function clearFamilyData(storage: KeyValueStorage, userId: string): Promise<void> {
  const keys = familyKeys(userId);
  await Promise.all([storage.removeItem(keys.family), storage.removeItem(keys.tagAnswers)]);
}
```

- [ ] **Step 4: Run the cache test**

Run: `npx jest lib/family/__tests__/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the test helpers**

`test-utils/fakeEngine.ts`:

```ts
import type { EventRecord } from '@/lib/events/rows';
import type { SyncEngineLike, SyncEngineOptions } from '@/lib/events/syncEngine';

/** Records every call; tests drive what the app sees through `options.onChange`. */
export class FakeEngine implements SyncEngineLike {
  static instances: FakeEngine[] = [];
  static reset() {
    FakeEngine.instances = [];
  }
  stopped = false;
  canSync: boolean;
  created: EventRecord[][] = [];
  updated: EventRecord[] = [];
  removed: string[][] = [];
  syncs: boolean[] = [];
  cleared = false;
  pending = 0;
  constructor(public options: SyncEngineOptions) {
    this.canSync = options.canSync;
    FakeEngine.instances.push(this);
  }
  async start() {}
  stop() {
    this.stopped = true;
  }
  async sync(refresh = false) {
    this.syncs.push(refresh);
  }
  setCanSync(canSync: boolean) {
    this.canSync = canSync;
  }
  async create(records: EventRecord[]) {
    this.created.push(records);
  }
  async update(record: EventRecord) {
    this.updated.push(record);
  }
  async remove(ids: string[]) {
    this.removed.push(ids);
  }
  async clearLocalData() {
    this.cleared = true;
  }
}

export const createFakeEngine = (options: SyncEngineOptions) => new FakeEngine(options);
```

`test-utils/fakeFamily.ts`:

```ts
import type { FamilyValue } from '@/context/FamilyProvider';
import type { Member } from '@/lib/family/types';

export const FAKE_ME: Member = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: '2026-10-01T00:00:00Z' };
export const FAKE_BOB: Member = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: '2026-10-02T00:00:00Z' };

/** A family of Alice (owner, the signed-in user) and Bob. Every action is a jest.fn that succeeds. */
export function fakeFamilyValue(overrides: Partial<FamilyValue> = {}): FamilyValue {
  const members = overrides.members ?? [FAKE_ME, FAKE_BOB];
  const ok = async () => ({ ok: true as const, value: undefined });
  return {
    me: FAKE_ME,
    family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_ME.id, inviteCode: 'K7QM2XWP' },
    members,
    isOwner: true,
    loading: false,
    offline: false,
    memberById: new Map(members.map(m => [m.id, m])),
    memberByTag: new Map(members.flatMap(m => (m.tag ? [[m.tag, m] as const] : []))),
    refresh: jest.fn(async () => {}),
    createFamily: jest.fn(ok),
    joinFamily: jest.fn(ok),
    leaveFamily: jest.fn(ok),
    removeMember: jest.fn(ok),
    regenerateInviteCode: jest.fn(async () => ({ ok: true as const, value: 'P3RT8VWX' })),
    updateProfile: jest.fn(ok),
    ...overrides,
  };
}
```

- [ ] **Step 6: Write the failing provider tests**

`context/__tests__/FamilyProvider.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { FAMILY_MESSAGES, type FamilyApi } from '@/lib/family/api';
import { writeFamilyCache } from '@/lib/family/cache';
import type { FamilyResult, FamilySnapshot } from '@/lib/family/types';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, FAKE_ME } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { AuthProvider } from '../AuthProvider';
import { EventsProvider } from '../EventsProvider';
import { FamilyProvider, useFamily } from '../FamilyProvider';

const inFamily: FamilySnapshot = {
  me: FAKE_ME,
  family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_ME.id, inviteCode: 'K7QM2XWP' },
  members: [FAKE_ME, FAKE_BOB],
};
const alone: FamilySnapshot = { me: FAKE_ME, family: null, members: [FAKE_ME] };
const ok = <T,>(value: T): FamilyResult<T> => ({ ok: true, value });

function fakeApi(fetchResult: FamilyResult<FamilySnapshot> = ok(inFamily)) {
  const done = async () => ok(undefined);
  return {
    fetchFamily: jest.fn(async () => fetchResult),
    createFamily: jest.fn(done),
    joinFamily: jest.fn(done),
    leaveFamily: jest.fn(done),
    removeMember: jest.fn(done),
    regenerateInviteCode: jest.fn(async () => ok('P3RT8VWX')),
    updateProfile: jest.fn(done),
  } satisfies FamilyApi;
}

function setup(api = fakeApi(), fake = fakeAuthClient(fakeSession()), storage = memoryStorage()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={fake.client}>
      <EventsProvider storage={storage} createEngine={createFakeEngine}>
        <FamilyProvider storage={storage} api={api}>
          {children}
        </FamilyProvider>
      </EventsProvider>
    </AuthProvider>
  );
  return { api, fake, storage, ...renderHook(() => useFamily(), { wrapper }) };
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('FamilyProvider', () => {
  it('fetches the family and builds the tag lookup', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.family?.name).toBe('Smiths'));
    expect(result.current.isOwner).toBe(true);
    expect(result.current.memberByTag.get('BE')?.id).toBe(FAKE_BOB.id);
    expect(result.current.memberById.get(FAKE_ME.id)?.displayName).toBe('Alice');
    expect(result.current.loading).toBe(false);
  });

  it('starts from the cached family, then shows the server version', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, FAKE_ME.id, alone);
    let resolveFetch: (r: FamilyResult<FamilySnapshot>) => void = () => {};
    const api = fakeApi();
    api.fetchFamily.mockImplementationOnce(() => new Promise(resolve => (resolveFetch = resolve)));
    const { result } = setup(api, fakeAuthClient(fakeSession()), storage);
    await waitFor(() => expect(result.current.me?.id).toBe(FAKE_ME.id));
    expect(result.current.family).toBeNull();
    await act(async () => resolveFetch(ok(inFamily)));
    expect(result.current.family?.name).toBe('Smiths');
  });

  it("keeps the cached family when the server can't be reached", async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, FAKE_ME.id, inFamily);
    const api = fakeApi({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    const { result } = setup(api, fakeAuthClient(fakeSession()), storage);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.family?.name).toBe('Smiths');
  });

  it('refreshes the family and the events after joining', async () => {
    const api = fakeApi(ok(alone));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.me).not.toBeNull());
    api.fetchFamily.mockResolvedValue(ok(inFamily));
    let outcome: FamilyResult | undefined;
    await act(async () => {
      outcome = await result.current.joinFamily('K7QM2XWP');
    });
    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(result.current.family?.name).toBe('Smiths');
    expect(FakeEngine.instances[0].syncs).toContain(true);
  });

  it('returns the message of a failed action and does not refetch', async () => {
    const api = fakeApi();
    api.leaveFamily.mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    const { result } = setup(api);
    await waitFor(() => expect(result.current.family).not.toBeNull());
    const fetches = api.fetchFamily.mock.calls.length;
    let outcome: FamilyResult | undefined;
    await act(async () => {
      outcome = await result.current.leaveFamily();
    });
    expect(outcome).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    expect(api.fetchFamily.mock.calls.length).toBe(fetches);
  });

  it("never shows the previous user's family", async () => {
    const api = fakeApi();
    const { result, fake } = setup(api);
    await waitFor(() => expect(result.current.family?.name).toBe('Smiths'));
    api.fetchFamily.mockImplementation(() => new Promise(() => {})); // B's fetch never returns
    act(() => fake.emit('SIGNED_IN', fakeSession('bob@test.nz', 'user-2')));
    expect(result.current.family).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.me).toBeNull();
  });
});
```

Add this test to `context/__tests__/EventsProvider.test.tsx` (inside the existing `describe`):

```tsx
  it("forgets the user's family details on sign-out", async () => {
    const { result, storage } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await storage.setItem('planme:family:user-1', '{}');
    await storage.setItem('planme:tagMap:user-1', '{}');
    await act(async () => {
      await result.current.signOutAndForget();
    });
    expect(await storage.getItem('planme:family:user-1')).toBeNull();
    expect(await storage.getItem('planme:tagMap:user-1')).toBeNull();
  });
```

- [ ] **Step 7: Run them to see them fail**

Run: `npx jest context`
Expected: FAIL — `Cannot find module '../FamilyProvider'`, and the new EventsProvider test fails (keys still present).

- [ ] **Step 8: Add `refresh` and the sign-out cleanup to EventsProvider**

In `context/EventsProvider.tsx`:

1. Add the import: `import { clearFamilyData } from '@/lib/family/cache';`
2. In `type EventsValue`, after `deleteEvents`, add:

```ts
  /** Fetch everything visible again (after joining or leaving a family). */
  refresh: () => void;
```

3. After `deleteEvents`, add:

```tsx
  const refresh = useCallback(() => {
    void engineRef.current?.sync(true);
  }, []);
```

4. In `signOutAndForget`, replace `await currentEngine?.clearLocalData();` with:

```tsx
      await currentEngine?.clearLocalData();
      if (currentUserId) await clearFamilyData(storage, currentUserId).catch(() => undefined);
```

5. Add `refresh` to the `value` object and to its `useMemo` dependency list.

- [ ] **Step 9: Write the provider**

`context/FamilyProvider.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { KeyValueStorage } from '@/lib/events/store';
import { FAMILY_MESSAGES, type FamilyApi, familyApi, type ProfileChanges } from '@/lib/family/api';
import { readFamilyCache, writeFamilyCache } from '@/lib/family/cache';
import type { Family, FamilyResult, FamilySnapshot, Member } from '@/lib/family/types';

import { useAuth } from './AuthProvider';
import { useEvents } from './EventsProvider';

export type FamilyValue = {
  me: Member | null;
  family: Family | null;
  /** Everyone in the family, you included; just you when there's no family. */
  members: Member[];
  isOwner: boolean;
  /** Nothing known yet: no cached family and the first fetch hasn't come back. */
  loading: boolean;
  /** The last fetch couldn't reach the server, so what's shown may be out of date. */
  offline: boolean;
  memberById: ReadonlyMap<string, Member>;
  memberByTag: ReadonlyMap<string, Member>;
  refresh: () => Promise<void>;
  createFamily: (name: string) => Promise<FamilyResult>;
  joinFamily: (code: string) => Promise<FamilyResult>;
  leaveFamily: () => Promise<FamilyResult>;
  removeMember: (memberId: string) => Promise<FamilyResult>;
  regenerateInviteCode: () => Promise<FamilyResult<string>>;
  updateProfile: (changes: ProfileChanges) => Promise<FamilyResult>;
};

export const FamilyContext = createContext<FamilyValue | null>(null);

type State = { userId: string | null; snapshot: FamilySnapshot | null; fetched: boolean; offline: boolean };

type Props = { children: React.ReactNode; storage?: KeyValueStorage; api?: FamilyApi };

/** The signed-in user's family. Kept per user on the phone so the planner knows the tags offline. */
export function FamilyProvider({ children, storage = AsyncStorage, api = familyApi }: Props) {
  const { client, user, session } = useAuth();
  const { refresh: refreshEvents } = useEvents();
  const userId = user?.id ?? null;
  const hasSession = session !== null;
  const [state, setState] = useState<State>({ userId: null, snapshot: null, fetched: false, offline: false });
  // State belongs to one user; anything else is treated as nothing known yet.
  const current = state.userId === userId ? state : null;

  const userRef = useRef(userId);
  userRef.current = userId;
  const sessionRef = useRef(hasSession);
  sessionRef.current = hasSession;
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const uid = userRef.current;
    if (!uid || !sessionRef.current) return;
    const request = ++requestRef.current;
    const result = await api.fetchFamily(client, uid);
    // A newer request, or a different user, wins.
    if (request !== requestRef.current || userRef.current !== uid) return;
    if (result.ok) {
      setState({ userId: uid, snapshot: result.value, fetched: true, offline: false });
      void writeFamilyCache(storage, uid, result.value).catch(() => undefined);
    } else {
      setState(prev =>
        prev.userId === uid
          ? { ...prev, fetched: true, offline: result.offline }
          : { userId: uid, snapshot: null, fetched: true, offline: result.offline },
      );
    }
  }, [api, client, storage]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // A different user: start from their cached family while the server is asked.
  useEffect(() => {
    requestRef.current += 1; // answers for the previous user are ignored
    setState({ userId, snapshot: null, fetched: false, offline: false });
    if (!userId) return;
    let active = true;
    readFamilyCache(storage, userId).then(cached => {
      if (active && cached) setState(prev => (prev.userId === userId && !prev.snapshot ? { ...prev, snapshot: cached } : prev));
    });
    return () => {
      active = false;
    };
  }, [userId, storage]);

  // Signed in (or a session arrived after an offline start): ask the server.
  useEffect(() => {
    if (userId && hasSession) void refreshRef.current();
  }, [userId, hasSession]);

  // Back in the foreground: someone may have joined, or removed you.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', appState => {
      if (appState === 'active') void refreshRef.current();
    });
    return () => subscription.remove();
  }, []);

  const withUser = useCallback(
    async <T,>(call: (uid: string) => Promise<FamilyResult<T>>, membershipChanged: boolean): Promise<FamilyResult<T>> => {
      const uid = userRef.current;
      if (!uid) return { ok: false, message: FAMILY_MESSAGES.signInAgain, offline: false };
      const result = await call(uid);
      if (result.ok) {
        await refresh();
        // Joining or leaving changes which shared events this user can see.
        if (membershipChanged) refreshEvents();
      }
      return result;
    },
    [refresh, refreshEvents],
  );

  const createFamily = useCallback((name: string) => withUser(() => api.createFamily(client, name), true), [withUser, api, client]);
  const joinFamily = useCallback((code: string) => withUser(() => api.joinFamily(client, code), true), [withUser, api, client]);
  const leaveFamily = useCallback(() => withUser(() => api.leaveFamily(client), true), [withUser, api, client]);
  const removeMember = useCallback(
    (memberId: string) => withUser(() => api.removeMember(client, memberId), false),
    [withUser, api, client],
  );
  const regenerateInviteCode = useCallback(() => withUser(() => api.regenerateInviteCode(client), false), [withUser, api, client]);
  const updateProfile = useCallback(
    (changes: ProfileChanges) => withUser(uid => api.updateProfile(client, uid, changes), false),
    [withUser, api, client],
  );

  const snapshot = current?.snapshot ?? null;
  const memberById = useMemo(() => new Map((snapshot?.members ?? []).map(m => [m.id, m])), [snapshot]);
  const memberByTag = useMemo(
    () => new Map((snapshot?.members ?? []).flatMap(m => (m.tag ? [[m.tag, m] as const] : []))),
    [snapshot],
  );

  const value = useMemo<FamilyValue>(
    () => ({
      me: snapshot?.me ?? null,
      family: snapshot?.family ?? null,
      members: snapshot?.members ?? [],
      isOwner: !!snapshot?.family && snapshot.family.ownerId === userId,
      loading: !snapshot && !(current?.fetched ?? false),
      offline: current?.offline ?? false,
      memberById,
      memberByTag,
      refresh,
      createFamily,
      joinFamily,
      leaveFamily,
      removeMember,
      regenerateInviteCode,
      updateProfile,
    }),
    [snapshot, userId, current?.fetched, current?.offline, memberById, memberByTag, refresh, createFamily, joinFamily, leaveFamily, removeMember, regenerateInviteCode, updateProfile],
  );
  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyValue {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside <FamilyProvider>');
  return value;
}
```

- [ ] **Step 10: Wrap the app**

In `app/_layout.tsx`, import `FamilyProvider` from `@/context/FamilyProvider` and wrap `ThemeProvider` with it, inside `EventsProvider`:

```tsx
    <AuthProvider client={supabase}>
      <EventsProvider>
        <FamilyProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootNavigator />
            <StatusBar style="auto" />
          </ThemeProvider>
        </FamilyProvider>
      </EventsProvider>
    </AuthProvider>
```

- [ ] **Step 11: Run the tests**

Run: `npx jest context lib/family`
Expected: PASS.

- [ ] **Step 12: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add lib/family context app/_layout.tsx test-utils
git commit -m "FEAT-002: Keep the user's family on the phone and refresh it with the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared events in sync

**Files:**
- Modify: `lib/events/rows.ts`, `context/EventsProvider.tsx`, `lib/events/syncEngine.ts`, `components/events/SyncBadge.tsx`, `app/(tabs)/index.tsx` (render the notice)
- Test: `lib/events/__tests__/rows.test.ts`, `components/events/__tests__/SyncBadge.test.tsx`, `lib/events/__tests__/sharing.integration.test.ts`

**Interfaces:**
- Consumes: `SyncEngine`, `SyncStatus` (Plan 4); `signedInPhone`, `TestPhone` (test kit); `memoryStorage`.
- Produces:
  - `EventInput = LocalEvent & { visibility?: Visibility; memberIds?: string[] }` (rows.ts)
  - `newRecord(event: EventInput, ownerId): EventRecord` (visibility defaults to personal, memberIds to `[]`)
  - `updatePayload(record)` now includes `visibility`
  - `useEvents().addEvents(events: EventInput[])`, `useEvents().updateEvent(event: EventInput)` (visibility and member ids kept from the stored record when not given)
  - `SyncStatus.refused?: number` — changes the server refused since this engine started (absent means none)
  - `RefusedNotice` component (SyncBadge.tsx)

- [ ] **Step 1: Write the failing row tests**

Add to `lib/events/__tests__/rows.test.ts` (update the existing `updatePayload`/`insertPayload` expectations in that file to include `visibility`, keeping everything else):

```ts
describe('sharing', () => {
  const event = { id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f', dateKey: '2026-11-03', name: 'Dinner', startTime: '18:00', endTime: '' };

  it('makes new events personal unless told otherwise', () => {
    expect(newRecord(event, 'user-1')).toMatchObject({ visibility: 'personal', memberIds: [] });
    expect(newRecord({ ...event, visibility: 'shared', memberIds: ['user-2'] }, 'user-1')).toMatchObject({
      visibility: 'shared',
      memberIds: ['user-2'],
      ownerId: 'user-1',
    });
  });

  it('sends visibility with an edit, so the creator can share or unshare', () => {
    const record = newRecord({ ...event, visibility: 'shared' }, 'user-1');
    expect(updatePayload(record)).toMatchObject({ visibility: 'shared' });
    expect(insertPayload(record)).toMatchObject({ id: event.id, owner_id: 'user-1', visibility: 'shared' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/rows.test.ts`
Expected: FAIL — `newRecord` ignores visibility; `updatePayload` has no visibility.

- [ ] **Step 3: Change rows.ts**

In `lib/events/rows.ts`:

1. After `EventRecord`, add:

```ts
/** An event from the planner: who it's for and who sees it are optional (kept as they are when editing). */
export type EventInput = LocalEvent & { visibility?: Visibility; memberIds?: string[] };
```

2. Replace `updatePayload`'s comment and body, and `insertPayload`:

```ts
/** Columns a client may set when editing; id and owner never change. The server fills or clears
 * family_id from visibility, and only the creator may make a shared event personal (events_guard). */
export const updatePayload = (r: EventRecord) => ({
  title: titleOf(r.name),
  date: r.dateKey,
  start_time: toDbTime(r.startTime),
  end_time: toDbTime(r.endTime),
  visibility: r.visibility,
  people: r.memberIds,
  legacy_people: r.people ?? [],
  series_id: seriesOf(r.occurrenceId),
});

/** Columns a client sets when creating; the server fills family_id and the timestamps. */
export const insertPayload = (r: EventRecord) => ({
  id: r.id,
  owner_id: r.ownerId,
  ...updatePayload(r),
});
```

3. Replace `newRecord`:

```ts
/** A new event typed on this phone, owned by the user and not yet on the server. Personal unless shared. */
export function newRecord(event: EventInput, ownerId: string): EventRecord {
  const { visibility = 'personal', memberIds = [], ...rest } = event;
  return { ...rest, ownerId, visibility, memberIds, updatedAt: null };
}
```

- [ ] **Step 4: Run the row tests**

Run: `npx jest lib/events/__tests__/rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Accept visibility and members in EventsProvider**

In `context/EventsProvider.tsx`:

1. Change the import to `import { type EventInput, type EventRecord, newRecord, recordsToItems } from '@/lib/events/rows';`.
2. In `EventsValue`, change to `addEvents: (events: EventInput[]) => void;` and `updateEvent: (event: EventInput) => void;`.
3. Change `addEvents`'s parameter type to `EventInput[]` (the body is unchanged: `newRecord` reads the new fields).
4. Replace `updateEvent`:

```tsx
  const updateEvent = useCallback((event: EventInput) => {
    const existing = recordsRef.current[event.id];
    if (!existing) return;
    void engineRef.current?.update({
      ...existing,
      dateKey: event.dateKey,
      name: event.name,
      startTime: event.startTime,
      endTime: event.endTime,
      people: event.people,
      occurrenceId: event.occurrenceId,
      visibility: event.visibility ?? existing.visibility,
      memberIds: event.memberIds ?? existing.memberIds,
    });
  }, []);
```

Add to `context/__tests__/EventsProvider.test.tsx`:

```tsx
  it('keeps who sees an event when an edit does not say', async () => {
    const { result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const record = { ...swim, id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f', ownerId: 'user-1', visibility: 'shared' as const, memberIds: ['user-2'], updatedAt: null };
    act(() => engine().options.onChange({ [record.id]: record }, idle));
    act(() => result.current.updateEvent({ ...swim, id: record.id, name: 'Swim club' }));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    expect(engine().updated[0]).toMatchObject({ name: 'Swim club', visibility: 'shared', memberIds: ['user-2'] });
  });
```

- [ ] **Step 6: Count refused changes in the engine**

In `lib/events/syncEngine.ts`:

1. Change `SyncStatus` to:

```ts
export type SyncStatus = {
  state: SyncState;
  pending: number;
  lastSyncedAt: string | null;
  /** Changes the server refused since this engine started (absent means none). The planner shows a notice. */
  refused?: number;
};
```

2. Add a field after `private saving…`: `private refused = 0;`
3. In `runSync`, replace `if (outcome.rejected > 0) refresh = true;` with:

```ts
      if (outcome.rejected > 0) {
        this.refused += outcome.rejected;
        refresh = true;
      }
```

4. In `emit()`, replace the status object with:

```ts
    const status: SyncStatus = { state: this.state, pending: this.data.outbox.length, lastSyncedAt: this.data.lastFullSync };
    if (this.refused > 0) status.refused = this.refused;
    this.options.onChange({ ...this.data.records }, status);
```

- [ ] **Step 7: Write the failing notice test**

Add to `components/events/__tests__/SyncBadge.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RefusedNoticeView } from '../SyncBadge';

describe('RefusedNoticeView', () => {
  it('says a change was undone until you tap OK', () => {
    const { rerender } = render(<RefusedNoticeView refused={0} />);
    expect(screen.queryByText(/couldn't be saved/)).toBeNull();
    rerender(<RefusedNoticeView refused={1} />);
    expect(screen.getByText("A change couldn't be saved, so the event shows its last saved version.")).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByText(/couldn't be saved/)).toBeNull();
    rerender(<RefusedNoticeView refused={2} />);
    expect(screen.getByText(/couldn't be saved/)).toBeTruthy();
  });

  it('starts over for a new engine', () => {
    const { rerender } = render(<RefusedNoticeView refused={3} />);
    fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    rerender(<RefusedNoticeView refused={0} />);
    rerender(<RefusedNoticeView refused={1} />);
    expect(screen.getByText(/couldn't be saved/)).toBeTruthy();
  });
});
```

(Merge the imports with the file's existing imports; keep `React` imported.)

- [ ] **Step 8: Run it to see it fail**

Run: `npx jest components/events/__tests__/SyncBadge.test.tsx`
Expected: FAIL — `RefusedNoticeView` is not exported.

- [ ] **Step 9: Write the notice**

Append to `components/events/SyncBadge.tsx` (add `Pressable` and `useEffect`, `useState` to its imports):

```tsx
/** Shown when the server refused a change (for example, sharing after leaving the family). */
export function RefusedNoticeView({ refused }: { refused: number }) {
  const [seen, setSeen] = useState(0);
  // A new engine (another user, or a restart) counts from zero again.
  useEffect(() => {
    if (refused < seen) setSeen(refused);
  }, [refused, seen]);
  if (refused <= seen) return null;
  return (
    <View accessibilityRole="alert" style={noticeStyles.notice}>
      <Text style={noticeStyles.text}>A change couldn&apos;t be saved, so the event shows its last saved version.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="OK" onPress={() => setSeen(refused)} hitSlop={8}>
        <Text style={noticeStyles.ok}>OK</Text>
      </Pressable>
    </View>
  );
}

export function RefusedNotice() {
  const { status } = useEvents();
  return <RefusedNoticeView refused={status.refused ?? 0} />;
}

const noticeStyles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 8, backgroundColor: '#f8d7da' },
  text: { flex: 1, fontSize: 13, color: '#842029' },
  ok: { fontSize: 13, fontWeight: 'bold', color: '#842029' },
});
```

If `SyncBadge.tsx` doesn't yet import `StyleSheet`, `Text` or `View` from `react-native`, add them.

In `app/(tabs)/index.tsx`, import `RefusedNotice` alongside `SyncBadge` and render `<RefusedNotice />` right after `<SyncBadge />`.

- [ ] **Step 10: Run the unit tests**

Run: `npx jest lib/events components/events context`
Expected: PASS.

- [ ] **Step 11: Write the sharing integration test**

`lib/events/__tests__/sharing.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { memoryStorage } from '@/test-utils/memoryStorage';
import { signedInPhone, type TestPhone } from '@/test-utils/supabaseTestKit';

import type { EventRecord } from '../rows';
import { SyncEngine, type SyncStatus } from '../syncEngine';

type Phone = TestPhone & { userId: string };
const engines: SyncEngine[] = [];

function startEngine(phone: Phone) {
  let latest: { records: Record<string, EventRecord>; status: SyncStatus | null } = { records: {}, status: null };
  const engine = new SyncEngine({
    client: phone.client,
    userId: phone.userId,
    storage: memoryStorage(),
    canSync: true,
    realtime: false,
    onChange: (records, status) => {
      latest = { records, status };
    },
  });
  engines.push(engine);
  return { engine, latest: () => latest };
}

const record = (ownerId: string, overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: randomUUID(),
  dateKey: '2026-11-03',
  name: 'Family dinner',
  startTime: '18:00',
  endTime: '',
  ownerId,
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
  ...overrides,
});

async function family(alice: Phone, bob: Phone) {
  await alice.client.rpc('create_family', { p_name: 'Test family' });
  const { data } = await alice.client.from('families').select('invite_code').single();
  await bob.client.rpc('join_family', { p_code: data?.invite_code });
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

describe('Sharing events with the family', () => {
  it('shows a shared event to the family, and hides it again when the creator makes it personal', async () => {
    const alice = await signedInPhone('share');
    const bob = await signedInPhone('share');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();

    const dinner = record(alice.userId);
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toBeUndefined();

    await a.engine.update({ ...dinner, visibility: 'shared' });
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toMatchObject({ visibility: 'shared', ownerId: alice.userId });

    await a.engine.update({ ...dinner, visibility: 'personal' });
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toBeUndefined();
  });

  it('lets a member edit a shared event but not make it personal', async () => {
    const alice = await signedInPhone('share');
    const bob = await signedInPhone('share');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();

    const dinner = record(alice.userId, { visibility: 'shared', memberIds: [bob.userId] });
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);

    await b.engine.update({ ...b.latest().records[dinner.id], name: "Dinner at Nan's" });
    await b.engine.sync();
    await a.engine.sync(true);
    expect(a.latest().records[dinner.id]).toMatchObject({ name: "Dinner at Nan's", memberIds: [bob.userId] });

    await b.engine.update({ ...b.latest().records[dinner.id], visibility: 'personal' });
    await b.engine.sync();
    expect(b.latest().status?.refused).toBe(1);
    // The re-fetch after the refusal put the server's version back.
    expect(b.latest().records[dinner.id]?.visibility).toBe('shared');
  });

  it('refuses a shared event from someone not in a family', async () => {
    const carol = await signedInPhone('share');
    const c = startEngine(carol);
    await c.engine.start();
    const lonely = record(carol.userId, { visibility: 'shared' });
    await c.engine.create([lonely]);
    await c.engine.sync();
    expect(c.latest().status?.refused).toBe(1);
    expect(c.latest().records[lonely.id]).toBeUndefined();
  });
});
```

- [ ] **Step 12: Run the integration tests**

Run: `npm run test:integration`
Expected: PASS (all suites, including the 3 new tests).

- [ ] **Step 13: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add lib/events context components/events "app/(tabs)/index.tsx"
git commit -m "FEAT-002: Sync who sees each event and say when a change is refused

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tags, sharing toggle and avatars in the planner

**Files:**
- Create: `lib/family/tags.ts`, `components/events/ShareToggle.tsx`, `components/events/MemberAvatar.tsx`
- Modify: `app/(tabs)/index.tsx`
- Test: `lib/family/__tests__/tags.test.ts`, `components/events/__tests__/ShareToggle.test.tsx`, `components/events/__tests__/MemberAvatar.test.tsx`, `app/(tabs)/__tests__/planner.test.tsx`

**Interfaces:**
- Consumes: `useFamily()` (Task 2) → `{ me, family, members, memberById, memberByTag }`; `EventInput`, `EventRecord`, `Visibility` (Task 3); `DEFAULT_TAGS` from `lib/parse/tags.ts`; `parseEventInput(input, { selectedDateKey, knownTags })`; `eventToSentence(item)`; `planEdit(editing, fresh)`; `FakeEngine`, `fakeFamilyValue`, `FAKE_BOB` (Task 2).
- Produces (`lib/family/tags.ts`):
  - `knownTagsFor(members): string[]` — the family's tags plus `AZ`, `GS`
  - `resolvePeople(tags, memberByTag): { memberIds: string[]; legacy: string[] }`
  - `withPeople(event: LocalEvent, memberByTag, visibility, keep?: string[]): EventInput`
  - `tagsForEditing(record, memberById): { tags: string[]; keep: string[] }`
  - `memberLabel(member | undefined, myId): string` — "You", the name, `@TAG`, "Member", or "Former member"
- Produces (components): `ShareToggle({ shared, onChange, disabled? })` (role `switch`, label "Share with family"); `MemberAvatar({ member, faded? })`, `avatarText(member)`, `avatarColour(id)`

- [ ] **Step 1: Write the failing tag tests**

`lib/family/__tests__/tags.test.ts`:

```ts
import type { EventRecord } from '@/lib/events/rows';

import { knownTagsFor, memberLabel, resolvePeople, tagsForEditing, withPeople } from '../tags';
import type { Member } from '../types';

const alice: Member = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: null };
const bob: Member = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: null };
const noTag: Member = { id: 'user-3', displayName: 'Nan', tag: null, joinedAt: null };
const byTag = new Map([
  ['AL', alice],
  ['BE', bob],
]);
const byId = new Map([alice, bob, noTag].map(m => [m.id, m]));

const event = { id: 'e1', dateKey: '2026-11-03', name: 'Dinner', startTime: '18:00', endTime: '' };

describe('knownTagsFor', () => {
  it('knows the family tags and the two old ones', () => {
    expect(knownTagsFor([alice, bob, noTag])).toEqual(['AL', 'BE', 'AZ', 'GS']);
  });
});

describe('resolvePeople', () => {
  it('turns member tags into member ids', () => {
    expect(resolvePeople(['BE', 'AL', 'BE'], byTag)).toEqual({ memberIds: ['user-2', 'user-1'], legacy: [] });
  });

  it('keeps a tag no member has', () => {
    expect(resolvePeople(['AZ', 'BE'], byTag)).toEqual({ memberIds: ['user-2'], legacy: ['AZ'] });
  });
});

describe('withPeople', () => {
  it('saves members and leftover tags with the chosen visibility', () => {
    expect(withPeople({ ...event, people: ['BE', 'AZ'] }, byTag, 'shared')).toEqual({
      ...event,
      people: ['AZ'],
      memberIds: ['user-2'],
      visibility: 'shared',
    });
  });

  it("keeps members the text can't show", () => {
    expect(withPeople({ ...event, people: ['BE'] }, byTag, 'personal', ['user-3', 'gone'])).toMatchObject({
      memberIds: ['user-3', 'gone', 'user-2'],
      people: undefined,
    });
  });
});

describe('tagsForEditing', () => {
  it('shows member tags and old tags, and keeps the rest', () => {
    const record = {
      ...event,
      people: ['AZ'],
      memberIds: ['user-2', 'user-3', 'gone'],
      ownerId: 'user-1',
      visibility: 'shared',
      updatedAt: null,
    } as EventRecord;
    expect(tagsForEditing(record, byId)).toEqual({ tags: ['BE', 'AZ'], keep: ['user-3', 'gone'] });
  });
});

describe('memberLabel', () => {
  it.each([
    [alice, 'user-1', 'You'],
    [bob, 'user-1', 'Bob'],
    [{ ...bob, displayName: '  ' }, 'user-1', '@BE'],
    [{ ...noTag, displayName: null }, 'user-1', 'Member'],
    [undefined, 'user-1', 'Former member'],
  ])('labels %j', (member, myId, label) => {
    expect(memberLabel(member, myId)).toBe(label);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/family/__tests__/tags.test.ts`
Expected: FAIL — `Cannot find module '../tags'`.

- [ ] **Step 3: Write tags.ts**

`lib/family/tags.ts`:

```ts
import type { EventInput, EventRecord, Visibility } from '@/lib/events/rows';
import type { LocalEvent } from '@/lib/events/types';
import { DEFAULT_TAGS } from '@/lib/parse/tags';

import type { Member } from './types';

/** Tags the planner recognises: the family's, plus the two used before families (kept until mapped). */
export function knownTagsFor(members: readonly Member[]): string[] {
  const tags = members.flatMap(m => (m.tag ? [m.tag] : []));
  return [...new Set([...tags, ...DEFAULT_TAGS])];
}

/** Split typed tags into family members and leftover tags (such as an unmapped @AZ). */
export function resolvePeople(
  tags: readonly string[],
  memberByTag: ReadonlyMap<string, Member>,
): { memberIds: string[]; legacy: string[] } {
  const memberIds: string[] = [];
  const legacy: string[] = [];
  for (const tag of tags) {
    const member = memberByTag.get(tag);
    if (member) {
      if (!memberIds.includes(member.id)) memberIds.push(member.id);
    } else if (!legacy.includes(tag)) {
      legacy.push(tag);
    }
  }
  return { memberIds, legacy };
}

/**
 * A parsed event ready to save. `keep` holds member ids the text can't express (a member with no tag,
 * or one no longer in the family), so an edit doesn't drop them.
 */
export function withPeople(
  event: LocalEvent,
  memberByTag: ReadonlyMap<string, Member>,
  visibility: Visibility,
  keep: readonly string[] = [],
): EventInput {
  const { memberIds, legacy } = resolvePeople(event.people ?? [], memberByTag);
  const ids = [...keep.filter(id => !memberIds.includes(id)), ...memberIds];
  return { ...event, people: legacy.length > 0 ? legacy : undefined, memberIds: ids, visibility };
}

/** The @tags to put back in the input when editing, and the member ids that have no tag to show. */
export function tagsForEditing(record: EventRecord, memberById: ReadonlyMap<string, Member>): { tags: string[]; keep: string[] } {
  const tags: string[] = [];
  const keep: string[] = [];
  for (const id of record.memberIds) {
    const tag = memberById.get(id)?.tag;
    if (tag) tags.push(tag);
    else keep.push(id);
  }
  return { tags: [...tags, ...(record.people ?? [])], keep };
}

/** How to name a member on screen. Profiles hold no email, so the fallbacks are the tag, then "Member". */
export function memberLabel(member: Member | undefined, myId: string | null): string {
  if (!member) return 'Former member';
  if (member.id === myId) return 'You';
  return member.displayName?.trim() || (member.tag ? `@${member.tag}` : 'Member');
}
```

- [ ] **Step 4: Run the tag tests**

Run: `npx jest lib/family/__tests__/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing component tests**

`components/events/__tests__/ShareToggle.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ShareToggle } from '../ShareToggle';

describe('ShareToggle', () => {
  it('switches between personal and shared', () => {
    const onChange = jest.fn();
    const { rerender } = render(<ShareToggle shared={false} onChange={onChange} />);
    expect(screen.getByText('Personal')).toBeTruthy();
    fireEvent.press(screen.getByRole('switch', { name: 'Share with family' }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<ShareToggle shared onChange={onChange} />);
    expect(screen.getByText('Shared')).toBeTruthy();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('does nothing when locked', () => {
    const onChange = jest.fn();
    render(<ShareToggle shared onChange={onChange} disabled />);
    fireEvent.press(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
```

`components/events/__tests__/MemberAvatar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { avatarColour, avatarText, MemberAvatar } from '../MemberAvatar';

const bob = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: null };

describe('MemberAvatar', () => {
  it('shows the tag, or the first letter of the name', () => {
    expect(avatarText(bob)).toBe('BE');
    expect(avatarText({ ...bob, tag: null })).toBe('B');
    expect(avatarText({ ...bob, tag: null, displayName: null })).toBe('?');
  });

  it('gives each member the same colour every time', () => {
    expect(avatarColour('user-2')).toBe(avatarColour('user-2'));
    expect(avatarColour('user-2')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is labelled with the member', () => {
    render(<MemberAvatar member={bob} />);
    expect(screen.getByLabelText('Bob')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx jest components/events/__tests__/ShareToggle.test.tsx components/events/__tests__/MemberAvatar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 7: Write the components**

`components/events/ShareToggle.tsx`:

```tsx
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = { shared: boolean; onChange: (shared: boolean) => void; disabled?: boolean };

/** Personal (only you) or Shared (your whole family). */
export function ShareToggle({ shared, onChange, disabled = false }: Props) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Share with family"
      accessibilityState={{ checked: shared, disabled }}
      disabled={disabled}
      onPress={() => onChange(!shared)}
      style={[styles.chip, shared && styles.chipShared, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.text, shared && styles.textShared]}>{shared ? 'Shared' : 'Personal'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: '#007BFF', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8, marginRight: 8, justifyContent: 'center' },
  chipShared: { backgroundColor: '#007BFF' },
  chipDisabled: { opacity: 0.5 },
  text: { fontSize: 13, fontWeight: '600', color: '#007BFF' },
  textShared: { color: '#fff' },
});
```

`components/events/MemberAvatar.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Member } from '@/lib/family/types';

const COLOURS = ['#6f42c1', '#d63384', '#fd7e14', '#20c997', '#0d6efd', '#198754'];

/** The same colour for a member on every phone. */
export function avatarColour(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length];
}

export function avatarText(member: Member): string {
  if (member.tag) return member.tag;
  const name = member.displayName?.trim();
  return name ? Array.from(name)[0].toUpperCase() : '?';
}

/** A member as a coloured circle with their tag. (Photos come with Plan 6.) */
export function MemberAvatar({ member, faded = false }: { member: Member; faded?: boolean }) {
  const label = member.displayName?.trim() || (member.tag ? `@${member.tag}` : 'Member');
  return (
    <View accessibilityLabel={label} style={[styles.circle, { backgroundColor: avatarColour(member.id) }, faded && styles.faded]}>
      <Text style={styles.text}>{avatarText(member)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: 30, height: 30, borderRadius: 15, marginLeft: 6, alignItems: 'center', justifyContent: 'center' },
  faded: { opacity: 0.4 },
  text: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
});
```

- [ ] **Step 8: Run the component tests**

Run: `npx jest components/events`
Expected: PASS.

- [ ] **Step 9: Write the failing planner test**

`app/(tabs)/__tests__/planner.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import type { EventRecord } from '@/lib/events/rows';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import Planner from '../index';

// The month calendar only opens in a modal; it isn't needed here.
jest.mock('react-native-calendars', () => ({ Calendar: () => null }));

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };

function renderPlanner(family: FamilyValue = fakeFamilyValue()) {
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={memoryStorage()} createEngine={createFakeEngine}>
        <FamilyContext.Provider value={family}>
          <Planner />
        </FamilyContext.Provider>
      </EventsProvider>
    </AuthProvider>,
  );
}

const engine = () => FakeEngine.instances[0];
const type = (text: string) => fireEvent.changeText(screen.getByPlaceholderText('e.g., 6 June, 6-8pm, dancing'), text);

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('Planner with a family', () => {
  it('adds a shared event for a tagged member', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    fireEvent.press(screen.getByRole('switch', { name: 'Share with family' }));
    type('6pm dinner @BE');
    fireEvent.press(screen.getByText('Add'));
    await waitFor(() => expect(engine().created).toHaveLength(1));
    expect(engine().created[0][0]).toMatchObject({ visibility: 'shared', memberIds: [FAKE_BOB.id] });
  });

  it('adds personal events by default and keeps an unmapped @AZ', async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    type('6pm swim @AZ');
    fireEvent.press(screen.getByText('Add'));
    await waitFor(() => expect(engine().created).toHaveLength(1));
    expect(engine().created[0][0]).toMatchObject({ visibility: 'personal', memberIds: [], people: ['AZ'] });
  });

  it('hides the toggle without a family', async () => {
    renderPlanner(fakeFamilyValue({ family: null, members: [], memberById: new Map(), memberByTag: new Map() }));
    await waitFor(() => expect(engine()).toBeDefined());
    expect(screen.queryByRole('switch', { name: 'Share with family' })).toBeNull();
  });

  it("shows who shared an event, and won't let a member make it personal", async () => {
    renderPlanner();
    await waitFor(() => expect(engine()).toBeDefined());
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
    const record: EventRecord = {
      id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f',
      dateKey: today,
      name: 'Dinner',
      startTime: '18:00',
      endTime: '',
      ownerId: FAKE_BOB.id,
      visibility: 'shared',
      memberIds: ['someone-who-left'],
      updatedAt: '2026-10-12T00:00:00Z',
    };
    act(() => engine().options.onChange({ [record.id]: record }, idle));
    expect(await screen.findByText('Shared · Bob')).toBeTruthy();

    fireEvent.press(screen.getByText('Modify'));
    fireEvent.press(screen.getByText('Edit'));
    expect(screen.getByRole('switch', { name: 'Share with family' })).toBeDisabled();
    fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    // Still shared, and the member who left is still on the event.
    expect(engine().updated[0]).toMatchObject({ visibility: 'shared', memberIds: ['someone-who-left'] });
  });
});
```

- [ ] **Step 10: Run it to see it fail**

Run: `npx jest "app/\(tabs\)/__tests__/planner.test.tsx"`
Expected: FAIL — `useFamily must be used inside <FamilyProvider>` is not thrown because the planner doesn't use the family yet; the toggle isn't found.

- [ ] **Step 11: Change the planner**

In `app/(tabs)/index.tsx`:

1. Imports — add:

```tsx
import { MemberAvatar } from '@/components/events/MemberAvatar';
import { ShareToggle } from '@/components/events/ShareToggle';
import { useFamily } from '@/context/FamilyProvider';
import type { EventRecord, Visibility } from '@/lib/events/rows';
import { knownTagsFor, memberLabel, tagsForEditing, withPeople } from '@/lib/family/tags';
import type { Member } from '@/lib/family/types';
```

2. After `HandlersContext`, add:

```tsx
const MetaContext = createContext<{
  records: Record<string, EventRecord>;
  memberById: ReadonlyMap<string, Member>;
  myId: string | null;
}>({ records: {}, memberById: new Map(), myId: null });
```

3. In `EventItem`, after the `HandlersContext` line, add:

```tsx
  const { records, memberById, myId } = useContext(MetaContext);
  const record = records[item.id];
  const members = (record?.memberIds ?? []).flatMap(id => {
    const member = memberById.get(id);
    return member ? [member] : [];
  });
```

and replace the `itemContent` view's children (from `{timeDisplay ? …}` through the name `Text`) with:

```tsx
        {timeDisplay ? <Text style={[styles.itemTime, isPast && styles.textPast]}>{timeDisplay}</Text> : null}
        {members.map(member => <MemberAvatar key={member.id} member={member} faded={isPast} />)}
        {item.people?.map(tag => (
          PERSON_ICONS[tag]
            ? <Image key={tag} source={PERSON_ICONS[tag]} style={[styles.personIcon, isPast && { opacity: 0.4 }]} />
            : <Text key={tag} style={[styles.legacyTag, isPast && styles.textPast]}> @{tag}</Text>
        ))}
        <View style={styles.itemText}>
          <Text style={[styles.itemName, isPast && styles.textPast]}>
            {timeDisplay || item.people?.length || members.length ? ' ' : ''}{item.name}
          </Text>
          {record?.visibility === 'shared' ? (
            <Text style={[styles.sharedLabel, isPast && styles.textPast]}>
              Shared · {memberLabel(record.ownerId ? memberById.get(record.ownerId) : undefined, myId)}
            </Text>
          ) : null}
        </View>
```

4. In `App`, after `const { items, records, addEvents, updateEvent, deleteEvents } = useEvents();`, add:

```tsx
  const { me, family, members, memberById, memberByTag } = useFamily();
  const knownTags = useMemo(() => knownTagsFor(members), [members]);
  // The last choice for new events, for this session; starts personal (spec §5).
  const [shareNew, setShareNew] = useState(false);
  const [editShared, setEditShared] = useState(false);
  const editKeepRef = useRef<string[]>([]);
```

and after the `editingItem` state lines:

```tsx
  const editingRecord = editingItem ? records[editingItem.id] : undefined;
  // Only the creator can make a shared event personal again (D6).
  const lockShared = !!editingRecord && editingRecord.visibility === 'shared' && editingRecord.ownerId !== me?.id;
```

5. Replace `handleAddTask` with:

```tsx
  const handleAddTask = () => {
    if (!inputText.trim()) return;

    const result = parseEventInput(inputText, { selectedDateKey: selectedDateRef.current, knownTags });
    if (!result.ok) {
      Alert.alert("Oops!", "I couldn't find a date or time in that sentence.");
      return;
    }

    const seriesId = result.draft.isRecurring ? newUuid() : null;
    const fresh = draftToEvents(result.draft, newUuid, seriesId);
    const editing = editingItemRef.current;
    if (editing) {
      const current = records[editing.id]?.visibility ?? 'personal';
      // Without a family (or when locked) the event keeps the visibility it has.
      const visibility: Visibility = family && !lockShared ? (editShared ? 'shared' : 'personal') : current;
      const keep = editKeepRef.current;
      const plan = planEdit(editing, fresh);
      if (plan.kind === 'update') {
        updateEvent(withPeople(plan.event, memberByTag, visibility, keep));
      } else {
        deleteEvents(plan.removeIds);
        addEvents(plan.add.map(event => withPeople(event, memberByTag, visibility, keep)));
      }
      editingItemRef.current = null;
      editKeepRef.current = [];
      setEditingItem(null);
    } else {
      const visibility: Visibility = family && shareNew ? 'shared' : 'personal';
      addEvents(fresh.map(event => withPeople(event, memberByTag, visibility)));
    }
    setInputText('');
  };
```

6. Replace `handleEditItem` with:

```tsx
  const handleEditItem = useCallback((item: LocalEvent) => {
    const record = records[item.id];
    const { tags, keep } = record ? tagsForEditing(record, memberById) : { tags: item.people ?? [], keep: [] };
    editingItemRef.current = item;
    editKeepRef.current = keep;
    setEditShared(record?.visibility === 'shared');
    setEditingItem(item);
    setInputText(eventToSentence({ ...item, people: tags }));
  }, [records, memberById]);
```

7. Fix the editing banner's Cancel (it left `editingItemRef` set, so the next Add edited the old event):

```tsx
          <TouchableOpacity onPress={() => { editingItemRef.current = null; editKeepRef.current = []; setEditingItem(null); setInputText(''); }}>
```

8. Wrap the event list's providers with the meta context. Before the `return`, add:

```tsx
  const meta = useMemo(() => ({ records, memberById, myId: me?.id ?? null }), [records, memberById, me?.id]);
```

and change `<EditModeContext.Provider value={editMode}>` … `</EditModeContext.Provider>` to sit inside `<MetaContext.Provider value={meta}>` … `</MetaContext.Provider>`.

9. In the input area, before `<TextInput`, add:

```tsx
        {family ? (
          <ShareToggle
            shared={editingItem ? editShared : shareNew}
            onChange={editingItem ? setEditShared : setShareNew}
            disabled={(editMode && !editingItem) || lockShared}
          />
        ) : null}
```

10. Styles — add:

```ts
  itemText: { flex: 1 },
  legacyTag: { fontSize: 13, color: '#666', fontWeight: '600' },
  sharedLabel: { fontSize: 12, color: '#007BFF', marginTop: 2 },
```

and change `itemName` to drop `flex: 1` (the wrapping `itemText` now flexes): `itemName: { fontSize: 14, fontWeight: 'bold', color: '#333' },`.

- [ ] **Step 12: Run the tests**

Run: `npx jest "app/\(tabs\)" components/events lib/family`
Expected: PASS.

- [ ] **Step 13: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add lib/family components/events "app/(tabs)"
git commit -m "FEAT-002: Share events and tag family members from the planner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Create and join screens

**Files:**
- Modify: `components/auth/FormField.tsx`, `components/navigation/RootNavigator.tsx`
- Create: `app/family/create.tsx`, `app/family/join.tsx`
- Test: `components/family/__tests__/create-join.test.tsx`

**Interfaces:**
- Consumes: `useFamily()` → `createFamily(name)`, `joinFamily(code)`; `FamilyContext`, `fakeFamilyValue` (Task 2); `AuthScreen`, `FormField`, `PrimaryButton`, `Notice`, `authStyles` from `components/auth/`.
- Produces: routes `/family/create` and `/family/join` (signed-in only); `FormField` kinds `plain`, `code`, `tag`.

- [ ] **Step 1: Write the failing screen tests**

`components/family/__tests__/create-join.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { FamilyContext } from '@/context/FamilyProvider';
import { FAMILY_MESSAGES } from '@/lib/family/api';
import { fakeFamilyValue } from '@/test-utils/fakeFamily';

import CreateFamilyScreen from '../../../app/family/create';
import JoinFamilyScreen from '../../../app/family/join';

function renderAt(url: string, family = fakeFamilyValue({ family: null })) {
  renderRouter(
    {
      _layout: () => (
        <FamilyContext.Provider value={family}>
          <Slot />
        </FamilyContext.Provider>
      ),
      family: () => <Text>Family tab</Text>,
      'family/create': CreateFamilyScreen,
      'family/join': JoinFamilyScreen,
    },
    { initialUrl: url },
  );
  return family;
}

describe('Create a family', () => {
  it('creates the family and goes back to the Family tab', async () => {
    const family = renderAt('/family/create');
    fireEvent.changeText(screen.getByLabelText('Family name'), 'Smiths');
    fireEvent.press(screen.getByRole('button', { name: 'Create family' }));
    expect(await screen.findByText('Family tab')).toBeTruthy();
    expect(family.createFamily).toHaveBeenCalledWith('Smiths');
  });

  it('shows why it could not', async () => {
    const family = fakeFamilyValue({ family: null });
    (family.createFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    renderAt('/family/create', family);
    fireEvent.press(screen.getByRole('button', { name: 'Create family' }));
    expect(await screen.findByText(FAMILY_MESSAGES.offline)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create family' })).not.toBeDisabled();
  });
});

describe('Join a family', () => {
  it('joins with the typed code', async () => {
    const family = renderAt('/family/join');
    fireEvent.changeText(screen.getByLabelText('Invite code'), 'k7qm-2xwp');
    fireEvent.press(screen.getByRole('button', { name: 'Join family' }));
    expect(await screen.findByText('Family tab')).toBeTruthy();
    expect(family.joinFamily).toHaveBeenCalledWith('k7qm-2xwp');
  });

  it('explains a code that is not found', async () => {
    const family = fakeFamilyValue({ family: null });
    (family.joinFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.codeNotFound, offline: false });
    renderAt('/family/join', family);
    fireEvent.changeText(screen.getByLabelText('Invite code'), 'ZZZZZZZZ');
    fireEvent.press(screen.getByRole('button', { name: 'Join family' }));
    await waitFor(() => expect(screen.getByText(FAMILY_MESSAGES.codeNotFound)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/family`
Expected: FAIL — `Cannot find module '../../../app/family/create'`.

- [ ] **Step 3: Add the field kinds**

In `components/auth/FormField.tsx`, change `type Kind` and `KIND_PROPS`:

```tsx
type Kind = 'email' | 'password' | 'newPassword' | 'name' | 'plain' | 'code' | 'tag';

const KIND_PROPS: Record<Kind, TextInputProps> = {
  email: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', keyboardType: 'email-address', textContentType: 'emailAddress' },
  password: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'current-password', textContentType: 'password' },
  newPassword: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'new-password', textContentType: 'newPassword' },
  name: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
  plain: { autoCapitalize: 'sentences' },
  code: { autoCapitalize: 'characters', autoCorrect: false, autoComplete: 'off' },
  tag: { autoCapitalize: 'characters', autoCorrect: false, autoComplete: 'off', maxLength: 5 },
};
```

(`maxLength: 5` leaves room for a typed `@`.)

- [ ] **Step 4: Write the screens**

`app/family/create.tsx`:

```tsx
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useFamily } from '@/context/FamilyProvider';

export default function CreateFamilyScreen() {
  const { createFamily } = useFamily();
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createFamily(name);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/family');
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>
        Everyone you invite can see and edit the events you share. Your personal events stay private.
      </Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FormField label="Family name" value={name} onChangeText={setName} kind="plain" />
      <PrimaryButton title="Create family" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
```

`app/family/join.tsx`:

```tsx
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useFamily } from '@/context/FamilyProvider';

export default function JoinFamilyScreen() {
  const { joinFamily } = useFamily();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await joinFamily(code);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/family');
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Ask a family member for the 8-character code on their Family tab.</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <FormField label="Invite code" value={code} onChangeText={setCode} kind="code" />
      <PrimaryButton title="Join family" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
```

- [ ] **Step 5: Register the routes as signed-in only**

In `components/navigation/RootNavigator.tsx`, inside the first `Stack.Protected guard={signedIn}` group, after the `modal` screen, add:

```tsx
        <Stack.Screen name="family/create" options={{ title: 'Create a family' }} />
        <Stack.Screen name="family/join" options={{ title: 'Join a family' }} />
```

- [ ] **Step 6: Run the tests**

Run: `npx jest components/family components/navigation components/auth`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add app/family components/auth/FormField.tsx components/navigation/RootNavigator.tsx components/family
git commit -m "FEAT-002: Add screens to create and join a family

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Family tab

**Files:**
- Create: `components/family/FamilyScreen.tsx`, `app/(tabs)/family.tsx`
- Modify: `app/(tabs)/_layout.tsx`, `components/ui/icon-symbol.tsx`
- Delete: `app/(tabs)/explore.tsx`
- Test: `components/family/__tests__/FamilyScreen.test.tsx`

**Interfaces:**
- Consumes: `useFamily()` (all fields); `formatInviteCode` (Task 1); `memberLabel` (Task 4); `MemberAvatar` (Task 4); `FormField` kinds `name` and `tag` (Task 5); `Notice`, `PrimaryButton`; routes `/family/create`, `/family/join` (Task 5).
- Produces: `FamilyScreen` component; the Family tab at `/family`.

- [ ] **Step 1: Write the failing screen tests**

`components/family/__tests__/FamilyScreen.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Alert, Text } from 'react-native';

import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import { FAMILY_MESSAGES } from '@/lib/family/api';
import { FAKE_BOB, FAKE_ME, fakeFamilyValue } from '@/test-utils/fakeFamily';

import { FamilyScreen } from '../FamilyScreen';

function renderScreen(family: FamilyValue = fakeFamilyValue()) {
  renderRouter(
    {
      _layout: () => (
        <FamilyContext.Provider value={family}>
          <Slot />
        </FamilyContext.Provider>
      ),
      family: FamilyScreen,
      'family/create': () => <Text>Create screen</Text>,
      'family/join': () => <Text>Join screen</Text>,
    },
    { initialUrl: '/family' },
  );
  return family;
}

/** Answer the next Alert by pressing the button with this text. */
function answerAlert(buttonText: string) {
  jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _message, buttons) => {
    buttons?.find(b => b.text === buttonText)?.onPress?.();
  });
}

afterEach(() => jest.restoreAllMocks());

describe('Family tab without a family', () => {
  const alone = () => fakeFamilyValue({ family: null, members: [FAKE_ME], isOwner: false });

  it('offers to create or join', async () => {
    renderScreen(alone());
    fireEvent.press(await screen.findByRole('button', { name: 'Create a family' }));
    expect(await screen.findByText('Create screen')).toBeTruthy();
  });

  it('goes to the join screen', async () => {
    renderScreen(alone());
    fireEvent.press(await screen.findByRole('button', { name: 'Join with a code' }));
    expect(await screen.findByText('Join screen')).toBeTruthy();
  });
});

describe('Family tab in a family', () => {
  it('shows the family, its code and members', async () => {
    renderScreen();
    expect(await screen.findByText('Smiths')).toBeTruthy();
    expect(screen.getByText('K7QM-2XWP')).toBeTruthy();
    expect(screen.getByText('You (owner)')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('@BE')).toBeTruthy();
  });

  it('lets the owner remove a member after confirming', async () => {
    const family = renderScreen();
    answerAlert('Remove');
    fireEvent.press(await screen.findByRole('button', { name: 'Remove Bob' }));
    await waitFor(() => expect(family.removeMember).toHaveBeenCalledWith(FAKE_BOB.id));
  });

  it('lets the owner make a new code after confirming', async () => {
    const family = renderScreen();
    answerAlert('New code');
    fireEvent.press(await screen.findByRole('button', { name: 'New code' }));
    await waitFor(() => expect(family.regenerateInviteCode).toHaveBeenCalled());
  });

  it("doesn't offer owner actions to a member", async () => {
    renderScreen(fakeFamilyValue({ isOwner: false, family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_BOB.id, inviteCode: 'K7QM2XWP' } }));
    expect(await screen.findByText('Bob (owner)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Bob' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New code' })).toBeNull();
  });

  it('shows why leaving failed', async () => {
    const family = fakeFamilyValue();
    (family.leaveFamily as jest.Mock).mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    renderScreen(family);
    answerAlert('Leave');
    fireEvent.press(await screen.findByRole('button', { name: 'Leave family' }));
    expect(await screen.findByText(FAMILY_MESSAGES.offline)).toBeTruthy();
  });

  it('says when it may be out of date', async () => {
    renderScreen(fakeFamilyValue({ offline: true }));
    expect(await screen.findByText("You're offline, so this may be out of date.")).toBeTruthy();
  });
});

describe('Your name and tag', () => {
  it('saves what you typed', async () => {
    const family = renderScreen();
    fireEvent.changeText(await screen.findByLabelText('Your tag'), 'ali');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(family.updateProfile).toHaveBeenCalledWith({ displayName: 'Alice', tag: 'ali' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows why it could not save', async () => {
    const family = fakeFamilyValue();
    (family.updateProfile as jest.Mock).mockResolvedValueOnce({ ok: false, message: 'Someone in your family already uses @BE.', offline: false });
    renderScreen(family);
    fireEvent.press(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Someone in your family already uses @BE.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest components/family/__tests__/FamilyScreen.test.tsx`
Expected: FAIL — `Cannot find module '../FamilyScreen'`.

- [ ] **Step 3: Write the screen**

`components/family/FamilyScreen.tsx`:

```tsx
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { BLUE } from '@/components/auth/styles';
import { MemberAvatar } from '@/components/events/MemberAvatar';
import { useFamily } from '@/context/FamilyProvider';
import { memberLabel } from '@/lib/family/tags';
import type { FamilyResult, Member } from '@/lib/family/types';
import { formatInviteCode } from '@/lib/family/validation';

export function FamilyScreen() {
  const { me, family, loading, offline } = useFamily();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Family</Text>
      {offline ? <Notice tone="info">You&apos;re offline, so this may be out of date.</Notice> : null}
      {me ? <ProfileSection me={me} /> : null}
      {loading ? <ActivityIndicator color={BLUE} /> : family ? <FamilySection /> : <NoFamilySection />}
    </ScrollView>
  );
}

function ProfileSection({ me }: { me: Member }) {
  const { updateProfile } = useFamily();
  const [name, setName] = useState(me.displayName ?? '');
  const [tag, setTag] = useState(me.tag ?? '');
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // When the server's version arrives (or changes), show it.
  useEffect(() => {
    setName(me.displayName ?? '');
    setTag(me.tag ?? '');
  }, [me.displayName, me.tag]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const result = await updateProfile({ displayName: name, tag });
    setBusy(false);
    setMessage(result.ok ? { tone: 'info', text: 'Saved.' } : { tone: 'error', text: result.message });
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>You</Text>
      <Text style={styles.hint}>Your tag lets family members add you to an event by typing @ and the tag, like @AZ.</Text>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormField label="Your name" value={name} onChangeText={setName} kind="name" />
      <FormField label="Your tag" value={tag} onChangeText={setTag} kind="tag" />
      <PrimaryButton title="Save" onPress={save} busy={busy} />
    </View>
  );
}

function NoFamilySection() {
  const router = useRouter();
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Your family</Text>
      <Text style={styles.hint}>
        You&apos;re not in a family yet. Create one and invite others, or join with a code someone sent you.
      </Text>
      <PrimaryButton title="Create a family" onPress={() => router.push('/family/create')} />
      <PrimaryButton title="Join with a code" onPress={() => router.push('/family/join')} />
    </View>
  );
}

function FamilySection() {
  const { family, members, me, isOwner, regenerateInviteCode, removeMember, leaveFamily } = useFamily();
  const [error, setError] = useState<string | null>(null);
  if (!family) return null;

  const myId = me?.id ?? null;
  const code = formatInviteCode(family.inviteCode);
  const report = (result: FamilyResult<unknown>) => setError(result.ok ? null : result.message);

  const shareCode = () => {
    void Share.share({ message: `Join our family "${family.name}" on Plan-Me with the invite code ${code}.` });
  };

  const newCode = () =>
    Alert.alert('New invite code', 'The old code will stop working. Everyone already in the family stays in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'New code', onPress: () => void regenerateInviteCode().then(report) },
    ]);

  const remove = (member: Member) => {
    const name = memberLabel(member, null);
    Alert.alert(`Remove ${name}?`, "They'll stop seeing the family's shared events. Events they shared stay with the family.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeMember(member.id).then(report) },
    ]);
  };

  const leave = () => {
    const consequence =
      members.length <= 1
        ? "You're the only member, so the family will be deleted and your shared events become personal."
        : "You'll stop seeing the family's shared events. Events you shared stay with the family." +
          (isOwner ? ' The member who joined first becomes the owner.' : '');
    Alert.alert('Leave the family?', consequence, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => void leaveFamily().then(report) },
    ]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{family.name}</Text>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Text style={styles.label}>Invite code</Text>
      <Text style={styles.code} accessibilityLabel={`Invite code ${code}`}>
        {code}
      </Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Share code" onPress={shareCode} hitSlop={8}>
          <Text style={styles.link}>Share code</Text>
        </Pressable>
        {isOwner ? (
          <Pressable accessibilityRole="button" accessibilityLabel="New code" onPress={newCode} hitSlop={8}>
            <Text style={styles.link}>New code</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.label}>Members</Text>
      {members.map(member => {
        const label = memberLabel(member, myId);
        return (
          <View key={member.id} style={styles.member}>
            <MemberAvatar member={member} />
            <View style={styles.memberText}>
              <Text style={styles.memberName}>
                {label}
                {member.id === family.ownerId ? ' (owner)' : ''}
              </Text>
              {member.tag && label !== `@${member.tag}` ? <Text style={styles.memberTag}>@{member.tag}</Text> : null}
            </View>
            {isOwner && member.id !== myId ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${memberLabel(member, null)}`} onPress={() => remove(member)} hitSlop={8}>
                <Text style={styles.danger}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <Pressable accessibilityRole="button" accessibilityLabel="Leave family" onPress={leave} style={styles.leave}>
        <Text style={styles.danger}>Leave family</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: 'bold', color: BLUE, marginBottom: 16 },
  section: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  hint: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: '#777', marginTop: 12, marginBottom: 6 },
  code: { fontSize: 24, fontWeight: 'bold', letterSpacing: 2, color: '#333' },
  row: { flexDirection: 'row', gap: 20, marginTop: 8 },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  memberText: { flex: 1, marginLeft: 10 },
  memberName: { fontSize: 15, color: '#333', fontWeight: '600' },
  memberTag: { fontSize: 13, color: '#777' },
  danger: { color: '#dc3545', fontSize: 15, fontWeight: '600' },
  leave: { marginTop: 20, alignItems: 'center' },
});
```

`app/(tabs)/family.tsx`:

```tsx
import { FamilyScreen } from '@/components/family/FamilyScreen';

export default FamilyScreen;
```

- [ ] **Step 4: Replace the Explore tab**

1. Delete `app/(tabs)/explore.tsx`.
2. In `components/ui/icon-symbol.tsx`, add to `MAPPING`: `'person.2.fill': 'group',`.
3. In `app/(tabs)/_layout.tsx`, replace the `explore` screen with:

```tsx
      <Tabs.Screen
        name="family"
        options={{
          title: 'Family',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.2.fill" color={color} />,
        }}
      />
```

4. Search for any remaining reference to `explore` (`grep -rn "explore" app components`). Remove what you find, except unrelated words.

- [ ] **Step 5: Run the tests**

Run: `npx jest components/family components/navigation`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add -A "app/(tabs)" components/family components/ui/icon-symbol.tsx
git commit -m "FEAT-002: Add the Family tab with members, invite code and your tag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: One-time tag mapping ("Who is @AZ?")

**Files:**
- Create: `lib/family/tagMapping.ts`, `components/family/TagMappingPrompt.tsx`
- Modify: `app/(tabs)/index.tsx`
- Test: `lib/family/__tests__/tagMapping.test.ts`, `components/family/__tests__/TagMappingPrompt.test.tsx`

**Interfaces:**
- Consumes: `familyKeys(userId).tagAnswers` (Task 2); `EventInput`, `EventRecord` (Task 3); `useEvents()` → `{ records, updateEvent, legacy }`; `useAuth()` → `user`; `useFamily()` → `{ family, members, me }`; `memberLabel` (Task 4), `MemberAvatar` (Task 4).
- Produces:
  - `TagAnswers = Record<string, string | null>`
  - `readTagAnswers(storage, userId): Promise<TagAnswers>`, `saveTagAnswer(storage, userId, tag, memberId | null): Promise<TagAnswers>`
  - `legacyTagsIn(records): string[]`, `nextTagToAsk(records, answers): string | null`, `remapTags(records, answers, memberIds: ReadonlySet<string>): EventInput[]`
  - `TagMappingPrompt({ storage? })`

- [ ] **Step 1: Write the failing mapping tests**

`lib/family/__tests__/tagMapping.test.ts`:

```ts
import type { EventRecord } from '@/lib/events/rows';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { legacyTagsIn, nextTagToAsk, readTagAnswers, remapTags, saveTagAnswer } from '../tagMapping';

const record = (id: string, people: string[] | undefined, memberIds: string[] = []): EventRecord => ({
  id,
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '',
  endTime: '',
  people,
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds,
  updatedAt: null,
});

const records = {
  a: record('a', ['GS', 'AZ']),
  b: record('b', ['AZ'], ['user-2']),
  c: record('c', undefined),
};

describe('tag mapping', () => {
  it('lists the old tags in order', () => {
    expect(legacyTagsIn(records)).toEqual(['AZ', 'GS']);
  });

  it('asks about each tag once', () => {
    expect(nextTagToAsk(records, {})).toBe('AZ');
    expect(nextTagToAsk(records, { AZ: 'user-2' })).toBe('GS');
    expect(nextTagToAsk(records, { AZ: 'user-2', GS: null })).toBeNull();
  });

  it('moves answered tags to members, once per member', () => {
    expect(remapTags(records, { AZ: 'user-2', GS: null }, new Set(['user-1', 'user-2']))).toEqual([
      { ...records.a, people: ['GS'], memberIds: ['user-2'] },
      { ...records.b, people: undefined, memberIds: ['user-2'] },
    ]);
  });

  it('ignores an answer for someone no longer in the family', () => {
    expect(remapTags(records, { AZ: 'gone' }, new Set(['user-1']))).toEqual([]);
  });

  it('saves answers per user', async () => {
    const storage = memoryStorage();
    expect(await saveTagAnswer(storage, 'user-1', 'AZ', 'user-2')).toEqual({ AZ: 'user-2' });
    expect(await saveTagAnswer(storage, 'user-1', 'GS', null)).toEqual({ AZ: 'user-2', GS: null });
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: 'user-2', GS: null });
    expect(await readTagAnswers(storage, 'user-2')).toEqual({});
  });

  it('treats damaged answers as none', async () => {
    const storage = memoryStorage();
    await storage.setItem('planme:tagMap:user-1', '[1,2]');
    expect(await readTagAnswers(storage, 'user-1')).toEqual({});
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/family/__tests__/tagMapping.test.ts`
Expected: FAIL — `Cannot find module '../tagMapping'`.

- [ ] **Step 3: Write tagMapping.ts**

`lib/family/tagMapping.ts`:

```ts
import type { EventInput, EventRecord } from '@/lib/events/rows';
import type { KeyValueStorage } from '@/lib/events/store';

import { familyKeys } from './cache';

/** For each old tag: the member it means, or null for "no one, keep it as text". */
export type TagAnswers = Record<string, string | null>;

export async function readTagAnswers(storage: KeyValueStorage, userId: string): Promise<TagAnswers> {
  try {
    const raw = await storage.getItem(familyKeys(userId).tagAnswers);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

export async function saveTagAnswer(storage: KeyValueStorage, userId: string, tag: string, memberId: string | null): Promise<TagAnswers> {
  const answers = { ...(await readTagAnswers(storage, userId)), [tag]: memberId };
  await storage.setItem(familyKeys(userId).tagAnswers, JSON.stringify(answers));
  return answers;
}

/** Old tags on events (not linked to a member), in alphabetical order. */
export function legacyTagsIn(records: Record<string, EventRecord>): string[] {
  return [...new Set(Object.values(records).flatMap(r => r.people ?? []))].sort();
}

export function nextTagToAsk(records: Record<string, EventRecord>, answers: TagAnswers): string | null {
  return legacyTagsIn(records).find(tag => !(tag in answers)) ?? null;
}

/** Events whose old tags now have a member in the family, with those tags moved to `memberIds`. */
export function remapTags(records: Record<string, EventRecord>, answers: TagAnswers, memberIds: ReadonlySet<string>): EventInput[] {
  const changed: EventInput[] = [];
  for (const record of Object.values(records)) {
    const tags = record.people ?? [];
    const moving = tags.filter(tag => {
      const id = answers[tag];
      return typeof id === 'string' && memberIds.has(id);
    });
    if (moving.length === 0) continue;
    const ids = [...record.memberIds];
    for (const tag of moving) {
      const id = answers[tag] as string;
      if (!ids.includes(id)) ids.push(id);
    }
    const left = tags.filter(tag => !moving.includes(tag));
    changed.push({ ...record, people: left.length > 0 ? left : undefined, memberIds: ids });
  }
  return changed;
}
```

- [ ] **Step 4: Run the mapping tests**

Run: `npx jest lib/family/__tests__/tagMapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing prompt tests**

`components/family/__tests__/TagMappingPrompt.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthProvider } from '@/context/AuthProvider';
import { EventsProvider } from '@/context/EventsProvider';
import { FamilyContext, type FamilyValue } from '@/context/FamilyProvider';
import type { EventRecord } from '@/lib/events/rows';
import { readTagAnswers } from '@/lib/family/tagMapping';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, fakeFamilyValue } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { TagMappingPrompt } from '../TagMappingPrompt';

const idle = { state: 'idle' as const, pending: 0, lastSyncedAt: null };
const swim: EventRecord = {
  id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f',
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '07:00',
  endTime: '',
  people: ['AZ'],
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
};

function renderPrompt(family: FamilyValue = fakeFamilyValue(), storage = memoryStorage()) {
  render(
    <AuthProvider client={fakeAuthClient(fakeSession()).client}>
      <EventsProvider storage={storage} createEngine={createFakeEngine}>
        <FamilyContext.Provider value={family}>
          <TagMappingPrompt storage={storage} />
        </FamilyContext.Provider>
      </EventsProvider>
    </AuthProvider>,
  );
  return storage;
}

const engine = () => FakeEngine.instances[0];

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('TagMappingPrompt', () => {
  it('asks who an old tag is and moves it to that member', async () => {
    const storage = renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ [swim.id]: swim }, idle));
    expect(await screen.findByText('Who is @AZ?')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bob' }));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    expect(engine().updated[0]).toMatchObject({ id: swim.id, memberIds: [FAKE_BOB.id], people: undefined });
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: FAKE_BOB.id });
  });

  it('keeps the tag as text when it is no one, and does not ask again', async () => {
    const storage = renderPrompt();
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ [swim.id]: swim }, idle));
    fireEvent.press(await screen.findByRole('button', { name: 'No one, keep it as text' }));
    await waitFor(() => expect(screen.queryByText('Who is @AZ?')).toBeNull());
    expect(engine().updated).toHaveLength(0);
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: null });
  });

  it('waits until you are in a family', async () => {
    renderPrompt(fakeFamilyValue({ family: null }));
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({ [swim.id]: swim }, idle));
    await act(async () => {});
    expect(screen.queryByText('Who is @AZ?')).toBeNull();
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx jest components/family/__tests__/TagMappingPrompt.test.tsx`
Expected: FAIL — `Cannot find module '../TagMappingPrompt'`.

- [ ] **Step 7: Write the prompt**

`components/family/TagMappingPrompt.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MemberAvatar } from '@/components/events/MemberAvatar';
import { useAuth } from '@/context/AuthProvider';
import { useEvents } from '@/context/EventsProvider';
import { useFamily } from '@/context/FamilyProvider';
import type { KeyValueStorage } from '@/lib/events/store';
import { nextTagToAsk, readTagAnswers, remapTags, saveTagAnswer, type TagAnswers } from '@/lib/family/tagMapping';
import { memberLabel } from '@/lib/family/tags';

/** Asks once per old tag (such as @AZ) which family member it means (spec §6.7). */
export function TagMappingPrompt({ storage = AsyncStorage }: { storage?: KeyValueStorage }) {
  const { user } = useAuth();
  const { records, updateEvent, legacy } = useEvents();
  const { family, members, me } = useFamily();
  const userId = user?.id ?? null;
  // Answers belong to one user.
  const [state, setState] = useState<{ userId: string; answers: TagAnswers } | null>(null);
  const answers = state && state.userId === userId ? state.answers : null;
  const sentRef = useRef(new Set<string>());

  useEffect(() => {
    setState(null);
    sentRef.current = new Set();
    if (!userId) return;
    let active = true;
    readTagAnswers(storage, userId).then(saved => {
      if (active) setState({ userId, answers: saved });
    });
    return () => {
      active = false;
    };
  }, [userId, storage]);

  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members]);

  // Move tags that have an answer, including on events that arrive later from other phones.
  useEffect(() => {
    if (!answers || !family) return;
    for (const event of remapTags(records, answers, memberIds)) {
      const key = `${event.id}:${(records[event.id]?.people ?? []).join(',')}`;
      if (sentRef.current.has(key)) continue;
      sentRef.current.add(key);
      updateEvent(event);
    }
  }, [answers, family, records, memberIds, updateEvent]);

  // One question at a time, and not while the import question is showing.
  const tag = answers && family && legacy === null ? nextTagToAsk(records, answers) : null;
  if (!tag || !userId) return null;

  const answer = async (memberId: string | null) => {
    try {
      const next = await saveTagAnswer(storage, userId, tag, memberId);
      setState({ userId, answers: next });
    } catch {
      // Storage failed: the question stays, so the user can try again.
    }
  };

  const myId = me?.id ?? null;
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Who is @{tag}?</Text>
          <Text style={styles.body}>
            Some of your events are tagged @{tag}. Pick the family member it means, and those events will show them.
          </Text>
          {members.map(member => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={memberLabel(member, myId)}
              onPress={() => void answer(member.id)}
              style={styles.option}
            >
              <MemberAvatar member={member} />
              <Text style={styles.optionText}>{memberLabel(member, myId)}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="No one, keep it as text"
            onPress={() => void answer(null)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>No one, keep it as text</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 12 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  optionText: { fontSize: 16, color: '#333', marginLeft: 10 },
  secondary: { marginTop: 12, alignItems: 'center' },
  secondaryText: { color: '#007BFF', fontSize: 15, fontWeight: '600' },
});
```

In `app/(tabs)/index.tsx`, import `TagMappingPrompt` from `@/components/family/TagMappingPrompt` and render `<TagMappingPrompt />` right after `<LegacyImportPrompt />`.

- [ ] **Step 8: Run the tests**

Run: `npx jest lib/family components/family "app/\(tabs\)"`
Expected: PASS. (The planner test's records carry no old tags, so the prompt stays hidden there.)

- [ ] **Step 9: Check and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add lib/family components/family "app/(tabs)/index.tsx"
git commit -m "FEAT-002: Ask once which family member each old tag means

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Plan 4 follow-ups — claim writes

From the roadmap's "Plan 5, carried from plan 4's final review" notes: claim writes can overwrite each other, and `markClaimQueued` runs even when the outbox wasn't saved.

**Files:**
- Modify: `lib/events/legacy.ts`, `lib/events/syncEngine.ts`, `context/EventsProvider.tsx`, `test-utils/fakeEngine.ts`, and every other fake engine that implements `SyncEngineLike` (`grep -rln "implements SyncEngineLike" context components lib test-utils`)
- Test: `lib/events/__tests__/legacy.test.ts`, `lib/events/__tests__/syncEngine.test.ts`, `context/__tests__/EventsProvider.test.tsx`

**Interfaces:**
- Consumes: Plan 4's `legacy.ts` claim functions and `SyncEngine`.
- Produces:
  - `SyncEngineLike.create(records): Promise<boolean>` — true once the records and queued changes are saved on the phone
  - Claim writes (`claimLegacy`, `finishLegacyClaim`, `markClaimQueued`, `dropFromClaim`, `releaseLegacyClaim`) run one at a time per storage; `dropFromClaim` writes nothing when no claimed id matches

- [ ] **Step 1: Write the failing tests**

Add to `lib/events/__tests__/legacy.test.ts` (it already has `withLegacy()` — two old events, `a` and `b` — and `newId()`; add `activeClaim`, `dropFromClaim` and `markClaimQueued` to its `../legacy` import if they are missing):

```ts
describe('claim writes', () => {
  it('runs two quick drops one after the other, so neither is lost', async () => {
    const storage = withLegacy();
    const [first, second] = await claimLegacy(storage, 'user-1', newId);
    await Promise.all([dropFromClaim(storage, 'user-1', [first.id]), dropFromClaim(storage, 'user-1', [second.id])]);
    const claim = await activeClaim(storage, 'user-1');
    expect(claim?.records).toEqual([]);
  });

  it('keeps the queued flag when a drop runs at the same time', async () => {
    const storage = withLegacy();
    const [first, second] = await claimLegacy(storage, 'user-1', newId);
    await Promise.all([markClaimQueued(storage, 'user-1'), dropFromClaim(storage, 'user-1', [first.id])]);
    const claim = await activeClaim(storage, 'user-1');
    expect(claim?.queued).toBe(true);
    expect(claim?.records.map(r => r.id)).toEqual([second.id]);
  });

  it("doesn't rewrite the claim for an event it doesn't hold", async () => {
    const storage = withLegacy();
    await claimLegacy(storage, 'user-1', newId);
    const setItem = jest.spyOn(storage, 'setItem');
    await dropFromClaim(storage, 'user-1', ['not-claimed']);
    expect(setItem).not.toHaveBeenCalled();
  });
});
```

Add to `lib/events/__tests__/syncEngine.test.ts` (it already has `staticClient`, `ok`, `rec` and the `engines` clean-up list):

```ts
  it('says whether a create was saved on the phone', async () => {
    const storage = memoryStorage();
    const engine = new SyncEngine({ client: staticClient(ok), userId: 'user-save', storage, canSync: false, realtime: false, onChange: () => {} });
    engines.push(engine);
    await engine.start();
    expect(await engine.create([rec('user-save')])).toBe(true);

    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await engine.create([rec('user-save')])).toBe(false);
  });
```

Add to `context/__tests__/EventsProvider.test.tsx`:

```tsx
  it("doesn't mark the claim queued when the events weren't saved", async () => {
    const { result, storage } = setup();
    await storage.setItem(LEGACY_KEYS.items, JSON.stringify({ '2026-11-03': [swim] }));
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({}, idle));
    engine().createResult = false;
    await act(async () => {
      await result.current.claimLegacy();
    });
    const claim = JSON.parse((await storage.getItem(LEGACY_KEYS.claim)) ?? 'null');
    expect(claim.queued).toBeUndefined();
  });

  it('does not bring back a claimed event deleted before a restart, and still finishes the claim', async () => {
    const storage = memoryStorage();
    const swim2 = { ...swim, id: 'e2', name: 'Swim 2' };
    await storage.setItem(LEGACY_KEYS.items, JSON.stringify({ '2026-11-03': [swim, swim2] }));
    const first = setupWith(storage);
    await waitFor(() => expect(engine(0)).toBeDefined());
    act(() => engine(0).options.onChange({}, idle));
    await act(async () => {
      await first.result.current.claimLegacy();
    });
    const [kept, deleted] = engine(0).created[0];
    act(() => engine(0).options.onChange({ [kept.id]: kept, [deleted.id]: deleted }, { ...idle, pending: 2 }));
    act(() => first.result.current.deleteEvents([deleted.id]));
    await waitFor(async () => {
      const claim = JSON.parse((await storage.getItem(LEGACY_KEYS.claim)) ?? 'null');
      expect(claim.records.map((r: { id: string }) => r.id)).toEqual([kept.id]);
    });
    first.unmount();

    // Restart: a new engine with only the kept event, synced after the claim.
    setupWith(storage);
    await waitFor(() => expect(engine(1)).toBeDefined());
    act(() => engine(1).options.onChange({ [kept.id]: kept }, { state: 'idle', pending: 0, lastSyncedAt: new Date(Date.now() + 1000).toISOString() }));
    await waitFor(async () => expect(await storage.getItem(LEGACY_KEYS.items)).toBeNull());
    expect(engine(1).created).toHaveLength(0);
  });
```

These two tests need two additions to that file. In its `FakeEngine`, add `createResult = true;` and make `create` return it:

```tsx
  createResult = true;
  async create(records: EventRecord[]) {
    this.created.push(records);
    return this.createResult;
  }
```

And add a `setupWith` helper next to `setup` (the same, with a given storage; `renderHook` already returns `unmount`):

```tsx
function setupWith(storage: ReturnType<typeof memoryStorage>, fake = fakeAuthClient(fakeSession())) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={fake.client}>
      <EventsProvider storage={storage} createEngine={createEngine}>
        {children}
      </EventsProvider>
    </AuthProvider>
  );
  return { fake, storage, ...renderHook(() => useEvents(), { wrapper }) };
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/legacy.test.ts lib/events/__tests__/syncEngine.test.ts context/__tests__/EventsProvider.test.tsx`
Expected: FAIL — drops race, `create` returns undefined, queued is set after a failed save.

- [ ] **Step 3: Run claim writes one at a time**

In `lib/events/legacy.ts`, add after the imports:

```ts
// Claim changes read the claim, then write it back. Run them one at a time per storage so that two
// quick deletes (or a delete and markClaimQueued) can't overwrite each other's change.
const queues = new WeakMap<KeyValueStorage, Promise<unknown>>();
function inOrder<T>(storage: KeyValueStorage, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(storage) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(storage, next.catch(() => undefined));
  return next;
}
```

Then wrap the bodies of `claimLegacy`, `finishLegacyClaim`, `markClaimQueued`, `dropFromClaim` and `releaseLegacyClaim` in `return inOrder(storage, async () => { …existing body… });`. Keep each function's signature and its existing logic. In `dropFromClaim`, return without writing when no id was removed:

```ts
    const records = claim.records.filter(r => !ids.includes(r.id));
    if (records.length === claim.records.length) return;
```

(Adapt the names to the function's existing variables; the point is to compare lengths before `setItem`.)

- [ ] **Step 4: Report whether a create was saved**

In `lib/events/syncEngine.ts`:

1. In `SyncEngineLike`, change `create(records: EventRecord[]): Promise<void>;` to:

```ts
  /** True once the records and their queued changes are saved on the phone. */
  create(records: EventRecord[]): Promise<boolean>;
```

2. Change `saving`'s type to `private saving: Promise<boolean> = Promise.resolve(true);`
3. Replace `persist()`:

```ts
  /** Save a snapshot. Resolves true when it reached storage. */
  private persist(): Promise<boolean> {
    if (this.cleared || this.stopped || this.loadFailed) return this.saving.then(() => false);
    const snapshot: UserData = { records: { ...this.data.records }, outbox: [...this.data.outbox], lastFullSync: this.data.lastFullSync };
    this.saving = this.saving.then(() =>
      this.cleared
        ? false
        : saveUserData(this.options.storage, this.options.userId, snapshot).then(
            () => true,
            () => false,
          ),
    );
    return this.saving;
  }
```

4. Replace `changed()`:

```ts
  private async changed(): Promise<boolean> {
    this.emit();
    const saved = await this.persist();
    void this.sync();
    return saved;
  }
```

5. In `create`, change `if (this.stopped) return;` to `if (this.stopped) return false;` and `await this.changed();` to `return this.changed();`; change its return type to `Promise<boolean>`. `update` and `remove` stay as they are (`Promise<void>`, still `await this.changed();`); they ignore the result.
6. `clearLocalData` keeps `await this.saving;`.

- [ ] **Step 5: Queue the claim only after a save**

In `context/EventsProvider.tsx`:

1. In `claimLegacy`, replace the block that calls `engine.create(...)` then `markClaimQueued`:

```tsx
      if (claimed.length > 0) {
        const saved = await engine.create(claimed.filter(r => !(r.id in recordsRef.current)));
        if (saved && engineRef.current === engine) {
          await markClaimQueued(storage, uid);
        }
      }
```

2. In the re-queue effect, replace `void engine.create(missing);` with:

```tsx
        void engine.create(missing).then(saved => {
          if (saved && engineRef.current === engine) return markClaimQueued(storage, userId);
        });
```

3. Update every fake engine: `test-utils/fakeEngine.ts` gets `createResult = true;` and `async create(records: EventRecord[]) { this.created.push(records); return this.createResult; }`. Do the same in the fake engines inside `context/__tests__/EventsProvider.test.tsx`, `components/auth/__tests__/SignOutButton.test.tsx` and any other file the grep in **Files** found.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint && npm run test:integration`

```bash
git add lib/events context components test-utils
git commit -m "FEAT-002: Save claim changes in order and mark a claim queued only once saved

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Plan 4 follow-ups — a stuck queue and a failed load

From the roadmap notes: one change that keeps getting a server error blocks the queue forever; a failed storage load is never retried; `npm run test:integration` prints "failed to exit gracefully".

**Files:**
- Modify: `lib/events/outbox.ts`, `lib/events/syncEngine.ts`, `jest.integration.config.js`
- Test: `lib/events/__tests__/flushOutbox.test.ts`, `lib/events/__tests__/syncEngine.test.ts`

**Interfaces:**
- Consumes: Task 3's `refused` count.
- Produces: `FlushOutcome.failed?: { opId: string; status: number }` (set when sending stopped on a network-class failure); engine gives up on one change after `MAX_SERVER_ERRORS = 5` server errors (5xx) in a row and counts it as refused; a failed load is retried on the next sync.

- [ ] **Step 1: Write the failing tests**

Add to `lib/events/__tests__/flushOutbox.test.ts` (it already has `makeClient` and `insertOp`):

```ts
  it('says which change failed and how', async () => {
    const client = makeClient([{ error: { code: '' }, status: 503 }]);
    expect(await flushOutbox(client, [insertOp('op1')])).toEqual({
      done: [],
      stoppedBy: 'network',
      rejected: 0,
      failed: { opId: 'op1', status: 503 },
    });
  });
```

Add to `lib/events/__tests__/syncEngine.test.ts` (it already has `staticClient`, `ok`, `rec`, `engines`, and imports `saveUserData`; add `loadUserData` to that `../store` import):

```ts
  it('gives up on a change after five server errors in a row', async () => {
    jest.useFakeTimers();
    try {
      // Every insert gets a 503; the re-fetch finds nothing.
      const client = {
        from: () => ({
          insert: () => Promise.resolve({ error: { code: '' }, status: 503 }),
          update: () => ({ eq: () => Promise.resolve(ok()) }),
          select: () => ({
            is: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null, status: 200 }) }) }),
          }),
        }),
      } as unknown as SupabaseClient;
      let latest: SyncStatus | null = null;
      const engine = new SyncEngine({
        client,
        userId: 'user-5xx',
        storage: memoryStorage(),
        canSync: true,
        realtime: false,
        onChange: (_records, status) => {
          latest = status;
        },
      });
      engines.push(engine);
      await engine.start();
      await engine.create([rec('user-5xx')]);
      for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(engine.pending).toBe(0);
      expect(latest?.refused).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tries loading again on the next sync, keeping changes made meanwhile', async () => {
    const storage = memoryStorage();
    const stored = rec('user-load');
    await saveUserData(storage, 'user-load', { records: { [stored.id]: stored }, outbox: [], lastFullSync: null });
    // The first read fails, as if storage were busy at start.
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('busy'));
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: 'user-load',
      storage,
      canSync: false,
      realtime: false,
      onChange: next => {
        records = next;
      },
    });
    engines.push(engine);
    await engine.start();
    const added = rec('user-load');
    await engine.create([added]);
    await engine.sync(true);
    expect(Object.keys(records).sort()).toEqual([stored.id, added.id].sort());
    expect((await loadUserData(storage, 'user-load')).records[added.id]).toBeDefined();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx jest lib/events/__tests__/flushOutbox.test.ts lib/events/__tests__/syncEngine.test.ts`
Expected: FAIL — no `failed` field; the op stays queued; the load isn't retried.

- [ ] **Step 3: Report the failed change**

In `lib/events/outbox.ts`:

1. Add to `FlushOutcome`:

```ts
  /** The change sending stopped at, when it stopped on a network-class failure. */
  failed?: { opId: string; status: number };
```

2. In `flushOutbox`, change `if (failure !== 'rejected') return { done, stoppedBy: failure, rejected };` to:

```ts
      if (failure !== 'rejected') return { done, stoppedBy: failure, rejected, failed: { opId: op.opId, status } };
```

- [ ] **Step 4: Give up after repeated server errors, and retry a failed load**

In `lib/events/syncEngine.ts`:

1. Add after `REFRESH_AFTER_MS`:

```ts
/** A change that gets this many server errors (5xx) in a row is dropped, so it can't block the queue. */
const MAX_SERVER_ERRORS = 5;
```

2. Add a field: `private serverErrors = new Map<string, number>();`
3. In `runSync`, replace the `if (outcome.stoppedBy) { this.fail(outcome.stoppedBy); return; }` block with:

```ts
      if (outcome.stoppedBy) {
        const failed = outcome.failed;
        if (outcome.stoppedBy === 'network' && failed && failed.status >= 500) {
          const count = (this.serverErrors.get(failed.opId) ?? 0) + 1;
          this.serverErrors.set(failed.opId, count);
          if (count >= MAX_SERVER_ERRORS) {
            this.serverErrors.delete(failed.opId);
            this.data.outbox = this.data.outbox.filter(op => op.opId !== failed.opId);
            this.refused += 1;
            this.wantRefresh = true;
            await this.persist();
          }
        }
        this.fail(outcome.stoppedBy);
        return;
      }
```

4. At the top of `runSync`, before `if (!this.canSync || this.loadFailed)`, add:

```ts
    if (this.loadFailed) await this.retryLoad();
```

5. Add the method:

```ts
  /** Storage failed at start: try again, then put the changes made since on top of what's stored. */
  private async retryLoad(): Promise<void> {
    let stored: UserData;
    try {
      stored = await loadUserData(this.options.storage, this.options.userId);
    } catch {
      return;
    }
    if (this.stopped) return;
    const records = { ...stored.records, ...this.data.records };
    for (const op of this.data.outbox) {
      if (op.kind === 'delete') delete records[op.id];
    }
    this.data = { records, outbox: [...stored.outbox, ...this.data.outbox], lastFullSync: stored.lastFullSync };
    this.loadFailed = false;
    await this.persist();
    this.emit();
  }
```

- [ ] **Step 5: Let the integration run exit**

In `jest.integration.config.js`, add after `testTimeout`:

```js
  // realtime-js 2.117 leaves a 10 s timer after disconnect() (SocketAdapter.disconnect), which keeps
  // the worker alive after the last test. It is a test-only effect; the app's socket closes normally.
  forceExit: true,
```

- [ ] **Step 6: Run the tests**

Run: `npm test && npm run test:integration`
Expected: PASS, and the integration run no longer prints "A worker process has failed to exit gracefully".

- [ ] **Step 7: Check and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add lib/events jest.integration.config.js
git commit -m "FEAT-002: Drop a change after repeated server errors and retry a failed load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, spec and registry

**Files:**
- Modify: `docs/superpowers/specs/2026-10-06-accounts-family-sharing-design.md`, `docs/specs/architecture.md`, `docs/specs/features.md`, `docs/guides/supabase-hosted-setup.md`, `docs/registry/FEAT-002-accounts-family-sharing.md`, `docs/registry/INDEX.md`, `docs/superpowers/plans/2026-10-06-feat-002-roadmap.md`, `docs/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the spec**

In the design spec:
- §2 D9: change "falls back to email" to "falls back to their @tag, then 'Member'; someone no longer in the family shows as 'Former member'".
- §5: change the `context/FamilyProvider.tsx` bullet to: `` `context/FamilyProvider.tsx`: family, members, tag → member lookup; cached per user (`planme:family:<userId>`) for offline start; refreshed on sign-in, foreground and after each family action. `lib/family/` holds the calls (`api.ts`), rules (`validation.ts`), tag helpers (`tags.ts`) and the tag mapping (`tagMapping.ts`). ``
- §5 Routes: replace `family/create`, `family/join`, `family/members` with `family/create`, `family/join` (members are listed on the Family tab).
- §5 Event UI: append `Members show as a coloured circle with their tag; photo avatars come with settings (Plan 6).`
- §6 step 7: append ` Answers are kept per user (\`planme:tagMap:<userId>\`); "No one" keeps the tag as text and isn't asked again. Old \`@AZ\`/\`@GS\` stay recognised (with their icons) until mapped.`
- §7: after the RLS-rejection bullet, add: `- A change the server keeps answering with a server error (5xx) is dropped after five tries in a row and counted the same way, so it can't block the queue.`

- [ ] **Step 2: Update the other docs**

- `docs/specs/architecture.md` §3: add `lib/family/` (`types.ts`, `validation.ts`, `api.ts`, `cache.ts`, `tags.ts`, `tagMapping.ts`), `context/FamilyProvider.tsx`, `components/family/` (`FamilyScreen.tsx`, `TagMappingPrompt.tsx`), `components/events/` (`ShareToggle.tsx`, `MemberAvatar.tsx`), routes `app/(tabs)/family.tsx`, `app/family/create.tsx`, `app/family/join.tsx`, each marked `(built, Plan 5)`. Remove `explore.tsx` if listed.
- `docs/specs/features.md`: under Accounts change the heading to `### Accounts — FEAT-002 (in progress: sign-in, sync and family sharing built)`; replace the Plan 4 family bullet with `- (Plan 5) Create or join a family with an invite code, share events, tag members with @, and manage members on the Family tab.`
- `docs/guides/supabase-hosted-setup.md` §6 phone checklist — add a "Two phones" block:
  - `- [ ] Phone A: Family tab → Create a family → the code shows; Share code works`
  - `- [ ] Phone B (another account): Join with a code → both phones list two members`
  - `- [ ] Both: set a tag on the Family tab; a clash says "Someone in your family already uses @XX."`
  - `- [ ] A: switch the input to Shared, add "6pm dinner @<B's tag>" → B sees it with "Shared · <A's name>" and B's circle`
  - `- [ ] B edits it → A sees the edit; B can't switch it to Personal (the switch is greyed out)`
  - `- [ ] A switches it to Personal → it disappears from B (pull down or reopen the app)`
  - `- [ ] On a phone with old @AZ/@GS events, after joining: "Who is @AZ?" → pick a member → the event shows their circle`
  - `- [ ] A (owner) removes B → B's Family tab shows no family after reopening; A's shared events disappear from B`
  - `- [ ] B leaves (after rejoining) → B's shared events stay on A's phone`
- `docs/registry/FEAT-002-accounts-family-sharing.md`: Updated → 12/10/2026. INDEX row Updated → 12/10/2026.
- Roadmap: Plan 5 row → `[5](2026-10-12-feat-002-plan-5-family.md)`, `Written`, and change its "Delivers" cell to `Family screens (create, join, members, invite code), personal/shared toggle, member tags + one-time @AZ/@GS mapping, Plan 4 follow-ups`. Move "avatars bucket" to the Plan 6 row's "Delivers" cell. Remove the "Plan 5, carried from plan 4's final review" bullet and its sub-bullets, and the `join_family` Plan 5 bullet (both handled here). Add under Plan 6 notes: `- **Plan 6:** avatars bucket and photo upload (moved from Plan 5); settings reuse \`updateProfile\` from \`lib/family/api.ts\`.`
- `docs/README.md` Implementation plans table: add `| 12/10/2026 | [Plan 5: family screens and sharing](superpowers/plans/2026-10-12-feat-002-plan-5-family.md) |`.

- [ ] **Step 3: Check and commit**

Run: `npm run typecheck && npm test`

```bash
git add docs
git commit -m "FEAT-002: Document family sharing in the spec, guide and registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
