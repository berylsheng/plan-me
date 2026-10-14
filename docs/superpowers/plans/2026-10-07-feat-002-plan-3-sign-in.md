# Plan 3: Sign-in, sign-up and password reset (FEAT-002 phase C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People create an account with an email and password, confirm it by email, sign in, reset a forgotten password and sign out; the planner is only reachable when signed in. Events stay on the device (Plan 4 moves them to Supabase).

**Architecture:** One Supabase client (`lib/supabase.ts`) stores the session encrypted (AES key in SecureStore, ciphertext in AsyncStorage, as Supabase's Expo guide recommends) and uses the PKCE flow so email links carry a one-time `code`. Auth calls go through small pure-ish modules in `lib/auth/` that take the client as a parameter and return `{ ok } | { ok: false, message, code }`. `context/AuthProvider.tsx` publishes the session; `components/navigation/RootNavigator.tsx` uses expo-router's `Stack.Protected` to show either the `(auth)` screens or the planner. Email links open `auth-callback` / `reset-password`, which sit outside both guards.

**Tech Stack:** Expo SDK 54, expo-router 6, `@supabase/supabase-js` 2.x, `expo-secure-store`, `aes-js`, `react-native-get-random-values`, Jest (jest-expo) + `@testing-library/react-native` + `expo-router/testing-library`, local Supabase (CLI 2.120.0) with Mailpit for integration tests.

**Spec:** [2026-10-06-accounts-family-sharing-design.md](../specs/2026-10-06-accounts-family-sharing-design.md) §2 (D2), §5, §7, §9 Phase C. Roadmap: [2026-10-06-feat-002-roadmap.md](2026-10-06-feat-002-roadmap.md) (its Plan 3 notes are folded in here).

## Global Constraints

- Read the Expo SDK 54 docs (https://docs.expo.dev/versions/v54.0.0/) before adding a package (AGENTS.md). Install Expo-managed packages with `npx expo install`; on Windows dev dependencies use `npx expo install <pkg> "--" --dev`.
- Env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Real values only in `.env.local` (gitignored) or EAS env vars. The service-role/secret key never appears in app code or the repo.
- Passwords: at least **8** characters, at most 72, with at least one letter and one digit — the app checks this and the server enforces the same rule (`minimum_password_length = 8`, `password_requirements = "letters_digits"`).
- Display name: optional, trimmed, at most **50** characters (matches the database check).
- Emails are trimmed and lower-cased before every auth call.
- Auth flow is **PKCE**; deep links are `Linking.createURL('auth-callback' | 'reset-password')` → `planme://…` in builds, `exp://…/--/…` in Expo Go. Allowed redirect URLs: `planme://**`, `exp://**` (drop `exp://**` for production later).
- Never show text taken from a link (e.g. `error_description`) to the user; map codes to the app's own messages.
- No `any`, no `@ts-ignore` / `@ts-expect-error`. Test code may cast fakes with `as unknown as SupabaseClient`.
- Dates dd/mm/yyyy, NZ time. Commit messages start with `FEAT-002:`.
- Local Supabase must be running (`npm run db:start`, Docker Desktop) for database and integration tests.

## Review Focus

1. **Email typed with capitals or spaces** (`" Alice@Test.NZ "`) must sign in to the same account it was created with. Pinned in Task 3 (`api.test.ts` normalisation test).
2. **No connection while signing in** must show a readable message and re-enable the button, not hang or crash. Pinned in Task 3 (`api.test.ts` network test) and Task 5 (`sign-in.test.tsx` network test).
3. **A reset link opened on a different phone, or opened twice** (React StrictMode runs effects twice in development) must show "expired or opened on a different device", not a crash or a false error after success. Pinned in Task 3 (integration "different device" test) and Task 5 (`reset-password.test.tsx` StrictMode test).
4. **A crafted link with its own `error_description` text** must not put that text on screen. Pinned in Task 3 (`callback.test.ts`).
5. **Signing out while on the planner, or the session expiring**, must take you to sign-in and drop the planner from history. Pinned in Task 4 (`RootNavigator.test.tsx` sign-out test).

## File structure

| File | Responsibility |
|---|---|
| `supabase/config.toml` | Local auth settings (also pushed to hosted projects) |
| `.env.example` | Names of the two env vars, with local defaults |
| `jest.setup.js` | Gives unit tests Web Crypto |
| `jest.integration.config.js`, `jest.integration.setup.js` | Integration tests against local Supabase |
| `lib/auth/secureStorage.ts` | `LargeSecureStore`: encrypted session storage |
| `lib/supabase.ts` | The app's one Supabase client |
| `lib/auth/validation.ts` | Form rules (email, password, display name) |
| `lib/auth/errors.ts` | Supabase error → app message |
| `lib/auth/callback.ts` | Email-link URL params → what to do |
| `lib/auth/api.ts` | Sign up / in / out, reset, resend, link completion |
| `lib/auth/redirect.ts` | Deep-link URLs for emails |
| `context/AuthProvider.tsx` | Session state for the app |
| `components/navigation/RootNavigator.tsx` | Which screens are reachable |
| `components/auth/*` | Shared form pieces and the sign-out button |
| `app/(auth)/*`, `app/auth-callback.tsx`, `app/reset-password.tsx` | Screens |
| `test-utils/fakeAuthClient.ts` | Fake Supabase auth for component tests |
| `docs/guides/supabase-hosted-setup.md` | Your steps to create the hosted dev project |

---

### Task 1: Plan 2 follow-ups and local auth settings

**Files:**
- Modify: `supabase/tests/database/003-family.test.sql`, `supabase/migrations/20261006120300_delete_account.sql`, `supabase/config.toml`
- Modify: `docs/superpowers/plans/2026-10-06-feat-002-roadmap.md`

**Interfaces:**
- Produces: local auth with email confirmations on, PKCE-ready redirect allow-list, password rule 8 + letters_digits. Task 3's integration tests depend on these exact settings.

- [ ] **Step 1: Make the ex-member test exercise the update policy**

In `003-family.test.sql`, in the block after `'a removed member loses access to the events they shared'`, change the two Bob updates to have **no** `where` clause (Bob has no other events at that point, so only `events_update`'s USING clause decides):

```sql
update public.events set title = 'Mine now';
update public.events set visibility = 'personal';
```

Leave the assertion that follows unchanged.

- [ ] **Step 2: Reword the delete_account comment**

In `20261006120300_delete_account.sql`, replace the three comment lines above `perform 1 from public.profiles where id = uid for update;` with:

```sql
  -- The cascade delete of our profile below needs this lock anyway; taking it here
  -- stops a write from this user's other device slipping in between. A shared-event
  -- insert from that device can still race this (Postgres aborts one side with
  -- 40P01); the app should treat that as retryable.
```

- [ ] **Step 3: Run the database tests**

Run: `npm run db:reset && npm run db:test`
Expected: PASS, 001 8/8, 002 18/18, 003 34/34, 004 8/8.

- [ ] **Step 4: Set the auth settings in `supabase/config.toml`**

In `[auth]` set exactly:

```toml
site_url = "planme://"
additional_redirect_urls = ["planme://**", "exp://**"]
minimum_password_length = 8
password_requirements = "letters_digits"
```

In `[auth.email]` set:

```toml
enable_confirmations = true
secure_password_change = true
```

Leave everything else as generated.

- [ ] **Step 5: Restart the stack and check the settings took effect**

```bash
npx supabase stop
npm run db:start
curl -s http://127.0.0.1:54321/auth/v1/settings -H "apikey: $(npx supabase status -o json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).PUBLISHABLE_KEY))")"
```

Expected: JSON containing `"mailer_autoconfirm":false`. Then `npm run db:test` still passes.

- [ ] **Step 6: Update the roadmap**

In `docs/superpowers/plans/2026-10-06-feat-002-roadmap.md`: in the plans table set Plan 3's link to `[3](2026-10-07-feat-002-plan-3-sign-in.md)` and status `Written`; delete the bullet that starts `- **Plan 3, first commit (carried from plan 2's final review):**` together with its two sub-bullets (done in Steps 1–2).

- [ ] **Step 7: Commit**

```bash
git add supabase docs/superpowers/plans/2026-10-06-feat-002-roadmap.md
git commit -m "FEAT-002: Turn on email confirmation and password rules; tighten an access test"
```

---

### Task 2: Encrypted session storage and the Supabase client

**Files:**
- Modify: `package.json` (dependencies, jest `setupFiles`)
- Create: `jest.setup.js`, `.env.example`, `lib/auth/secureStorage.ts`, `lib/supabase.ts`
- Test: `lib/auth/__tests__/secureStorage.test.ts`

**Interfaces:**
- Produces:
  - `class LargeSecureStore { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }`
  - `supabase: SupabaseClient` (from `@/lib/supabase`) — only `app/_layout.tsx` imports it; everything else gets the client from `useAuth()`

- [ ] **Step 1: Install packages**

```bash
npx expo install @supabase/supabase-js expo-secure-store react-native-get-random-values
npm install aes-js
npm install --save-dev @types/aes-js
```

- [ ] **Step 2: Give Jest Web Crypto**

Create `jest.setup.js`:

```js
// react-native-get-random-values does nothing under Jest; use Node's Web Crypto instead.
if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = require('node:crypto').webcrypto;
}
```

In `package.json`'s `jest` block add `"setupFiles": ["<rootDir>/jest.setup.js"],`.

- [ ] **Step 3: Write the failing test**

Create `lib/auth/__tests__/secureStorage.test.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LargeSecureStore } from '../secureStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const secureStore = (): Map<string, string> => jest.requireMock('expo-secure-store').__store;

beforeEach(async () => {
  await AsyncStorage.clear();
  secureStore().clear();
});

describe('LargeSecureStore', () => {
  it('returns what was stored', async () => {
    const store = new LargeSecureStore();
    await store.setItem('sb-test-auth-token', '{"access_token":"abc"}');
    expect(await store.getItem('sb-test-auth-token')).toBe('{"access_token":"abc"}');
  });

  it('keeps only ciphertext in AsyncStorage and only a 256-bit key in SecureStore', async () => {
    await new LargeSecureStore().setItem('k', 'secret session');
    const stored = await AsyncStorage.getItem('k');
    expect(stored).not.toContain('secret');
    expect(stored).toMatch(/^[0-9a-f]+$/);
    expect(secureStore().get('k')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles sessions far larger than SecureStore accepts', async () => {
    const big = 'x'.repeat(5000);
    const store = new LargeSecureStore();
    await store.setItem('k', big);
    expect(await store.getItem('k')).toBe(big);
    expect(secureStore().get('k')).toHaveLength(64);
  });

  it('uses a fresh key each time a value is saved', async () => {
    const store = new LargeSecureStore();
    await store.setItem('k', 'same');
    const firstKey = secureStore().get('k');
    await store.setItem('k', 'same');
    expect(secureStore().get('k')).not.toBe(firstKey);
  });

  it('returns null for a missing value or a missing key', async () => {
    const store = new LargeSecureStore();
    expect(await store.getItem('nothing')).toBeNull();
    await store.setItem('k', 'v');
    secureStore().delete('k'); // e.g. keychain cleared but app data kept
    expect(await store.getItem('k')).toBeNull();
  });

  it('removes both halves', async () => {
    const store = new LargeSecureStore();
    await store.setItem('k', 'v');
    await store.removeItem('k');
    expect(await AsyncStorage.getItem('k')).toBeNull();
    expect(secureStore().has('k')).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx jest lib/auth/__tests__/secureStorage.test.ts`
Expected: FAIL with `Cannot find module '../secureStorage'`.

- [ ] **Step 5: Write `lib/auth/secureStorage.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';

/**
 * Session storage for Supabase, from Supabase's Expo guide. SecureStore can reject
 * values over about 2 KB and a session is bigger, so the session is AES-256
 * encrypted into AsyncStorage and only its 32-byte key is kept in SecureStore.
 */
export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx jest lib/auth/__tests__/secureStorage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Create the client and env template**

Create `lib/supabase.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { LargeSecureStore } from './auth/secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).');
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    // SecureStore doesn't exist on web; the web build only matters for quick UI checks.
    storage: Platform.OS === 'web' ? AsyncStorage : new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// supabase-js can't tell whether a phone app is in the foreground, so refresh tokens
// only while it is.
AppState.addEventListener('change', state => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
```

Create `.env.example`:

```bash
# Copy to .env.local (gitignored) and fill in.
# Phone testing: the hosted dev project (docs/guides/supabase-hosted-setup.md).
# Simulator/web on this PC: local Supabase — `npm run db:start` prints the publishable key.
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Confirm `.gitignore` already contains `.env*.local` (it does at the time of writing); do not commit a `.env.local`.

- [ ] **Step 8: Check types, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 type errors, 0 lint errors (the existing `exhaustive-deps` warning may remain), all Jest suites pass.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json jest.setup.js .env.example lib/auth lib/supabase.ts
git commit -m "FEAT-002: Add the Supabase client with encrypted session storage"
```

---

### Task 3: Auth rules, messages and calls, tested against local Supabase

**Files:**
- Create: `lib/auth/validation.ts`, `lib/auth/errors.ts`, `lib/auth/callback.ts`, `lib/auth/api.ts`, `lib/auth/redirect.ts`, `test-utils/fakeAuthClient.ts`
- Create: `jest.integration.config.js`, `jest.integration.setup.js`
- Modify: `package.json` (scripts, `testPathIgnorePatterns`), `.github/workflows/ci.yml`
- Test: `lib/auth/__tests__/validation.test.ts`, `errors.test.ts`, `callback.test.ts`, `api.test.ts`, `auth.integration.test.ts`

**Interfaces:**
- Produces:
  - validation: `MIN_PASSWORD_LENGTH = 8`, `MAX_PASSWORD_LENGTH = 72`, `MAX_DISPLAY_NAME_LENGTH = 50`, `type FieldErrors = Partial<Record<'displayName' | 'email' | 'password' | 'confirmPassword', string>>`, `normaliseEmail(email: string): string`, `validateSignIn({ email, password }): FieldErrors`, `validateSignUp({ displayName, email, password, confirmPassword }): FieldErrors`, `validateNewPassword({ password, confirmPassword }): FieldErrors`, `validateEmailOnly(email: string): FieldErrors`
  - errors: `GENERIC_MESSAGE`, `LINK_PROBLEM_MESSAGE`, `authErrorCode(error: unknown): string | undefined`, `authErrorMessage(error: unknown): string`, `messageForCode(code: string): string`
  - callback: `type CallbackParams = Record<string, string | string[] | undefined>`, `type CallbackAction = { kind: 'exchange'; code: string } | { kind: 'error'; code: string; message: string } | { kind: 'none' }`, `parseAuthCallback(params: CallbackParams): CallbackAction`
  - api: `type AuthResult = { ok: true } | { ok: false; message: string; code?: string }`; `signIn(client, { email, password })`, `signUp(client, { email, password, displayName }, emailRedirectTo: string)`, `resendConfirmation(client, email, emailRedirectTo)`, `requestPasswordReset(client, email, redirectTo)`, `completeAuthRedirect(client, action: CallbackAction)`, `updatePassword(client, password)`, `signOut(client)` — all `Promise<AuthResult>`, `client: SupabaseClient`
  - redirect: `authRedirectUrl(path: 'auth-callback' | 'reset-password'): string`
  - test-utils: `fakeAuthClient(initial?: Session | null)` → `{ client, auth, emit }`; `fakeSession(email?: string): Session`
  - scripts: `npm run test:integration`

- [ ] **Step 1: Write the failing unit tests**

Create `lib/auth/__tests__/validation.test.ts`:

```ts
import { normaliseEmail, validateEmailOnly, validateNewPassword, validateSignIn, validateSignUp } from '../validation';

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Alice@Test.NZ ')).toBe('alice@test.nz');
  });
});

describe('validateSignIn', () => {
  it('accepts a normal email and any non-empty password', () => {
    expect(validateSignIn({ email: 'alice@test.nz', password: 'x' })).toEqual({});
  });

  it('asks for missing fields', () => {
    expect(validateSignIn({ email: '  ', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });

  it('rejects an address without a domain', () => {
    expect(validateSignIn({ email: 'alice@test', password: 'x' }).email).toBe('Enter a valid email address.');
  });
});

describe('validateNewPassword', () => {
  it.each([
    ['family26', undefined],
    ['family2', 'Use at least 8 characters.'],
    ['familyplan', 'Include at least one letter and one number.'],
    ['12345678', 'Include at least one letter and one number.'],
    [`a1${'x'.repeat(71)}`, 'Use at most 72 characters.'],
  ])('%s → %s', (password, expected) => {
    expect(validateNewPassword({ password, confirmPassword: password }).password).toBe(expected);
  });

  it('requires the two passwords to match', () => {
    expect(validateNewPassword({ password: 'family26', confirmPassword: 'family27' })).toEqual({
      confirmPassword: "Passwords don't match.",
    });
  });
});

describe('validateSignUp', () => {
  const valid = { displayName: 'Alice', email: 'alice@test.nz', password: 'family26', confirmPassword: 'family26' };

  it('accepts a complete form, and an empty display name', () => {
    expect(validateSignUp(valid)).toEqual({});
    expect(validateSignUp({ ...valid, displayName: '' })).toEqual({});
  });

  it('limits the display name to 50 characters after trimming', () => {
    expect(validateSignUp({ ...valid, displayName: ` ${'a'.repeat(50)} ` })).toEqual({});
    expect(validateSignUp({ ...valid, displayName: 'a'.repeat(51) }).displayName).toBe('Use at most 50 characters.');
  });
});

describe('validateEmailOnly', () => {
  it('checks just the email', () => {
    expect(validateEmailOnly('')).toEqual({ email: 'Enter your email address.' });
    expect(validateEmailOnly('alice@test.nz')).toEqual({});
  });
});
```

Create `lib/auth/__tests__/errors.test.ts`:

```ts
import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { authErrorCode, authErrorMessage, GENERIC_MESSAGE, LINK_PROBLEM_MESSAGE, messageForCode } from '../errors';

const apiError = (code: string) => new AuthApiError('server text', 400, code);

describe('authErrorMessage', () => {
  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['email_not_confirmed', 'Confirm your email first. Check your inbox for the link.'],
    ['user_already_exists', 'An account with this email already exists. Sign in instead.'],
    ['email_exists', 'An account with this email already exists. Sign in instead.'],
    ['weak_password', 'Use at least 8 characters, with at least one letter and one number.'],
    ['same_password', 'Choose a different password from your current one.'],
    ['over_request_rate_limit', 'Too many attempts. Wait a minute, then try again.'],
    ['over_email_send_rate_limit', 'Too many attempts. Wait a minute, then try again.'],
    ['otp_expired', LINK_PROBLEM_MESSAGE],
    ['flow_state_expired', LINK_PROBLEM_MESSAGE],
    ['flow_state_not_found', LINK_PROBLEM_MESSAGE],
  ])('%s → %s', (code, message) => {
    expect(authErrorMessage(apiError(code))).toBe(message);
  });

  it('never shows the server text for an unknown code', () => {
    expect(authErrorMessage(apiError('something_new'))).toBe(GENERIC_MESSAGE);
  });

  it('treats a missing PKCE verifier as a link problem', () => {
    const error = new AuthPKCECodeVerifierMissingError();
    expect(authErrorCode(error)).toBe('bad_code_verifier');
    expect(authErrorMessage(error)).toBe(LINK_PROBLEM_MESSAGE);
  });

  it('explains connection failures, from supabase-js or from fetch itself', () => {
    const offline = "Can't reach the server. Check your connection and try again.";
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(offline);
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe(offline);
  });

  it('falls back for anything else', () => {
    expect(authErrorMessage(new Error('boom'))).toBe(GENERIC_MESSAGE);
    expect(messageForCode('nope')).toBe(GENERIC_MESSAGE);
  });
});
```

Create `lib/auth/__tests__/callback.test.ts`:

```ts
import { LINK_PROBLEM_MESSAGE } from '../errors';
import { parseAuthCallback } from '../callback';

describe('parseAuthCallback', () => {
  it('exchanges a code', () => {
    expect(parseAuthCallback({ code: ' abc-123 ' })).toEqual({ kind: 'exchange', code: 'abc-123' });
  });

  it('takes the first value when a param repeats', () => {
    expect(parseAuthCallback({ code: ['one', 'two'] })).toEqual({ kind: 'exchange', code: 'one' });
  });

  it('reports an expired link with the app message, not the link text', () => {
    expect(
      parseAuthCallback({ error: 'access_denied', error_code: 'otp_expired', error_description: 'Call 0800 SCAM to fix your account' }),
    ).toEqual({ kind: 'error', code: 'otp_expired', message: LINK_PROBLEM_MESSAGE });
  });

  it('uses `error` when there is no `error_code`', () => {
    expect(parseAuthCallback({ error: 'access_denied' })).toMatchObject({ kind: 'error', code: 'access_denied' });
  });

  it('does nothing without a code or error', () => {
    expect(parseAuthCallback({})).toEqual({ kind: 'none' });
    expect(parseAuthCallback({ code: '  ' })).toEqual({ kind: 'none' });
  });
});
```

Create `test-utils/fakeAuthClient.ts`:

```ts
import type { Session, SupabaseClient } from '@supabase/supabase-js';

type Listener = (event: string, session: Session | null) => void;

/** A stand-in for `supabase.auth` in component tests. Every method is a jest.fn you can override. */
export function fakeAuthClient(initial: Session | null = null) {
  let listener: Listener | null = null;
  const unsubscribe = jest.fn();
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: jest.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithPassword: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signUp: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    resend: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    /** Simulate supabase-js telling the app the session changed. */
    emit: (event: string, session: Session | null) => listener?.(event, session),
  };
}

export const fakeSession = (email = 'alice@test.nz'): Session => ({
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-07T00:00:00Z' },
});
```

Create `lib/auth/__tests__/api.test.ts`:

```ts
import { AuthApiError } from '@supabase/supabase-js';

import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import { completeAuthRedirect, requestPasswordReset, signIn, signOut, signUp } from '../api';
import { LINK_PROBLEM_MESSAGE } from '../errors';

describe('auth api', () => {
  it('normalises the email before signing in', async () => {
    const fake = fakeAuthClient();
    await signIn(fake.client, { email: '  Alice@Test.NZ ', password: 'family26' });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'family26' });
  });

  it('turns a failed sign-in into the app message and code', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    expect(await signIn(fake.client, { email: 'a@test.nz', password: 'x' })).toEqual({
      ok: false,
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  });

  it('reports a dropped connection instead of throwing', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await signIn(fake.client, { email: 'a@test.nz', password: 'x' })).toMatchObject({ ok: false, code: 'network' });
  });

  it('sends the trimmed display name and the redirect on sign-up, or no name at all', async () => {
    const fake = fakeAuthClient();
    await signUp(fake.client, { email: 'A@test.nz', password: 'family26', displayName: '  Alice ' }, 'planme://auth-callback');
    expect(fake.auth.signUp).toHaveBeenLastCalledWith({
      email: 'a@test.nz',
      password: 'family26',
      options: { emailRedirectTo: 'planme://auth-callback', data: { display_name: 'Alice' } },
    });
    await signUp(fake.client, { email: 'b@test.nz', password: 'family26', displayName: '   ' }, 'planme://auth-callback');
    expect(fake.auth.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ options: { emailRedirectTo: 'planme://auth-callback', data: {} } }));
  });

  it('does not reveal whether a reset email went to a real account', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('User not found', 400, 'user_not_found') });
    expect(await requestPasswordReset(fake.client, 'ghost@test.nz', 'planme://reset-password')).toEqual({ ok: true });
  });

  it('still reports rate limits and connection problems on reset', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('slow down', 429, 'over_email_send_rate_limit') });
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'over_email_send_rate_limit' });
    fake.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'network' });
  });

  it('completes a link only when it carries a code', async () => {
    const fake = fakeAuthClient();
    expect(await completeAuthRedirect(fake.client, { kind: 'exchange', code: 'abc' })).toEqual({ ok: true });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(await completeAuthRedirect(fake.client, { kind: 'none' })).toEqual({ ok: false, code: 'missing_code', message: LINK_PROBLEM_MESSAGE });
    expect(await completeAuthRedirect(fake.client, { kind: 'error', code: 'otp_expired', message: LINK_PROBLEM_MESSAGE })).toEqual({
      ok: false,
      code: 'otp_expired',
      message: LINK_PROBLEM_MESSAGE,
    });
  });

  it('signs out this device only', async () => {
    const fake = fakeAuthClient();
    await signOut(fake.client);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest lib/auth`
Expected: FAIL with `Cannot find module '../validation'` (and `../errors`, `../callback`, `../api`). `secureStorage.test.ts` still passes.

- [ ] **Step 3: Write the modules**

Create `lib/auth/validation.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const MAX_DISPLAY_NAME_LENGTH = 50;

export type FieldErrors = Partial<Record<'displayName' | 'email' | 'password' | 'confirmPassword', string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const emailError = (email: string): string | undefined => {
  const value = normaliseEmail(email);
  if (value === '') return 'Enter your email address.';
  return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address.';
};

// Same rule the server enforces (supabase/config.toml: 8 characters, letters_digits).
const newPasswordError = (password: string): string | undefined => {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include at least one letter and one number.';
  return undefined;
};

const withoutEmpty = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined)) as FieldErrors;

export const validateSignIn = ({ email, password }: { email: string; password: string }): FieldErrors =>
  withoutEmpty({ email: emailError(email), password: password === '' ? 'Enter your password.' : undefined });

export const validateNewPassword = ({ password, confirmPassword }: { password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    password: newPasswordError(password),
    confirmPassword: confirmPassword === password ? undefined : "Passwords don't match.",
  });

export const validateSignUp = (form: { displayName: string; email: string; password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    displayName:
      form.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH ? `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.` : undefined,
    email: emailError(form.email),
    ...validateNewPassword(form),
  });

export const validateEmailOnly = (email: string): FieldErrors => withoutEmpty({ email: emailError(email) });
```

Create `lib/auth/errors.ts`:

```ts
import { isAuthError, isAuthPKCECodeVerifierMissingError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';
export const LINK_PROBLEM_MESSAGE = 'This link has expired or was opened on a different device. Request a new one on this phone.';

const ALREADY_EXISTS = 'An account with this email already exists. Sign in instead.';
const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email first. Check your inbox for the link.',
  user_already_exists: ALREADY_EXISTS,
  email_exists: ALREADY_EXISTS,
  weak_password: 'Use at least 8 characters, with at least one letter and one number.',
  same_password: 'Choose a different password from your current one.',
  email_address_invalid: 'Enter a valid email address.',
  signup_disabled: 'New accounts are turned off right now.',
  over_request_rate_limit: TOO_MANY,
  over_email_send_rate_limit: TOO_MANY,
  otp_expired: LINK_PROBLEM_MESSAGE,
  flow_state_expired: LINK_PROBLEM_MESSAGE,
  flow_state_not_found: LINK_PROBLEM_MESSAGE,
  bad_code_verifier: LINK_PROBLEM_MESSAGE,
  missing_code: LINK_PROBLEM_MESSAGE,
  network: "Can't reach the server. Check your connection and try again.",
};

export const messageForCode = (code: string): string => MESSAGES[code] ?? GENERIC_MESSAGE;

/** A short code for an auth failure: Supabase's error code, or 'network' / 'bad_code_verifier'. */
export function authErrorCode(error: unknown): string | undefined {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) return 'network';
  if (isAuthPKCECodeVerifierMissingError(error)) return 'bad_code_verifier';
  if (isAuthError(error)) return error.code ?? undefined;
  return undefined;
}

/** The app's own message for an auth failure. Server text is never shown. */
export function authErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  return code ? messageForCode(code) : GENERIC_MESSAGE;
}
```

Create `lib/auth/callback.ts`:

```ts
import { messageForCode } from './errors';

export type CallbackParams = Record<string, string | string[] | undefined>;

export type CallbackAction =
  | { kind: 'exchange'; code: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'none' };

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * What to do with the query params of an email link (sign-up confirmation or password
 * reset). `error_description` is ignored on purpose: anyone can put text in a link.
 */
export function parseAuthCallback(params: CallbackParams): CallbackAction {
  const errorCode = first(params.error_code) ?? first(params.error);
  if (errorCode) return { kind: 'error', code: errorCode, message: messageForCode(errorCode) };
  const code = first(params.code)?.trim();
  return code ? { kind: 'exchange', code } : { kind: 'none' };
}
```

Create `lib/auth/api.ts`:

```ts
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

import type { CallbackAction } from './callback';
import { authErrorCode, authErrorMessage, LINK_PROBLEM_MESSAGE } from './errors';
import { normaliseEmail } from './validation';

export type AuthResult = { ok: true } | { ok: false; message: string; code?: string };

const failure = (error: unknown): AuthResult => ({ ok: false, message: authErrorMessage(error), code: authErrorCode(error) });

/** Run one supabase-js auth call; a thrown error (e.g. no connection) becomes a result too. */
async function run(call: () => Promise<{ error: AuthError | null }>): Promise<AuthResult> {
  try {
    const { error } = await call();
    return error ? failure(error) : { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export const signIn = (client: SupabaseClient, { email, password }: { email: string; password: string }) =>
  run(() => client.auth.signInWithPassword({ email: normaliseEmail(email), password }));

export const signUp = (
  client: SupabaseClient,
  { email, password, displayName }: { email: string; password: string; displayName: string },
  emailRedirectTo: string,
) => {
  const name = displayName.trim();
  return run(() =>
    client.auth.signUp({
      email: normaliseEmail(email),
      password,
      options: { emailRedirectTo, data: name ? { display_name: name } : {} },
    }),
  );
};

export const resendConfirmation = (client: SupabaseClient, email: string, emailRedirectTo: string) =>
  run(() => client.auth.resend({ type: 'signup', email: normaliseEmail(email), options: { emailRedirectTo } }));

const REPORTED_RESET_FAILURES = new Set(['network', 'over_email_send_rate_limit', 'over_request_rate_limit']);

/** Ask for a reset email. Apart from connection and rate-limit problems, always "ok", so nobody can test which emails have accounts. */
export async function requestPasswordReset(client: SupabaseClient, email: string, redirectTo: string): Promise<AuthResult> {
  const result = await run(() => client.auth.resetPasswordForEmail(normaliseEmail(email), { redirectTo }));
  return result.ok || REPORTED_RESET_FAILURES.has(result.code ?? '') ? result : { ok: true };
}

/** Finish an email link: swap its one-time code for a session (PKCE). */
export async function completeAuthRedirect(client: SupabaseClient, action: CallbackAction): Promise<AuthResult> {
  if (action.kind === 'error') return { ok: false, code: action.code, message: action.message };
  if (action.kind === 'none') return { ok: false, code: 'missing_code', message: LINK_PROBLEM_MESSAGE };
  return run(() => client.auth.exchangeCodeForSession(action.code));
}

export const updatePassword = (client: SupabaseClient, password: string) => run(() => client.auth.updateUser({ password }));

/** Sign out on this phone only; other family devices stay signed in. */
export const signOut = (client: SupabaseClient) => run(() => client.auth.signOut({ scope: 'local' }));
```

Create `lib/auth/redirect.ts`:

```ts
import * as Linking from 'expo-linking';

/** Where email links send people back: planme://… in builds, exp://…/--/… in Expo Go. */
export const authRedirectUrl = (path: 'auth-callback' | 'reset-password'): string => Linking.createURL(path);
```

- [ ] **Step 4: Run the unit tests**

Run: `npx jest lib/auth`
Expected: PASS (validation, errors, callback, api, secureStorage). If an `AuthApiError` constructor signature differs in the installed supabase-js, fix the **test helper** to match the installed constructor, not the module.

- [ ] **Step 5: Set up integration tests**

Create `jest.integration.config.js`:

```js
// Integration tests: real auth calls against the local Supabase stack (npm run db:start).
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['**/*.integration.test.ts'],
  globalSetup: '<rootDir>/jest.integration.setup.js',
  testTimeout: 30000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
```

Create `jest.integration.setup.js`:

```js
const { execSync } = require('node:child_process');

// Point the tests at the running local stack. Workers inherit these env vars.
module.exports = async () => {
  let status;
  try {
    status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npm run db:start`.');
  }
  process.env.SUPABASE_TEST_URL = status.API_URL;
  process.env.SUPABASE_TEST_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
  process.env.SUPABASE_TEST_MAILPIT_URL = status.MAILPIT_URL ?? status.INBUCKET_URL;
};
```

In `package.json`: add the script `"test:integration": "jest -c jest.integration.config.js"`; add `"\\.integration\\.test\\.ts$"` to the unit `jest.testPathIgnorePatterns` array; change `lint` to `expo lint app components lib test-utils`.

- [ ] **Step 6: Write the integration tests**

Create `lib/auth/__tests__/auth.integration.test.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { completeAuthRedirect, requestPasswordReset, signIn, signOut, signUp, updatePassword } from '../api';
import { parseAuthCallback } from '../callback';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run through \`npm run test:integration\``);
  return value;
};
const API_URL = env('SUPABASE_TEST_URL');
const PUBLISHABLE_KEY = env('SUPABASE_TEST_PUBLISHABLE_KEY');
const MAILPIT_URL = env('SUPABASE_TEST_MAILPIT_URL');

const CONFIRM_REDIRECT = 'planme://auth-callback';
const RESET_REDIRECT = 'planme://reset-password';
const PASSWORD = 'family2026';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A client like the app's, but with in-memory storage, so each test is a separate "phone". */
function newPhone(): SupabaseClient {
  const memory = new Map<string, string>();
  return createClient(API_URL, PUBLISHABLE_KEY, {
    auth: {
      storage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nz`;

/** The verify link from the newest email of this type that Mailpit caught for the address. */
async function emailLink(email: string, type: 'signup' | 'recovery'): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const { ID } of messages) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`)).json()) as { HTML: string };
      const match = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/);
      if (match) {
        const link = match[1].replace(/&amp;/g, '&');
        if (new URL(link).searchParams.get('type') === type) return link;
      }
    }
    await sleep(250);
  }
  throw new Error(`No ${type} email arrived for ${email}`);
}

/** Open a verify link the way the phone's browser would, and return the app URL it sends you to. */
async function openLink(link: string): Promise<URL> {
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) throw new Error(`Verify link did not redirect (HTTP ${response.status})`);
  return new URL(location);
}

const callbackParams = (url: URL) => Object.fromEntries(url.searchParams.entries());

/** A confirmed account, signed out again. */
async function confirmedAccount(): Promise<string> {
  const email = uniqueEmail('member');
  const phone = newPhone();
  await signUp(phone, { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
  const appUrl = await openLink(await emailLink(email, 'signup'));
  await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)));
  await signOut(phone);
  await sleep(1100); // Supabase sends at most one email per address per second
  return email;
}

describe('auth against local Supabase', () => {
  it('signs up, requires the emailed confirmation, then signs in with the display name stored', async () => {
    const email = uniqueEmail('signup');
    const phone = newPhone();

    expect(await signUp(phone, { email, password: PASSWORD, displayName: ' Alice ' }, CONFIRM_REDIRECT)).toEqual({ ok: true });
    expect(await signIn(phone, { email, password: PASSWORD })).toMatchObject({ ok: false, code: 'email_not_confirmed' });

    const appUrl = await openLink(await emailLink(email, 'signup'));
    expect(appUrl.protocol).toBe('planme:');
    expect(await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)))).toEqual({ ok: true });

    const { data } = await phone.from('profiles').select('display_name').single();
    expect(data?.display_name).toBe('Alice');
  });

  it('signs in whatever the capitalisation of the email', async () => {
    const email = await confirmedAccount();
    expect(await signIn(newPhone(), { email: `  ${email.toUpperCase()} `, password: PASSWORD })).toEqual({ ok: true });
  });

  it('rejects a wrong password with the app message', async () => {
    const email = await confirmedAccount();
    expect(await signIn(newPhone(), { email, password: 'wrong2026' })).toEqual({
      ok: false,
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  });

  it('enforces the password rule on the server too', async () => {
    const result = await signUp(newPhone(), { email: uniqueEmail('weak'), password: 'familyplanner', displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, code: 'weak_password' });
  });

  it('tells someone signing up with a confirmed account to sign in instead', async () => {
    const email = await confirmedAccount();
    const result = await signUp(newPhone(), { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, message: 'An account with this email already exists. Sign in instead.' });
  });

  it('resets a forgotten password with the emailed link', async () => {
    const email = await confirmedAccount();
    const phone = newPhone();

    expect(await requestPasswordReset(phone, email, RESET_REDIRECT)).toEqual({ ok: true });
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    expect(`${appUrl.protocol}//${appUrl.host}`).toBe('planme://reset-password');
    expect(await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)))).toEqual({ ok: true });
    expect(await updatePassword(phone, 'newfamily2027')).toEqual({ ok: true });
    expect(await signOut(phone)).toEqual({ ok: true });

    expect(await signIn(newPhone(), { email, password: PASSWORD })).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(await signIn(newPhone(), { email, password: 'newfamily2027' })).toEqual({ ok: true });
  });

  it('answers a reset request for an unknown email the same way', async () => {
    expect(await requestPasswordReset(newPhone(), uniqueEmail('nobody'), RESET_REDIRECT)).toEqual({ ok: true });
  });

  it('explains a reset link opened on a different phone', async () => {
    const email = await confirmedAccount();
    await requestPasswordReset(newPhone(), email, RESET_REDIRECT);
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    const result = await completeAuthRedirect(newPhone(), parseAuthCallback(callbackParams(appUrl)));
    expect(result).toMatchObject({
      ok: false,
      code: 'bad_code_verifier',
      message: 'This link has expired or was opened on a different device. Request a new one on this phone.',
    });
  });
});
```

- [ ] **Step 7: Run the integration tests**

Run: `npm run test:integration`
Expected: PASS, 8 tests. If one fails, read the actual response: the Mailpit API path, the redirect `Location`, or a Supabase error `code` may differ by CLI version. Fix the **test helper** (e.g. the link regex) or the **app message mapping** if Supabase returns a different code for the same situation (e.g. `email_exists` instead of `user_already_exists`, or a different code for a missing verifier) — and say so in your report. Never weaken what a test checks.

- [ ] **Step 8: Run integration tests in CI**

In `.github/workflows/ci.yml`, replace the whole `database` job with:

```yaml
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: supabase/setup-cli@v1
        with:
          version: 2.120.0
      # Database, auth, REST and Mailpit only; the rest isn't needed for tests.
      - run: supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,storage-api,realtime
      - run: supabase test db
      - run: npm run test:integration
```

- [ ] **Step 9: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run db:test && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add lib/auth test-utils jest.integration.config.js jest.integration.setup.js package.json .github/workflows/ci.yml
git commit -m "FEAT-002: Add auth calls, form rules and messages, with integration tests"
```

---

### Task 4: Session state and the sign-in gate

**Files:**
- Modify: `package.json` (dev dependency, jest `setupFilesAfterEnv`, `lint`), `app/_layout.tsx`
- Create: `context/AuthProvider.tsx`, `components/navigation/RootNavigator.tsx`, `app/(auth)/_layout.tsx`
- Test: `context/__tests__/AuthProvider.test.tsx`, `components/navigation/__tests__/RootNavigator.test.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2); `fakeAuthClient`, `fakeSession` (Task 3)
- Produces:
  - `AuthProvider({ client: SupabaseClient, children })`
  - `useAuth(): { client: SupabaseClient; session: Session | null; isLoading: boolean }` — throws outside the provider
  - `RootNavigator()` — renders nothing while loading, then a `Stack` where `(tabs)` and `modal` need a session, `(auth)` needs no session, and `auth-callback` / `reset-password` are always reachable
  - Route names Task 5 must create: `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/forgot-password.tsx`, `app/auth-callback.tsx`, `app/reset-password.tsx`

- [ ] **Step 1: Install the testing library**

```bash
npx expo install @testing-library/react-native "--" --dev
```

If npm then reports a missing peer `react-test-renderer`, also run `npm install --save-dev react-test-renderer@19.1.0` (it must match `react`).

In `package.json`: add `"setupFilesAfterEnv": ["@testing-library/react-native/extend-expect"]` to the `jest` block (gives matchers such as `toBeDisabled`; if the installed version has no `extend-expect` entry, its matchers are built in — drop the line), and change `lint` to `expo lint app components lib context test-utils`.

- [ ] **Step 2: Write the failing tests**

Create `context/__tests__/AuthProvider.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import { AuthProvider, useAuth } from '../AuthProvider';

const setup = (fake = fakeAuthClient()) => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider client={fake.client}>{children}</AuthProvider>;
  return { fake, ...renderHook(() => useAuth(), { wrapper }) };
};

describe('AuthProvider', () => {
  it('starts loading, then has no session when signed out', async () => {
    const { result } = setup();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('picks up a saved session', async () => {
    const session = fakeSession();
    const { result } = setup(fakeAuthClient(session));
    await waitFor(() => expect(result.current.session).toBe(session));
  });

  it('follows sign-in and sign-out events', async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const session = fakeSession();
    act(() => fake.emit('SIGNED_IN', session));
    expect(result.current.session).toBe(session);
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.session).toBeNull();
  });

  it('stops loading even if reading the saved session fails', async () => {
    const fake = fakeAuthClient();
    fake.auth.getSession.mockRejectedValueOnce(new Error('keychain locked'));
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('unsubscribes when unmounted', async () => {
    const { fake, unmount, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside the provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used inside <AuthProvider>');
  });
});
```

Create `components/navigation/__tests__/RootNavigator.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import AuthLayout from '../../../app/(auth)/_layout';
import { RootNavigator } from '../RootNavigator';

const stub = (label: string) => () => <Text>{label}</Text>;

function renderApp(fake: ReturnType<typeof fakeAuthClient>, initialUrl = '/') {
  return renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <RootNavigator />
        </AuthProvider>
      ),
      '(tabs)/index': stub('Planner'),
      modal: stub('Modal'),
      '(auth)/_layout': AuthLayout,
      '(auth)/sign-in': stub('Sign-in screen'),
      '(auth)/sign-up': stub('Sign-up screen'),
      '(auth)/forgot-password': stub('Forgot screen'),
      'auth-callback': stub('Callback screen'),
      'reset-password': stub('Reset screen'),
    },
    { initialUrl },
  );
}

describe('RootNavigator', () => {
  it('shows sign-in when signed out', async () => {
    renderApp(fakeAuthClient(null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('shows the planner when signed in', async () => {
    renderApp(fakeAuthClient(fakeSession()));
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('keeps signed-out people out of the planner even by URL', async () => {
    renderApp(fakeAuthClient(null), '/modal');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
  });

  it('goes to sign-in when the session ends', async () => {
    const fake = fakeAuthClient(fakeSession());
    renderApp(fake);
    await screen.findByText('Planner');
    act(() => fake.emit('SIGNED_OUT', null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('lets email links open whether or not you are signed in', async () => {
    renderApp(fakeAuthClient(null), '/reset-password');
    expect(await screen.findByText('Reset screen')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest context components/navigation`
Expected: FAIL with `Cannot find module '../AuthProvider'` and `Cannot find module '../RootNavigator'`.

- [ ] **Step 4: Write the provider, navigator and auth layout**

Create `context/AuthProvider.tsx`:

```tsx
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type AuthValue = { client: SupabaseClient; session: Session | null; isLoading: boolean };

const AuthContext = createContext<AuthValue | null>(null);

/** Publishes the signed-in session. Screens get the Supabase client from here too, so tests can pass a fake. */
export function AuthProvider({ client, children }: { client: SupabaseClient; children: React.ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; isLoading: boolean }>({ session: null, isLoading: true });

  useEffect(() => {
    let active = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, isLoading: false });
      })
      .catch(() => {
        if (active) setState({ session: null, isLoading: false });
      });
    // Don't call other supabase functions inside this callback (supabase-js can deadlock).
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, isLoading: false });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo(() => ({ client, ...state }), [client, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
```

Create `components/navigation/RootNavigator.tsx`:

```tsx
import { SplashScreen, Stack } from 'expo-router';
import React, { useEffect } from 'react';

import { useAuth } from '@/context/AuthProvider';

/** The planner needs a session; sign-in screens need none; email links work either way. */
export function RootNavigator() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  // Keep the splash screen up until we know whether someone is signed in.
  if (isLoading) return null;

  const signedIn = session !== null;
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ title: 'Signing in' }} />
      <Stack.Screen name="reset-password" options={{ title: 'New password' }} />
    </Stack>
  );
}
```

Create `app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import React from 'react';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
    </Stack>
  );
}
```

Replace `app/_layout.tsx` with:

```tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import 'react-native-reanimated';

import { RootNavigator } from '@/components/navigation/RootNavigator';
import { AuthProvider } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider client={supabase}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest context components/navigation`
Expected: PASS (6 provider tests, 5 navigator tests). If `SplashScreen.hideAsync` throws under Jest, add `jest.mock('expo-splash-screen')` at the top of `RootNavigator.test.tsx` and note it in the report. If `renderRouter` does not resolve `Stack.Protected` redirects the way the docs describe, report BLOCKED with the output rather than changing the guard.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. (The auth screens don't exist yet, so don't start the app.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json context components/navigation "app/(auth)/_layout.tsx" app/_layout.tsx
git commit -m "FEAT-002: Gate the planner behind sign-in with Stack.Protected"
```

---

### Task 5: The auth screens and sign-out

**Files:**
- Create: `components/auth/AuthScreen.tsx`, `components/auth/FormField.tsx`, `components/auth/PrimaryButton.tsx`, `components/auth/Notice.tsx`, `components/auth/styles.ts`, `components/auth/SignOutButton.tsx`
- Create: `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/forgot-password.tsx`, `app/auth-callback.tsx`, `app/reset-password.tsx`
- Modify: `app/(tabs)/index.tsx` (header only)
- Test: `components/auth/__tests__/sign-in.test.tsx`, `sign-up.test.tsx`, `reset-password.test.tsx`, `auth-callback.test.tsx` (not under `app/`: every file in `app/` becomes a route)

**Interfaces:**
- Consumes: `useAuth()` (Task 4); `signIn`, `signUp`, `resendConfirmation`, `requestPasswordReset`, `completeAuthRedirect`, `updatePassword`, `signOut`, `AuthResult` (Task 3); validation functions and `FieldErrors`, `normaliseEmail` (Task 3); `parseAuthCallback`, `CallbackParams` (Task 3); `authRedirectUrl` (Task 3); `fakeAuthClient`, `fakeSession` (Task 3)
- Produces: the five route files named in Task 4

- [ ] **Step 1: Write the shared pieces**

Create `components/auth/styles.ts`:

```ts
import { StyleSheet } from 'react-native';

export const BLUE = '#007BFF';

export const authStyles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: 'bold', color: BLUE, textAlign: 'center', marginBottom: 24 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 16 },
  links: { marginTop: 20, gap: 14, alignItems: 'center' },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
});
```

Create `components/auth/AuthScreen.tsx`:

```tsx
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

export function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 24, paddingTop: 40 },
});
```

Create `components/auth/FormField.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Kind = 'email' | 'password' | 'newPassword' | 'name';

const KIND_PROPS: Record<Kind, TextInputProps> = {
  email: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', keyboardType: 'email-address', textContentType: 'emailAddress' },
  password: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'current-password', textContentType: 'password' },
  newPassword: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'new-password', textContentType: 'newPassword' },
  name: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
};

type Props = { label: string; value: string; onChangeText: (text: string) => void; error?: string; kind: Kind };

export function FormField({ label, value, onChangeText, error, kind }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, error ? styles.inputError : null]}
        {...KIND_PROPS[kind]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  inputError: { borderColor: '#dc3545' },
  error: { color: '#dc3545', fontSize: 13, marginTop: 4 },
});
```

Create `components/auth/PrimaryButton.tsx`:

```tsx
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { BLUE } from './styles';

type Props = { title: string; onPress: () => void; busy?: boolean };

export function PrimaryButton({ title, onPress, busy = false }: Props) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[styles.button, busy ? styles.busy : null]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: BLUE, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  busy: { opacity: 0.7 },
  text: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
```

Create `components/auth/Notice.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text } from 'react-native';

export function Notice({ tone, children }: { tone: 'error' | 'info'; children: string }) {
  return (
    <Text accessibilityRole={tone === 'error' ? 'alert' : 'text'} style={[styles.notice, tone === 'error' ? styles.error : styles.info]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12, overflow: 'hidden' },
  error: { backgroundColor: '#f8d7da', color: '#842029' },
  info: { backgroundColor: '#d1e7dd', color: '#0f5132' },
});
```

Create `components/auth/SignOutButton.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/context/AuthProvider';
import { signOut } from '@/lib/auth/api';

export function SignOutButton() {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    setBusy(true);
    const result = await signOut(client);
    setBusy(false);
    // On success the route guard takes over and shows sign-in.
    if (!result.ok) Alert.alert("Couldn't sign out", result.message);
  };

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onPress} disabled={busy} hitSlop={8} style={styles.button}>
      <Text style={styles.text}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', right: 16, bottom: 14 },
  text: { color: 'white', fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Write the failing screen tests**

Create `components/auth/__tests__/sign-in.test.tsx`:

```tsx
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Slot } from 'expo-router';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignInScreen from '../../../app/(auth)/sign-in';

function renderSignIn(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-in': SignInScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      'sign-up': () => <Text>Sign-up screen</Text>,
    },
    { initialUrl: '/sign-in' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Sign-in screen', () => {
  it('checks the form before calling the server', async () => {
    const fake = renderSignIn();
    fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the normalised email', async () => {
    const fake = renderSignIn();
    fill('Email', ' Alice@Test.NZ ');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'family26' }));
  });

  it('shows the server problem and lets you try again', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'invalid_credentials'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'wrong');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('explains a dropped connection and re-enables the button', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("Can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('offers to resend the confirmation email when the account is unconfirmed', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'email_not_confirmed'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Resend confirmation email' }));
    expect(await screen.findByText('We sent a new confirmation email.')).toBeTruthy();
    expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'alice@test.nz' }));
  });
});
```

Create `components/auth/__tests__/sign-up.test.tsx`:

```tsx
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignUpScreen from '../../../app/(auth)/sign-up';

function renderSignUp(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-up': SignUpScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
    },
    { initialUrl: '/sign-up' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

const fillValidForm = () => {
  fill('Your name (optional)', 'Alice');
  fill('Email', 'Alice@test.nz');
  fill('Password', 'family26');
  fill('Confirm password', 'family26');
};

describe('Sign-up screen', () => {
  it('shows every form problem at once', async () => {
    const fake = renderSignUp();
    fill('Email', 'alice');
    fill('Password', 'short');
    fill('Confirm password', 'other');
    fireEvent.press(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
  });

  it('asks you to check your email after signing up', async () => {
    const fake = renderSignUp();
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/alice@test\.nz/)).toBeTruthy();
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@test.nz', options: expect.objectContaining({ data: { display_name: 'Alice' } }) }),
    );
  });

  it('tells you to sign in if the email already has an account', async () => {
    const fake = fakeAuthClient();
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError('x', 422, 'user_already_exists') });
    renderSignUp(fake);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists. Sign in instead.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Check your email')).toBeNull());
  });
});
```

Create `components/auth/__tests__/reset-password.test.tsx`:

```tsx
import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import ResetPasswordScreen from '../../../app/reset-password';

function renderReset(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <React.StrictMode>
          <AuthProvider client={fake.client}>
            <Slot />
          </AuthProvider>
        </React.StrictMode>
      ),
      'reset-password': ResetPasswordScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Reset-password screen', () => {
  it('uses the link code exactly once, even under StrictMode', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('saves the new password and opens the planner', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()));
    fill('New password', 'newfamily27');
    fill('Confirm password', 'newfamily27');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'newfamily27' });
  });

  it('checks the new password before saving', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    fill('New password', 'abc');
    fill('Confirm password', 'abc');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });

  it('explains a link opened on another phone and offers a new one', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderReset(fake, '/reset-password?code=abc');
    expect(
      await screen.findByText('This link has expired or was opened on a different device. Request a new one on this phone.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Request a new link'));
    expect(await screen.findByText('Forgot screen')).toBeTruthy();
  });

  it('never shows text from the link itself', async () => {
    renderReset(fakeAuthClient(), '/reset-password?error=access_denied&error_code=otp_expired&error_description=Call%200800%20SCAM');
    await waitFor(() => expect(screen.getByText(/This link has expired/)).toBeTruthy());
    expect(screen.queryByText(/SCAM/)).toBeNull();
  });
});
```

Create `components/auth/__tests__/auth-callback.test.tsx`:

```tsx
import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import AuthCallbackScreen from '../../../app/auth-callback';

function renderCallback(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'auth-callback': AuthCallbackScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

describe('Email confirmation link', () => {
  it('signs you in and opens the planner', async () => {
    const fake = fakeAuthClient();
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('says the email is confirmed when the link was opened on another device', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Your email is confirmed. Sign in to continue.')).toBeTruthy();
  });

  it('explains an expired link', async () => {
    renderCallback(fakeAuthClient(), '/auth-callback?error=access_denied&error_code=otp_expired');
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByText('Back to sign in')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest components/auth`
Expected: FAIL with `Cannot find module '../../../app/(auth)/sign-in'` (and the other screens).

- [ ] **Step 4: Write the screens**

Create `app/(auth)/sign-in.tsx`:

```tsx
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { resendConfirmation, signIn } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, validateSignIn } from '@/lib/auth/validation';

type Message = { tone: 'error' | 'info'; text: string };

export default function SignInScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignIn({ email, password });
    setErrors(found);
    setMessage(null);
    setNeedsConfirmation(false);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signIn(client, { email, password });
    setBusy(false);
    // On success the auth listener stores the session and the route guard opens the planner.
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      setNeedsConfirmation(result.code === 'email_not_confirmed');
    }
  };

  const resend = async () => {
    setBusy(true);
    const result = await resendConfirmation(client, email, authRedirectUrl('auth-callback'));
    setBusy(false);
    setNeedsConfirmation(false);
    setMessage(result.ok ? { tone: 'info', text: 'We sent a new confirmation email.' } : { tone: 'error', text: result.message });
  };

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Plan-Me</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="password" value={password} onChangeText={setPassword} error={errors.password} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {needsConfirmation ? <PrimaryButton title="Resend confirmation email" onPress={resend} busy={busy} /> : null}
      <PrimaryButton title="Sign in" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/forgot-password" style={authStyles.link}>
          Forgot your password?
        </Link>
        <Link href="/sign-up" style={authStyles.link}>
          Create an account
        </Link>
      </View>
    </AuthScreen>
  );
}
```

Create `app/(auth)/sign-up.tsx`:

```tsx
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { signUp } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateSignUp } from '@/lib/auth/validation';

export default function SignUpScreen() {
  const { client } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignUp({ displayName, email, password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signUp(client, { email, password, displayName }, authRedirectUrl('auth-callback'));
    setBusy(false);
    if (result.ok) setSentTo(normaliseEmail(email));
    else setProblem(result.message);
  };

  if (sentTo) {
    return (
      <AuthScreen>
        <Text style={authStyles.heading}>Check your email</Text>
        <Text style={authStyles.body}>We sent a link to {sentTo}. Open it on this phone to finish creating your account.</Text>
        <View style={authStyles.links}>
          <Link href="/sign-in" replace style={authStyles.link}>
            Back to sign in
          </Link>
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FormField label="Your name (optional)" kind="name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} />
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Create account" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/sign-in" replace style={authStyles.link}>
          I already have an account
        </Link>
      </View>
    </AuthScreen>
  );
}
```

Create `app/(auth)/forgot-password.tsx`:

```tsx
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { requestPasswordReset } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateEmailOnly } from '@/lib/auth/validation';

export default function ForgotPasswordScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateEmailOnly(email);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await requestPasswordReset(client, email, authRedirectUrl('reset-password'));
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: 'info', text: `If ${normaliseEmail(email)} has an account, we've sent it a link to reset the password. Open it on this phone.` }
        : { tone: 'error', text: result.message },
    );
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Enter your email and we'll send you a link to choose a new password.</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <PrimaryButton title="Send reset link" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
```

Create `app/reset-password.tsx`:

```tsx
import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect, updatePassword } from '@/lib/auth/api';
import { type CallbackParams, parseAuthCallback } from '@/lib/auth/callback';
import { type FieldErrors, validateNewPassword } from '@/lib/auth/validation';

type Stage = { name: 'checking' } | { name: 'ready' } | { name: 'invalid'; message: string };

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<CallbackParams>();
  const { client, session } = useAuth();
  const [stage, setStage] = useState<Stage>({ name: 'checking' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A link's code works once; StrictMode runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      setStage(result.ok ? { name: 'ready' } : { name: 'invalid', message: result.message });
    });
  }, [client, params]);

  const save = async () => {
    const found = validateNewPassword({ password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await updatePassword(client, password);
    setBusy(false);
    if (result.ok) router.replace('/');
    else setProblem(result.message);
  };

  if (stage.name === 'checking') {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Checking your link" />
      </AuthScreen>
    );
  }

  if (stage.name === 'invalid') {
    return (
      <AuthScreen>
        <Notice tone="error">{stage.message}</Notice>
        <View style={authStyles.links}>
          {session ? (
            <Link href="/" replace style={authStyles.link}>
              Back to the planner
            </Link>
          ) : (
            <Link href="/forgot-password" replace style={authStyles.link}>
              Request a new link
            </Link>
          )}
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Choose a new password for your account.</Text>
      <FormField label="New password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Save password" onPress={save} busy={busy} />
    </AuthScreen>
  );
}
```

Create `app/auth-callback.tsx`:

```tsx
import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { Notice } from '@/components/auth/Notice';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect } from '@/lib/auth/api';
import { type CallbackParams, parseAuthCallback } from '@/lib/auth/callback';

// The verify step already confirmed the email on the server; only the sign-in part
// needs the phone that asked for the link.
const CONFIRMED_ELSEWHERE = 'Your email is confirmed. Sign in to continue.';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<CallbackParams>();
  const { client } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      if (result.ok) router.replace('/');
      else setProblem(result.code === 'bad_code_verifier' ? CONFIRMED_ELSEWHERE : result.message);
    });
  }, [client, params]);

  if (!problem) {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Signing you in" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Notice tone={problem === CONFIRMED_ELSEWHERE ? 'info' : 'error'}>{problem}</Notice>
      <View style={authStyles.links}>
        <Link href="/sign-in" replace style={authStyles.link}>
          Back to sign in
        </Link>
      </View>
    </AuthScreen>
  );
}
```

- [ ] **Step 5: Add sign-out to the planner header**

In `app/(tabs)/index.tsx`, add the import `import { SignOutButton } from '@/components/auth/SignOutButton';` next to the other `@/` imports, and change the header block to:

```tsx
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Plan-Me</Text>
        <SignOutButton />
      </View>
```

Nothing else in this file changes.

- [ ] **Step 6: Run the screen tests**

Run: `npx jest components/auth`
Expected: PASS (5 sign-in, 3 sign-up, 5 reset-password, 3 auth-callback). If `renderRouter` needs the routes named differently (e.g. it doesn't accept `index` without a group), adjust only the **test route map**.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run test:integration`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json jest.setup.js .env.example lib/auth lib/supabase.ts
git commit -m "FEAT-002: Add the Supabase client with encrypted session storage"
```

---

### Task 3: Auth rules, messages and calls, tested against local Supabase

**Files:**
- Create: `lib/auth/validation.ts`, `lib/auth/errors.ts`, `lib/auth/callback.ts`, `lib/auth/api.ts`, `lib/auth/redirect.ts`, `test-utils/fakeAuthClient.ts`
- Create: `jest.integration.config.js`, `jest.integration.setup.js`
- Modify: `package.json` (scripts, `testPathIgnorePatterns`), `.github/workflows/ci.yml`
- Test: `lib/auth/__tests__/validation.test.ts`, `errors.test.ts`, `callback.test.ts`, `api.test.ts`, `auth.integration.test.ts`

**Interfaces:**
- Produces:
  - validation: `MIN_PASSWORD_LENGTH = 8`, `MAX_PASSWORD_LENGTH = 72`, `MAX_DISPLAY_NAME_LENGTH = 50`, `type FieldErrors = Partial<Record<'displayName' | 'email' | 'password' | 'confirmPassword', string>>`, `normaliseEmail(email: string): string`, `validateSignIn({ email, password }): FieldErrors`, `validateSignUp({ displayName, email, password, confirmPassword }): FieldErrors`, `validateNewPassword({ password, confirmPassword }): FieldErrors`, `validateEmailOnly(email: string): FieldErrors`
  - errors: `GENERIC_MESSAGE`, `LINK_PROBLEM_MESSAGE`, `authErrorCode(error: unknown): string | undefined`, `authErrorMessage(error: unknown): string`, `messageForCode(code: string): string`
  - callback: `type CallbackParams = Record<string, string | string[] | undefined>`, `type CallbackAction = { kind: 'exchange'; code: string } | { kind: 'error'; code: string; message: string } | { kind: 'none' }`, `parseAuthCallback(params: CallbackParams): CallbackAction`
  - api: `type AuthResult = { ok: true } | { ok: false; message: string; code?: string }`; `signIn(client, { email, password })`, `signUp(client, { email, password, displayName }, emailRedirectTo: string)`, `resendConfirmation(client, email, emailRedirectTo)`, `requestPasswordReset(client, email, redirectTo)`, `completeAuthRedirect(client, action: CallbackAction)`, `updatePassword(client, password)`, `signOut(client)` — all `Promise<AuthResult>`, `client: SupabaseClient`
  - redirect: `authRedirectUrl(path: 'auth-callback' | 'reset-password'): string`
  - test-utils: `fakeAuthClient(initial?: Session | null)` → `{ client, auth, emit }`; `fakeSession(email?: string): Session`
  - scripts: `npm run test:integration`

- [ ] **Step 1: Write the failing unit tests**

Create `lib/auth/__tests__/validation.test.ts`:

```ts
import { normaliseEmail, validateEmailOnly, validateNewPassword, validateSignIn, validateSignUp } from '../validation';

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Alice@Test.NZ ')).toBe('alice@test.nz');
  });
});

describe('validateSignIn', () => {
  it('accepts a normal email and any non-empty password', () => {
    expect(validateSignIn({ email: 'alice@test.nz', password: 'x' })).toEqual({});
  });

  it('asks for missing fields', () => {
    expect(validateSignIn({ email: '  ', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });

  it('rejects an address without a domain', () => {
    expect(validateSignIn({ email: 'alice@test', password: 'x' }).email).toBe('Enter a valid email address.');
  });
});

describe('validateNewPassword', () => {
  it.each([
    ['family26', undefined],
    ['family2', 'Use at least 8 characters.'],
    ['familyplan', 'Include at least one letter and one number.'],
    ['12345678', 'Include at least one letter and one number.'],
    [`a1${'x'.repeat(71)}`, 'Use at most 72 characters.'],
  ])('%s → %s', (password, expected) => {
    expect(validateNewPassword({ password, confirmPassword: password }).password).toBe(expected);
  });

  it('requires the two passwords to match', () => {
    expect(validateNewPassword({ password: 'family26', confirmPassword: 'family27' })).toEqual({
      confirmPassword: "Passwords don't match.",
    });
  });
});

describe('validateSignUp', () => {
  const valid = { displayName: 'Alice', email: 'alice@test.nz', password: 'family26', confirmPassword: 'family26' };

  it('accepts a complete form, and an empty display name', () => {
    expect(validateSignUp(valid)).toEqual({});
    expect(validateSignUp({ ...valid, displayName: '' })).toEqual({});
  });

  it('limits the display name to 50 characters after trimming', () => {
    expect(validateSignUp({ ...valid, displayName: ` ${'a'.repeat(50)} ` })).toEqual({});
    expect(validateSignUp({ ...valid, displayName: 'a'.repeat(51) }).displayName).toBe('Use at most 50 characters.');
  });
});

describe('validateEmailOnly', () => {
  it('checks just the email', () => {
    expect(validateEmailOnly('')).toEqual({ email: 'Enter your email address.' });
    expect(validateEmailOnly('alice@test.nz')).toEqual({});
  });
});
```

Create `lib/auth/__tests__/errors.test.ts`:

```ts
import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { authErrorCode, authErrorMessage, GENERIC_MESSAGE, LINK_PROBLEM_MESSAGE, messageForCode } from '../errors';

const apiError = (code: string) => new AuthApiError('server text', 400, code);

describe('authErrorMessage', () => {
  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['email_not_confirmed', 'Confirm your email first. Check your inbox for the link.'],
    ['user_already_exists', 'An account with this email already exists. Sign in instead.'],
    ['email_exists', 'An account with this email already exists. Sign in instead.'],
    ['weak_password', 'Use at least 8 characters, with at least one letter and one number.'],
    ['same_password', 'Choose a different password from your current one.'],
    ['over_request_rate_limit', 'Too many attempts. Wait a minute, then try again.'],
    ['over_email_send_rate_limit', 'Too many attempts. Wait a minute, then try again.'],
    ['otp_expired', LINK_PROBLEM_MESSAGE],
    ['flow_state_expired', LINK_PROBLEM_MESSAGE],
    ['flow_state_not_found', LINK_PROBLEM_MESSAGE],
  ])('%s → %s', (code, message) => {
    expect(authErrorMessage(apiError(code))).toBe(message);
  });

  it('never shows the server text for an unknown code', () => {
    expect(authErrorMessage(apiError('something_new'))).toBe(GENERIC_MESSAGE);
  });

  it('treats a missing PKCE verifier as a link problem', () => {
    const error = new AuthPKCECodeVerifierMissingError();
    expect(authErrorCode(error)).toBe('bad_code_verifier');
    expect(authErrorMessage(error)).toBe(LINK_PROBLEM_MESSAGE);
  });

  it('explains connection failures, from supabase-js or from fetch itself', () => {
    const offline = "Can't reach the server. Check your connection and try again.";
    expect(authErrorMessage(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(offline);
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe(offline);
  });

  it('falls back for anything else', () => {
    expect(authErrorMessage(new Error('boom'))).toBe(GENERIC_MESSAGE);
    expect(messageForCode('nope')).toBe(GENERIC_MESSAGE);
  });
});
```

Create `lib/auth/__tests__/callback.test.ts`:

```ts
import { LINK_PROBLEM_MESSAGE } from '../errors';
import { parseAuthCallback } from '../callback';

describe('parseAuthCallback', () => {
  it('exchanges a code', () => {
    expect(parseAuthCallback({ code: ' abc-123 ' })).toEqual({ kind: 'exchange', code: 'abc-123' });
  });

  it('takes the first value when a param repeats', () => {
    expect(parseAuthCallback({ code: ['one', 'two'] })).toEqual({ kind: 'exchange', code: 'one' });
  });

  it('reports an expired link with the app message, not the link text', () => {
    expect(
      parseAuthCallback({ error: 'access_denied', error_code: 'otp_expired', error_description: 'Call 0800 SCAM to fix your account' }),
    ).toEqual({ kind: 'error', code: 'otp_expired', message: LINK_PROBLEM_MESSAGE });
  });

  it('uses `error` when there is no `error_code`', () => {
    expect(parseAuthCallback({ error: 'access_denied' })).toMatchObject({ kind: 'error', code: 'access_denied' });
  });

  it('does nothing without a code or error', () => {
    expect(parseAuthCallback({})).toEqual({ kind: 'none' });
    expect(parseAuthCallback({ code: '  ' })).toEqual({ kind: 'none' });
  });
});
```

Create `test-utils/fakeAuthClient.ts`:

```ts
import type { Session, SupabaseClient } from '@supabase/supabase-js';

type Listener = (event: string, session: Session | null) => void;

/** A stand-in for `supabase.auth` in component tests. Every method is a jest.fn you can override. */
export function fakeAuthClient(initial: Session | null = null) {
  let listener: Listener | null = null;
  const unsubscribe = jest.fn();
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: jest.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithPassword: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signUp: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    resend: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: jest.fn(async () => ({ data: { user: null, session: null }, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: null }, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    /** Simulate supabase-js telling the app the session changed. */
    emit: (event: string, session: Session | null) => listener?.(event, session),
  };
}

export const fakeSession = (email = 'alice@test.nz'): Session => ({
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-07T00:00:00Z' },
});
```

Create `lib/auth/__tests__/api.test.ts`:

```ts
import { AuthApiError } from '@supabase/supabase-js';

import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import { completeAuthRedirect, requestPasswordReset, signIn, signOut, signUp } from '../api';
import { LINK_PROBLEM_MESSAGE } from '../errors';

describe('auth api', () => {
  it('normalises the email before signing in', async () => {
    const fake = fakeAuthClient();
    await signIn(fake.client, { email: '  Alice@Test.NZ ', password: 'family26' });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'family26' });
  });

  it('turns a failed sign-in into the app message and code', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    expect(await signIn(fake.client, { email: 'a@test.nz', password: 'x' })).toEqual({
      ok: false,
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  });

  it('reports a dropped connection instead of throwing', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await signIn(fake.client, { email: 'a@test.nz', password: 'x' })).toMatchObject({ ok: false, code: 'network' });
  });

  it('sends the trimmed display name and the redirect on sign-up, or no name at all', async () => {
    const fake = fakeAuthClient();
    await signUp(fake.client, { email: 'A@test.nz', password: 'family26', displayName: '  Alice ' }, 'planme://auth-callback');
    expect(fake.auth.signUp).toHaveBeenLastCalledWith({
      email: 'a@test.nz',
      password: 'family26',
      options: { emailRedirectTo: 'planme://auth-callback', data: { display_name: 'Alice' } },
    });
    await signUp(fake.client, { email: 'b@test.nz', password: 'family26', displayName: '   ' }, 'planme://auth-callback');
    expect(fake.auth.signUp).toHaveBeenLastCalledWith(expect.objectContaining({ options: { emailRedirectTo: 'planme://auth-callback', data: {} } }));
  });

  it('does not reveal whether a reset email went to a real account', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('User not found', 400, 'user_not_found') });
    expect(await requestPasswordReset(fake.client, 'ghost@test.nz', 'planme://reset-password')).toEqual({ ok: true });
  });

  it('still reports rate limits and connection problems on reset', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('slow down', 429, 'over_email_send_rate_limit') });
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'over_email_send_rate_limit' });
    fake.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'network' });
  });

  it('completes a link only when it carries a code', async () => {
    const fake = fakeAuthClient();
    expect(await completeAuthRedirect(fake.client, { kind: 'exchange', code: 'abc' })).toEqual({ ok: true });
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(await completeAuthRedirect(fake.client, { kind: 'none' })).toEqual({ ok: false, code: 'missing_code', message: LINK_PROBLEM_MESSAGE });
    expect(await completeAuthRedirect(fake.client, { kind: 'error', code: 'otp_expired', message: LINK_PROBLEM_MESSAGE })).toEqual({
      ok: false,
      code: 'otp_expired',
      message: LINK_PROBLEM_MESSAGE,
    });
  });

  it('signs out this device only', async () => {
    const fake = fakeAuthClient();
    await signOut(fake.client);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest lib/auth`
Expected: FAIL with `Cannot find module '../validation'` (and `../errors`, `../callback`, `../api`). `secureStorage.test.ts` still passes.

- [ ] **Step 3: Write the modules**

Create `lib/auth/validation.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const MAX_DISPLAY_NAME_LENGTH = 50;

export type FieldErrors = Partial<Record<'displayName' | 'email' | 'password' | 'confirmPassword', string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const emailError = (email: string): string | undefined => {
  const value = normaliseEmail(email);
  if (value === '') return 'Enter your email address.';
  return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address.';
};

// Same rule the server enforces (supabase/config.toml: 8 characters, letters_digits).
const newPasswordError = (password: string): string | undefined => {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include at least one letter and one number.';
  return undefined;
};

const withoutEmpty = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined)) as FieldErrors;

export const validateSignIn = ({ email, password }: { email: string; password: string }): FieldErrors =>
  withoutEmpty({ email: emailError(email), password: password === '' ? 'Enter your password.' : undefined });

export const validateNewPassword = ({ password, confirmPassword }: { password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    password: newPasswordError(password),
    confirmPassword: confirmPassword === password ? undefined : "Passwords don't match.",
  });

export const validateSignUp = (form: { displayName: string; email: string; password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    displayName:
      form.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH ? `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.` : undefined,
    email: emailError(form.email),
    ...validateNewPassword(form),
  });

export const validateEmailOnly = (email: string): FieldErrors => withoutEmpty({ email: emailError(email) });
```

Create `lib/auth/errors.ts`:

```ts
import { isAuthError, isAuthPKCECodeVerifierMissingError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';
export const LINK_PROBLEM_MESSAGE = 'This link has expired or was opened on a different device. Request a new one on this phone.';

const ALREADY_EXISTS = 'An account with this email already exists. Sign in instead.';
const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email first. Check your inbox for the link.',
  user_already_exists: ALREADY_EXISTS,
  email_exists: ALREADY_EXISTS,
  weak_password: 'Use at least 8 characters, with at least one letter and one number.',
  same_password: 'Choose a different password from your current one.',
  email_address_invalid: 'Enter a valid email address.',
  signup_disabled: 'New accounts are turned off right now.',
  over_request_rate_limit: TOO_MANY,
  over_email_send_rate_limit: TOO_MANY,
  otp_expired: LINK_PROBLEM_MESSAGE,
  flow_state_expired: LINK_PROBLEM_MESSAGE,
  flow_state_not_found: LINK_PROBLEM_MESSAGE,
  bad_code_verifier: LINK_PROBLEM_MESSAGE,
  missing_code: LINK_PROBLEM_MESSAGE,
  network: "Can't reach the server. Check your connection and try again.",
};

export const messageForCode = (code: string): string => MESSAGES[code] ?? GENERIC_MESSAGE;

/** A short code for an auth failure: Supabase's error code, or 'network' / 'bad_code_verifier'. */
export function authErrorCode(error: unknown): string | undefined {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) return 'network';
  if (isAuthPKCECodeVerifierMissingError(error)) return 'bad_code_verifier';
  if (isAuthError(error)) return error.code ?? undefined;
  return undefined;
}

/** The app's own message for an auth failure. Server text is never shown. */
export function authErrorMessage(error: unknown): string {
  const code = authErrorCode(error);
  return code ? messageForCode(code) : GENERIC_MESSAGE;
}
```

Create `lib/auth/callback.ts`:

```ts
import { messageForCode } from './errors';

export type CallbackParams = Record<string, string | string[] | undefined>;

export type CallbackAction =
  | { kind: 'exchange'; code: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'none' };

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * What to do with the query params of an email link (sign-up confirmation or password
 * reset). `error_description` is ignored on purpose: anyone can put text in a link.
 */
export function parseAuthCallback(params: CallbackParams): CallbackAction {
  const errorCode = first(params.error_code) ?? first(params.error);
  if (errorCode) return { kind: 'error', code: errorCode, message: messageForCode(errorCode) };
  const code = first(params.code)?.trim();
  return code ? { kind: 'exchange', code } : { kind: 'none' };
}
```

Create `lib/auth/api.ts`:

```ts
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

import type { CallbackAction } from './callback';
import { authErrorCode, authErrorMessage, LINK_PROBLEM_MESSAGE } from './errors';
import { normaliseEmail } from './validation';

export type AuthResult = { ok: true } | { ok: false; message: string; code?: string };

const failure = (error: unknown): AuthResult => ({ ok: false, message: authErrorMessage(error), code: authErrorCode(error) });

/** Run one supabase-js auth call; a thrown error (e.g. no connection) becomes a result too. */
async function run(call: () => Promise<{ error: AuthError | null }>): Promise<AuthResult> {
  try {
    const { error } = await call();
    return error ? failure(error) : { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export const signIn = (client: SupabaseClient, { email, password }: { email: string; password: string }) =>
  run(() => client.auth.signInWithPassword({ email: normaliseEmail(email), password }));

export const signUp = (
  client: SupabaseClient,
  { email, password, displayName }: { email: string; password: string; displayName: string },
  emailRedirectTo: string,
) => {
  const name = displayName.trim();
  return run(() =>
    client.auth.signUp({
      email: normaliseEmail(email),
      password,
      options: { emailRedirectTo, data: name ? { display_name: name } : {} },
    }),
  );
};

export const resendConfirmation = (client: SupabaseClient, email: string, emailRedirectTo: string) =>
  run(() => client.auth.resend({ type: 'signup', email: normaliseEmail(email), options: { emailRedirectTo } }));

const REPORTED_RESET_FAILURES = new Set(['network', 'over_email_send_rate_limit', 'over_request_rate_limit']);

/** Ask for a reset email. Apart from connection and rate-limit problems, always "ok", so nobody can test which emails have accounts. */
export async function requestPasswordReset(client: SupabaseClient, email: string, redirectTo: string): Promise<AuthResult> {
  const result = await run(() => client.auth.resetPasswordForEmail(normaliseEmail(email), { redirectTo }));
  return result.ok || REPORTED_RESET_FAILURES.has(result.code ?? '') ? result : { ok: true };
}

/** Finish an email link: swap its one-time code for a session (PKCE). */
export async function completeAuthRedirect(client: SupabaseClient, action: CallbackAction): Promise<AuthResult> {
  if (action.kind === 'error') return { ok: false, code: action.code, message: action.message };
  if (action.kind === 'none') return { ok: false, code: 'missing_code', message: LINK_PROBLEM_MESSAGE };
  return run(() => client.auth.exchangeCodeForSession(action.code));
}

export const updatePassword = (client: SupabaseClient, password: string) => run(() => client.auth.updateUser({ password }));

/** Sign out on this phone only; other family devices stay signed in. */
export const signOut = (client: SupabaseClient) => run(() => client.auth.signOut({ scope: 'local' }));
```

Create `lib/auth/redirect.ts`:

```ts
import * as Linking from 'expo-linking';

/** Where email links send people back: planme://… in builds, exp://…/--/… in Expo Go. */
export const authRedirectUrl = (path: 'auth-callback' | 'reset-password'): string => Linking.createURL(path);
```

- [ ] **Step 4: Run the unit tests**

Run: `npx jest lib/auth`
Expected: PASS (validation, errors, callback, api, secureStorage). If an `AuthApiError` constructor signature differs in the installed supabase-js, fix the **test helper** to match the installed constructor, not the module.

- [ ] **Step 5: Set up integration tests**

Create `jest.integration.config.js`:

```js
// Integration tests: real auth calls against the local Supabase stack (npm run db:start).
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['**/*.integration.test.ts'],
  globalSetup: '<rootDir>/jest.integration.setup.js',
  testTimeout: 30000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
```

Create `jest.integration.setup.js`:

```js
const { execSync } = require('node:child_process');

// Point the tests at the running local stack. Workers inherit these env vars.
module.exports = async () => {
  let status;
  try {
    status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npm run db:start`.');
  }
  process.env.SUPABASE_TEST_URL = status.API_URL;
  process.env.SUPABASE_TEST_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
  process.env.SUPABASE_TEST_MAILPIT_URL = status.MAILPIT_URL ?? status.INBUCKET_URL;
};
```

In `package.json`: add the script `"test:integration": "jest -c jest.integration.config.js"`; add `"\\.integration\\.test\\.ts$"` to the unit `jest.testPathIgnorePatterns` array; change `lint` to `expo lint app components lib context test-utils`.

- [ ] **Step 6: Write the integration tests**

Create `lib/auth/__tests__/auth.integration.test.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { completeAuthRedirect, requestPasswordReset, signIn, signOut, signUp, updatePassword } from '../api';
import { parseAuthCallback } from '../callback';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run through \`npm run test:integration\``);
  return value;
};
const API_URL = env('SUPABASE_TEST_URL');
const PUBLISHABLE_KEY = env('SUPABASE_TEST_PUBLISHABLE_KEY');
const MAILPIT_URL = env('SUPABASE_TEST_MAILPIT_URL');

const CONFIRM_REDIRECT = 'planme://auth-callback';
const RESET_REDIRECT = 'planme://reset-password';
const PASSWORD = 'family2026';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A client like the app's, but with in-memory storage, so each test is a separate "phone". */
function newPhone(): SupabaseClient {
  const memory = new Map<string, string>();
  return createClient(API_URL, PUBLISHABLE_KEY, {
    auth: {
      storage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nz`;

/** The verify link from the newest email of this type that Mailpit caught for the address. */
async function emailLink(email: string, type: 'signup' | 'recovery'): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    for (const { ID } of messages) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`)).json()) as { HTML: string };
      const match = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/);
      if (match) {
        const link = match[1].replace(/&amp;/g, '&');
        if (new URL(link).searchParams.get('type') === type) return link;
      }
    }
    await sleep(250);
  }
  throw new Error(`No ${type} email arrived for ${email}`);
}

/** Open a verify link the way the phone's browser would, and return the app URL it sends you to. */
async function openLink(link: string): Promise<URL> {
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) throw new Error(`Verify link did not redirect (HTTP ${response.status})`);
  return new URL(location);
}

const callbackParams = (url: URL) => Object.fromEntries(url.searchParams.entries());

/** A confirmed account, signed out again. */
async function confirmedAccount(): Promise<string> {
  const email = uniqueEmail('member');
  const phone = newPhone();
  await signUp(phone, { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
  const appUrl = await openLink(await emailLink(email, 'signup'));
  await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)));
  await signOut(phone);
  await sleep(1100); // Supabase sends at most one email per address per second
  return email;
}

describe('auth against local Supabase', () => {
  it('signs up, requires the emailed confirmation, then signs in with the display name stored', async () => {
    const email = uniqueEmail('signup');
    const phone = newPhone();

    expect(await signUp(phone, { email, password: PASSWORD, displayName: ' Alice ' }, CONFIRM_REDIRECT)).toEqual({ ok: true });
    expect(await signIn(phone, { email, password: PASSWORD })).toMatchObject({ ok: false, code: 'email_not_confirmed' });

    const appUrl = await openLink(await emailLink(email, 'signup'));
    expect(appUrl.protocol).toBe('planme:');
    expect(await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)))).toEqual({ ok: true });

    const { data } = await phone.from('profiles').select('display_name').single();
    expect(data?.display_name).toBe('Alice');
  });

  it('signs in whatever the capitalisation of the email', async () => {
    const email = await confirmedAccount();
    expect(await signIn(newPhone(), { email: `  ${email.toUpperCase()} `, password: PASSWORD })).toEqual({ ok: true });
  });

  it('rejects a wrong password with the app message', async () => {
    const email = await confirmedAccount();
    expect(await signIn(newPhone(), { email, password: 'wrong2026' })).toEqual({
      ok: false,
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  });

  it('enforces the password rule on the server too', async () => {
    const result = await signUp(newPhone(), { email: uniqueEmail('weak'), password: 'familyplanner', displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, code: 'weak_password' });
  });

  it('tells someone signing up with a confirmed account to sign in instead', async () => {
    const email = await confirmedAccount();
    const result = await signUp(newPhone(), { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, message: 'An account with this email already exists. Sign in instead.' });
  });

  it('resets a forgotten password with the emailed link', async () => {
    const email = await confirmedAccount();
    const phone = newPhone();

    expect(await requestPasswordReset(phone, email, RESET_REDIRECT)).toEqual({ ok: true });
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    expect(`${appUrl.protocol}//${appUrl.host}`).toBe('planme://reset-password');
    expect(await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)))).toEqual({ ok: true });
    expect(await updatePassword(phone, 'newfamily2027')).toEqual({ ok: true });
    expect(await signOut(phone)).toEqual({ ok: true });

    expect(await signIn(newPhone(), { email, password: PASSWORD })).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(await signIn(newPhone(), { email, password: 'newfamily2027' })).toEqual({ ok: true });
  });

  it('answers a reset request for an unknown email the same way', async () => {
    expect(await requestPasswordReset(newPhone(), uniqueEmail('nobody'), RESET_REDIRECT)).toEqual({ ok: true });
  });

  it('explains a reset link opened on a different phone', async () => {
    const email = await confirmedAccount();
    await requestPasswordReset(newPhone(), email, RESET_REDIRECT);
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    const result = await completeAuthRedirect(newPhone(), parseAuthCallback(callbackParams(appUrl)));
    expect(result).toMatchObject({
      ok: false,
      code: 'bad_code_verifier',
      message: 'This link has expired or was opened on a different device. Request a new one on this phone.',
    });
  });
});
```

- [ ] **Step 7: Run the integration tests**

Run: `npm run test:integration`
Expected: PASS, 8 tests. If one fails, read the actual response: the Mailpit API path, the redirect `Location`, or a Supabase error `code` may differ by CLI version. Fix the **test helper** (e.g. the link regex) or the **app message mapping** if Supabase returns a different code for the same situation (e.g. `email_exists` instead of `user_already_exists`, or a different code for a missing verifier) — and say so in your report. Never weaken what a test checks.

- [ ] **Step 8: Run integration tests in CI**

In `.github/workflows/ci.yml`, replace the whole `database` job with:

```yaml
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: supabase/setup-cli@v1
        with:
          version: 2.120.0
      # Database, auth, REST and Mailpit only; the rest isn't needed for tests.
      - run: supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,storage-api,realtime
      - run: supabase test db
      - run: npm run test:integration
```

- [ ] **Step 9: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run db:test && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add lib/auth test-utils jest.integration.config.js jest.integration.setup.js package.json .github/workflows/ci.yml
git commit -m "FEAT-002: Add auth calls, form rules and messages, with integration tests"
```

---

### Task 4: Session state and the sign-in gate

**Files:**
- Modify: `package.json` (dev dependency), `app/_layout.tsx`
- Create: `context/AuthProvider.tsx`, `components/navigation/RootNavigator.tsx`, `app/(auth)/_layout.tsx`
- Test: `context/__tests__/AuthProvider.test.tsx`, `components/navigation/__tests__/RootNavigator.test.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2); `fakeAuthClient`, `fakeSession` (Task 3)
- Produces:
  - `AuthProvider({ client: SupabaseClient, children })`
  - `useAuth(): { client: SupabaseClient; session: Session | null; isLoading: boolean }` — throws outside the provider
  - `RootNavigator()` — renders nothing while loading, then a `Stack` where `(tabs)` and `modal` need a session, `(auth)` needs no session, and `auth-callback` / `reset-password` are always reachable
  - Route names Task 5 must create: `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/forgot-password.tsx`, `app/auth-callback.tsx`, `app/reset-password.tsx`

- [ ] **Step 1: Install the testing library**

```bash
npx expo install @testing-library/react-native "--" --dev
```

If npm then reports a missing peer `react-test-renderer`, also run `npm install --save-dev react-test-renderer@19.1.0` (it must match `react`).

- [ ] **Step 2: Write the failing tests**

Create `context/__tests__/AuthProvider.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import { AuthProvider, useAuth } from '../AuthProvider';

const setup = (fake = fakeAuthClient()) => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider client={fake.client}>{children}</AuthProvider>;
  return { fake, ...renderHook(() => useAuth(), { wrapper }) };
};

describe('AuthProvider', () => {
  it('starts loading, then has no session when signed out', async () => {
    const { result } = setup();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('picks up a saved session', async () => {
    const session = fakeSession();
    const { result } = setup(fakeAuthClient(session));
    await waitFor(() => expect(result.current.session).toBe(session));
  });

  it('follows sign-in and sign-out events', async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const session = fakeSession();
    act(() => fake.emit('SIGNED_IN', session));
    expect(result.current.session).toBe(session);
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.session).toBeNull();
  });

  it('stops loading even if reading the saved session fails', async () => {
    const fake = fakeAuthClient();
    fake.auth.getSession.mockRejectedValueOnce(new Error('keychain locked'));
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('unsubscribes when unmounted', async () => {
    const { fake, unmount, result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside the provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used inside <AuthProvider>');
  });
});
```

Create `components/navigation/__tests__/RootNavigator.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import AuthLayout from '../../../app/(auth)/_layout';
import { RootNavigator } from '../RootNavigator';

const stub = (label: string) => () => <Text>{label}</Text>;

function renderApp(fake: ReturnType<typeof fakeAuthClient>, initialUrl = '/') {
  return renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <RootNavigator />
        </AuthProvider>
      ),
      '(tabs)/index': stub('Planner'),
      modal: stub('Modal'),
      '(auth)/_layout': AuthLayout,
      '(auth)/sign-in': stub('Sign-in screen'),
      '(auth)/sign-up': stub('Sign-up screen'),
      '(auth)/forgot-password': stub('Forgot screen'),
      'auth-callback': stub('Callback screen'),
      'reset-password': stub('Reset screen'),
    },
    { initialUrl },
  );
}

describe('RootNavigator', () => {
  it('shows sign-in when signed out', async () => {
    renderApp(fakeAuthClient(null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('shows the planner when signed in', async () => {
    renderApp(fakeAuthClient(fakeSession()));
    expect(await screen.findByText('Planner')).toBeTruthy();
  });

  it('keeps signed-out people out of the planner even by URL', async () => {
    renderApp(fakeAuthClient(null), '/modal');
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
  });

  it('goes to sign-in when the session ends', async () => {
    const fake = fakeAuthClient(fakeSession());
    renderApp(fake);
    await screen.findByText('Planner');
    act(() => fake.emit('SIGNED_OUT', null));
    expect(await screen.findByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Planner')).toBeNull();
  });

  it('lets email links open whether or not you are signed in', async () => {
    renderApp(fakeAuthClient(null), '/reset-password');
    expect(await screen.findByText('Reset screen')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest context components/navigation`
Expected: FAIL with `Cannot find module '../AuthProvider'` and `Cannot find module '../RootNavigator'`.

- [ ] **Step 4: Write the provider, navigator and auth layout**

Create `context/AuthProvider.tsx`:

```tsx
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type AuthValue = { client: SupabaseClient; session: Session | null; isLoading: boolean };

const AuthContext = createContext<AuthValue | null>(null);

/** Publishes the signed-in session. Screens get the Supabase client from here too, so tests can pass a fake. */
export function AuthProvider({ client, children }: { client: SupabaseClient; children: React.ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; isLoading: boolean }>({ session: null, isLoading: true });

  useEffect(() => {
    let active = true;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, isLoading: false });
      })
      .catch(() => {
        if (active) setState({ session: null, isLoading: false });
      });
    // Don't call other supabase functions inside this callback (supabase-js can deadlock).
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, isLoading: false });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo(() => ({ client, ...state }), [client, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
```

Create `components/navigation/RootNavigator.tsx`:

```tsx
import { SplashScreen, Stack } from 'expo-router';
import React, { useEffect } from 'react';

import { useAuth } from '@/context/AuthProvider';

/** The planner needs a session; sign-in screens need none; email links work either way. */
export function RootNavigator() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  // Keep the splash screen up until we know whether someone is signed in.
  if (isLoading) return null;

  const signedIn = session !== null;
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ title: 'Signing in' }} />
      <Stack.Screen name="reset-password" options={{ title: 'New password' }} />
    </Stack>
  );
}
```

Create `app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
import React from 'react';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
    </Stack>
  );
}
```

Replace `app/_layout.tsx` with:

```tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { SplashScreen } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import 'react-native-reanimated';

import { RootNavigator } from '@/components/navigation/RootNavigator';
import { AuthProvider } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider client={supabase}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest context components/navigation`
Expected: PASS (6 provider tests, 5 navigator tests). If `SplashScreen.hideAsync` throws under Jest, add `jest.mock('expo-splash-screen')` at the top of `RootNavigator.test.tsx` and note it in the report. If `renderRouter` does not resolve `Stack.Protected` redirects the way the docs describe, report BLOCKED with the output rather than changing the guard.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. (The auth screens don't exist yet, so don't start the app.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json context components/navigation "app/(auth)/_layout.tsx" app/_layout.tsx
git commit -m "FEAT-002: Gate the planner behind sign-in with Stack.Protected"
```

---

### Task 5: The auth screens and sign-out

**Files:**
- Create: `components/auth/AuthScreen.tsx`, `components/auth/FormField.tsx`, `components/auth/PrimaryButton.tsx`, `components/auth/Notice.tsx`, `components/auth/styles.ts`, `components/auth/SignOutButton.tsx`
- Create: `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, `app/(auth)/forgot-password.tsx`, `app/auth-callback.tsx`, `app/reset-password.tsx`
- Modify: `app/(tabs)/index.tsx` (header only)
- Test: `components/auth/__tests__/sign-in.test.tsx`, `sign-up.test.tsx`, `reset-password.test.tsx`, `auth-callback.test.tsx` (not under `app/`: every file in `app/` becomes a route)

**Interfaces:**
- Consumes: `useAuth()` (Task 4); `signIn`, `signUp`, `resendConfirmation`, `requestPasswordReset`, `completeAuthRedirect`, `updatePassword`, `signOut`, `AuthResult` (Task 3); validation functions and `FieldErrors`, `normaliseEmail` (Task 3); `parseAuthCallback`, `CallbackParams` (Task 3); `authRedirectUrl` (Task 3); `fakeAuthClient`, `fakeSession` (Task 3)
- Produces: the five route files named in Task 4

- [ ] **Step 1: Write the shared pieces**

Create `components/auth/styles.ts`:

```ts
import { StyleSheet } from 'react-native';

export const BLUE = '#007BFF';

export const authStyles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: 'bold', color: BLUE, textAlign: 'center', marginBottom: 24 },
  heading: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  body: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 16 },
  links: { marginTop: 20, gap: 14, alignItems: 'center' },
  link: { color: BLUE, fontSize: 15, fontWeight: '600' },
});
```

Create `components/auth/AuthScreen.tsx`:

```tsx
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

export function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f4f4' },
  content: { padding: 24, paddingTop: 40 },
});
```

Create `components/auth/FormField.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

type Kind = 'email' | 'password' | 'newPassword' | 'name';

const KIND_PROPS: Record<Kind, TextInputProps> = {
  email: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'email', keyboardType: 'email-address', textContentType: 'emailAddress' },
  password: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'current-password', textContentType: 'password' },
  newPassword: { secureTextEntry: true, autoCapitalize: 'none', autoComplete: 'new-password', textContentType: 'newPassword' },
  name: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
};

type Props = { label: string; value: string; onChangeText: (text: string) => void; error?: string; kind: Kind };

export function FormField({ label, value, onChangeText, error, kind }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, error ? styles.inputError : null]}
        {...KIND_PROPS[kind]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  inputError: { borderColor: '#dc3545' },
  error: { color: '#dc3545', fontSize: 13, marginTop: 4 },
});
```

Create `components/auth/PrimaryButton.tsx`:

```tsx
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { BLUE } from './styles';

type Props = { title: string; onPress: () => void; busy?: boolean };

export function PrimaryButton({ title, onPress, busy = false }: Props) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[styles.button, busy ? styles.busy : null]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: BLUE, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  busy: { opacity: 0.7 },
  text: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
```

Create `components/auth/Notice.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text } from 'react-native';

export function Notice({ tone, children }: { tone: 'error' | 'info'; children: string }) {
  return (
    <Text accessibilityRole={tone === 'error' ? 'alert' : 'text'} style={[styles.notice, tone === 'error' ? styles.error : styles.info]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12, overflow: 'hidden' },
  error: { backgroundColor: '#f8d7da', color: '#842029' },
  info: { backgroundColor: '#d1e7dd', color: '#0f5132' },
});
```

Create `components/auth/SignOutButton.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { useAuth } from '@/context/AuthProvider';
import { signOut } from '@/lib/auth/api';

export function SignOutButton() {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    setBusy(true);
    const result = await signOut(client);
    setBusy(false);
    // On success the route guard takes over and shows sign-in.
    if (!result.ok) Alert.alert("Couldn't sign out", result.message);
  };

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onPress} disabled={busy} hitSlop={8} style={styles.button}>
      <Text style={styles.text}>Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { position: 'absolute', right: 16, bottom: 14 },
  text: { color: 'white', fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Write the failing screen tests**

Create `components/auth/__tests__/sign-in.test.tsx`:

```tsx
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Slot } from 'expo-router';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignInScreen from '../../../app/(auth)/sign-in';

function renderSignIn(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-in': SignInScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      'sign-up': () => <Text>Sign-up screen</Text>,
    },
    { initialUrl: '/sign-in' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Sign-in screen', () => {
  it('checks the form before calling the server', async () => {
    const fake = renderSignIn();
    fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('signs in with the normalised email', async () => {
    const fake = renderSignIn();
    fill('Email', ' Alice@Test.NZ ');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@test.nz', password: 'family26' }));
  });

  it('shows the server problem and lets you try again', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'invalid_credentials'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'wrong');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('explains a dropped connection and re-enables the button', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Network request failed'));
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("Can't reach the server. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled();
  });

  it('offers to resend the confirmation email when the account is unconfirmed', async () => {
    const fake = fakeAuthClient();
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('x', 400, 'email_not_confirmed'),
    });
    renderSignIn(fake);
    fill('Email', 'alice@test.nz');
    fill('Password', 'family26');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Resend confirmation email' }));
    expect(await screen.findByText('We sent a new confirmation email.')).toBeTruthy();
    expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'alice@test.nz' }));
  });
});
```

Create `components/auth/__tests__/sign-up.test.tsx`:

```tsx
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import SignUpScreen from '../../../app/(auth)/sign-up';

function renderSignUp(fake = fakeAuthClient()) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'sign-up': SignUpScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
    },
    { initialUrl: '/sign-up' },
  );
  return fake;
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

const fillValidForm = () => {
  fill('Your name (optional)', 'Alice');
  fill('Email', 'Alice@test.nz');
  fill('Password', 'family26');
  fill('Confirm password', 'family26');
};

describe('Sign-up screen', () => {
  it('shows every form problem at once', async () => {
    const fake = renderSignUp();
    fill('Email', 'alice');
    fill('Password', 'short');
    fill('Confirm password', 'other');
    fireEvent.press(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(fake.auth.signUp).not.toHaveBeenCalled();
  });

  it('asks you to check your email after signing up', async () => {
    const fake = renderSignUp();
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/alice@test\.nz/)).toBeTruthy();
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@test.nz', options: expect.objectContaining({ data: { display_name: 'Alice' } }) }),
    );
  });

  it('tells you to sign in if the email already has an account', async () => {
    const fake = fakeAuthClient();
    fake.auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError('x', 422, 'user_already_exists') });
    renderSignUp(fake);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists. Sign in instead.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Check your email')).toBeNull());
  });
});
```

Create `components/auth/__tests__/reset-password.test.tsx`:

```tsx
import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import ResetPasswordScreen from '../../../app/reset-password';

function renderReset(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <React.StrictMode>
          <AuthProvider client={fake.client}>
            <Slot />
          </AuthProvider>
        </React.StrictMode>
      ),
      'reset-password': ResetPasswordScreen,
      'forgot-password': () => <Text>Forgot screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

const fill = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);

describe('Reset-password screen', () => {
  it('uses the link code exactly once, even under StrictMode', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('saves the new password and opens the planner', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    act(() => fake.emit('PASSWORD_RECOVERY', fakeSession()));
    fill('New password', 'newfamily27');
    fill('Confirm password', 'newfamily27');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'newfamily27' });
  });

  it('checks the new password before saving', async () => {
    const fake = fakeAuthClient();
    renderReset(fake, '/reset-password?code=abc');
    await screen.findByLabelText('New password');
    fill('New password', 'abc');
    fill('Confirm password', 'abc');
    fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(fake.auth.updateUser).not.toHaveBeenCalled();
  });

  it('explains a link opened on another phone and offers a new one', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderReset(fake, '/reset-password?code=abc');
    expect(
      await screen.findByText('This link has expired or was opened on a different device. Request a new one on this phone.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Request a new link'));
    expect(await screen.findByText('Forgot screen')).toBeTruthy();
  });

  it('never shows text from the link itself', async () => {
    renderReset(fakeAuthClient(), '/reset-password?error=access_denied&error_code=otp_expired&error_description=Call%200800%20SCAM');
    await waitFor(() => expect(screen.getByText(/This link has expired/)).toBeTruthy());
    expect(screen.queryByText(/SCAM/)).toBeNull();
  });
});
```

Create `components/auth/__tests__/auth-callback.test.tsx`:

```tsx
import { AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

import { AuthProvider } from '@/context/AuthProvider';
import { fakeAuthClient } from '@/test-utils/fakeAuthClient';

import AuthCallbackScreen from '../../../app/auth-callback';

function renderCallback(fake: ReturnType<typeof fakeAuthClient>, initialUrl: string) {
  renderRouter(
    {
      _layout: () => (
        <AuthProvider client={fake.client}>
          <Slot />
        </AuthProvider>
      ),
      'auth-callback': AuthCallbackScreen,
      'sign-in': () => <Text>Sign-in screen</Text>,
      index: () => <Text>Planner</Text>,
    },
    { initialUrl },
  );
}

describe('Email confirmation link', () => {
  it('signs you in and opens the planner', async () => {
    const fake = fakeAuthClient();
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Planner')).toBeTruthy();
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });

  it('says the email is confirmed when the link was opened on another device', async () => {
    const fake = fakeAuthClient();
    fake.auth.exchangeCodeForSession.mockRejectedValueOnce(new AuthPKCECodeVerifierMissingError());
    renderCallback(fake, '/auth-callback?code=abc');
    expect(await screen.findByText('Your email is confirmed. Sign in to continue.')).toBeTruthy();
  });

  it('explains an expired link', async () => {
    renderCallback(fakeAuthClient(), '/auth-callback?error=access_denied&error_code=otp_expired');
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByText('Back to sign in')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest components/auth`
Expected: FAIL with `Cannot find module '../../../app/(auth)/sign-in'` (and the other screens).

- [ ] **Step 4: Write the screens**

Create `app/(auth)/sign-in.tsx`:

```tsx
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { resendConfirmation, signIn } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, validateSignIn } from '@/lib/auth/validation';

type Message = { tone: 'error' | 'info'; text: string };

export default function SignInScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<Message | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignIn({ email, password });
    setErrors(found);
    setMessage(null);
    setNeedsConfirmation(false);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signIn(client, { email, password });
    setBusy(false);
    // On success the auth listener stores the session and the route guard opens the planner.
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.message });
      setNeedsConfirmation(result.code === 'email_not_confirmed');
    }
  };

  const resend = async () => {
    setBusy(true);
    const result = await resendConfirmation(client, email, authRedirectUrl('auth-callback'));
    setBusy(false);
    setNeedsConfirmation(false);
    setMessage(result.ok ? { tone: 'info', text: 'We sent a new confirmation email.' } : { tone: 'error', text: result.message });
  };

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Plan-Me</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="password" value={password} onChangeText={setPassword} error={errors.password} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {needsConfirmation ? <PrimaryButton title="Resend confirmation email" onPress={resend} busy={busy} /> : null}
      <PrimaryButton title="Sign in" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/forgot-password" style={authStyles.link}>
          Forgot your password?
        </Link>
        <Link href="/sign-up" style={authStyles.link}>
          Create an account
        </Link>
      </View>
    </AuthScreen>
  );
}
```

Create `app/(auth)/sign-up.tsx`:

```tsx
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { signUp } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateSignUp } from '@/lib/auth/validation';

export default function SignUpScreen() {
  const { client } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateSignUp({ displayName, email, password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await signUp(client, { email, password, displayName }, authRedirectUrl('auth-callback'));
    setBusy(false);
    if (result.ok) setSentTo(normaliseEmail(email));
    else setProblem(result.message);
  };

  if (sentTo) {
    return (
      <AuthScreen>
        <Text style={authStyles.heading}>Check your email</Text>
        <Text style={authStyles.body}>We sent a link to {sentTo}. Open it on this phone to finish creating your account.</Text>
        <View style={authStyles.links}>
          <Link href="/sign-in" replace style={authStyles.link}>
            Back to sign in
          </Link>
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <FormField label="Your name (optional)" kind="name" value={displayName} onChangeText={setDisplayName} error={errors.displayName} />
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      <FormField label="Password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Create account" onPress={submit} busy={busy} />
      <View style={authStyles.links}>
        <Link href="/sign-in" replace style={authStyles.link}>
          I already have an account
        </Link>
      </View>
    </AuthScreen>
  );
}
```

Create `app/(auth)/forgot-password.tsx`:

```tsx
import React, { useState } from 'react';
import { Text } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { requestPasswordReset } from '@/lib/auth/api';
import { authRedirectUrl } from '@/lib/auth/redirect';
import { type FieldErrors, normaliseEmail, validateEmailOnly } from '@/lib/auth/validation';

export default function ForgotPasswordScreen() {
  const { client } = useAuth();
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const found = validateEmailOnly(email);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await requestPasswordReset(client, email, authRedirectUrl('reset-password'));
    setBusy(false);
    setMessage(
      result.ok
        ? { tone: 'info', text: `If ${normaliseEmail(email)} has an account, we've sent it a link to reset the password. Open it on this phone.` }
        : { tone: 'error', text: result.message },
    );
  };

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Enter your email and we'll send you a link to choose a new password.</Text>
      <FormField label="Email" kind="email" value={email} onChangeText={setEmail} error={errors.email} />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <PrimaryButton title="Send reset link" onPress={submit} busy={busy} />
    </AuthScreen>
  );
}
```

Create `app/reset-password.tsx`:

```tsx
import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { FormField } from '@/components/auth/FormField';
import { Notice } from '@/components/auth/Notice';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect, updatePassword } from '@/lib/auth/api';
import { type CallbackParams, parseAuthCallback } from '@/lib/auth/callback';
import { type FieldErrors, validateNewPassword } from '@/lib/auth/validation';

type Stage = { name: 'checking' } | { name: 'ready' } | { name: 'invalid'; message: string };

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<CallbackParams>();
  const { client, session } = useAuth();
  const [stage, setStage] = useState<Stage>({ name: 'checking' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A link's code works once; StrictMode runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      setStage(result.ok ? { name: 'ready' } : { name: 'invalid', message: result.message });
    });
  }, [client, params]);

  const save = async () => {
    const found = validateNewPassword({ password, confirmPassword });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await updatePassword(client, password);
    setBusy(false);
    if (result.ok) router.replace('/');
    else setProblem(result.message);
  };

  if (stage.name === 'checking') {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Checking your link" />
      </AuthScreen>
    );
  }

  if (stage.name === 'invalid') {
    return (
      <AuthScreen>
        <Notice tone="error">{stage.message}</Notice>
        <View style={authStyles.links}>
          {session ? (
            <Link href="/" replace style={authStyles.link}>
              Back to the planner
            </Link>
          ) : (
            <Link href="/forgot-password" replace style={authStyles.link}>
              Request a new link
            </Link>
          )}
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.body}>Choose a new password for your account.</Text>
      <FormField label="New password" kind="newPassword" value={password} onChangeText={setPassword} error={errors.password} />
      <FormField label="Confirm password" kind="newPassword" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <PrimaryButton title="Save password" onPress={save} busy={busy} />
    </AuthScreen>
  );
}
```

Create `app/auth-callback.tsx`:

```tsx
import { Link, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthScreen } from '@/components/auth/AuthScreen';
import { Notice } from '@/components/auth/Notice';
import { authStyles } from '@/components/auth/styles';
import { useAuth } from '@/context/AuthProvider';
import { completeAuthRedirect } from '@/lib/auth/api';
import { type CallbackParams, parseAuthCallback } from '@/lib/auth/callback';

// The verify step already confirmed the email on the server; only the sign-in part
// needs the phone that asked for the link.
const CONFIRMED_ELSEWHERE = 'Your email is confirmed. Sign in to continue.';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<CallbackParams>();
  const { client } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeAuthRedirect(client, parseAuthCallback(params)).then(result => {
      if (result.ok) router.replace('/');
      else setProblem(result.code === 'bad_code_verifier' ? CONFIRMED_ELSEWHERE : result.message);
    });
  }, [client, params]);

  if (!problem) {
    return (
      <AuthScreen>
        <ActivityIndicator accessibilityLabel="Signing you in" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Notice tone={problem === CONFIRMED_ELSEWHERE ? 'info' : 'error'}>{problem}</Notice>
      <View style={authStyles.links}>
        <Link href="/sign-in" replace style={authStyles.link}>
          Back to sign in
        </Link>
      </View>
    </AuthScreen>
  );
}
```

- [ ] **Step 5: Add sign-out to the planner header**

In `app/(tabs)/index.tsx`, add the import `import { SignOutButton } from '@/components/auth/SignOutButton';` next to the other `@/` imports, and change the header block to:

```tsx
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Plan-Me</Text>
        <SignOutButton />
      </View>
```

Nothing else in this file changes.

- [ ] **Step 6: Run the screen tests**

Run: `npx jest components/auth`
Expected: PASS (5 sign-in, 3 sign-up, 5 reset-password, 3 auth-callback). If `renderRouter` needs the routes named differently (e.g. it doesn't accept `index` without a group), adjust only the **test route map**.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run test:integration`
Expected: all pass.

- [ ] **Step 8: Check the test files are not routes**

With `.env.local` pointing at the local stack, run `npx expo start --web` briefly and open `http://localhost:8081/_sitemap`. The list must not include `__tests__`. If it does, move the four test files to `components/auth/__tests__/`, fix their imports (`../../../app/(auth)/sign-in` etc.), re-run Step 6, and say so in the report. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add components/auth app "app/(tabs)/index.tsx"
git commit -m "FEAT-002: Add sign-in, sign-up, password reset and sign-out screens"
```

---

### Task 6: Hosted dev project guide and docs

**Files:**
- Create: `docs/guides/supabase-hosted-setup.md`
- Modify: `docs/specs/infrastructure.md`, `docs/specs/architecture.md`, `docs/specs/features.md`, `docs/registry/FEAT-002-accounts-family-sharing.md`, `docs/registry/INDEX.md`, `docs/README.md`

**Interfaces:**
- Consumes: everything above. No code.

- [ ] **Step 1: Write the hosted setup guide**

Create `docs/guides/supabase-hosted-setup.md`:

````markdown
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

This applies the migrations. **Never add `--include-seed`**: `seed.sql` holds test helpers that must not exist on a hosted project. Also leave **Branching** turned off.

```bash
npx supabase config push
```

Read the diff it shows; it should set `site_url = planme://`, the redirect URLs, the password rule and email confirmation. Accept it.

## 3. Check account deletion will work
In the dashboard: **SQL Editor** → run:

```sql
select has_table_privilege('postgres', 'auth.users', 'DELETE');
```

It must return `true`. If it returns `false`, tell Claude: account deletion will need an Edge Function instead.

## 4. Email that reaches your family
Supabase's built-in email only sends to members of your Supabase organisation, a few per hour. Fine for testing with your own address; for anyone else, add an SMTP sender:

1. Sign up at https://www.brevo.com (free, 300 emails a day), verify a sender address (e.g. your Gmail), and create an **SMTP key**.
2. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable custom SMTP: host `smtp-relay.brevo.com`, port `587`, username = your Brevo login, password = the SMTP key, sender = the verified address, sender name `Plan-Me`.

## 5. Point the app at it
Dashboard → **Project Settings → API Keys**. Copy the project URL and the **publishable** key (never the secret key) into `.env.local`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Restart `npx expo start` after changing `.env.local`.

## 6. Try it on your phone
- [ ] Create an account → "Check your email" → open the link **on the phone** → the planner opens
- [ ] Open the same link again → "This link has expired…" (not a crash)
- [ ] Sign out (top right) → sign-in screen; back button doesn't return to the planner
- [ ] Sign in with the email in capitals → works
- [ ] Wrong password → "Email or password is incorrect."
- [ ] Airplane mode → sign in → "Can't reach the server…"; button usable again
- [ ] Forgot password → link on the phone → new password → planner; old password no longer works
- [ ] Close and reopen the app → still signed in
- [ ] Your old on-device events are still in the planner (they stay local until Plan 4)

## Notes
- Free projects pause after a week of no use; restore them from the dashboard.
- `exp://**` is in the redirect allow-list so Expo Go works. Remove it from the production project.
````

- [ ] **Step 2: Update the specs**

In `docs/specs/infrastructure.md` §2.5, rename `EXPO_PUBLIC_SUPABASE_ANON_KEY` to `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and change its "Secret?" cell to `No — data is protected by RLS (Supabase now calls it the publishable key)`. Rename `SUPABASE_SERVICE_ROLE_KEY` to `SUPABASE_SECRET_KEY (service role)`. Under §2.2 add: `Phone testing uses the hosted \`plan-me-dev\` project (see [hosted setup](../guides/supabase-hosted-setup.md)); local email links point at 127.0.0.1, which a phone can't open.` Under §2.6 change the database CI bullet to `supabase start (database, auth, REST, Mailpit) + supabase test db + npm run test:integration`.

In `docs/specs/architecture.md` §3, in the code-layout block, mark `(auth)/sign-in, sign-up, forgot-password` and the `lib/supabase.ts` and `context/AuthProvider.tsx` lines with `(built, Plan 3)`, and add the lines `auth-callback.tsx, reset-password.tsx   Email link targets (outside the sign-in gate)` under `app/` and `components/navigation/RootNavigator.tsx   Stack.Protected gate` under the tree.

In `docs/specs/features.md` under "Accounts — FEAT-002", change the heading to `### Accounts — FEAT-002 (in progress: sign-in built in Plan 3)`.

- [ ] **Step 3: Update the registry and docs index**

In `docs/registry/FEAT-002-accounts-family-sharing.md` set `Updated` to today's date (dd/mm/yyyy). Leave every acceptance-criteria box as it is: the sign-in box gets ticked only after the phone checklist in the guide passes. Under **Links → PRs**, leave it blank. In `docs/registry/INDEX.md` update the FEAT-002 row's Updated column. In `docs/README.md` under **Guides** add `- [Hosted Supabase dev project — your steps](guides/supabase-hosted-setup.md)`, and under **Implementation plans** add a row `| 07/10/2026 | [Plan 3: sign-in, sign-up and password reset](superpowers/plans/2026-10-07-feat-002-plan-3-sign-in.md) |`.

- [ ] **Step 4: Check and commit**

Run: `npm run typecheck && npm test` (docs-only task; this is a guard against accidental edits).

```bash
git add docs
git commit -m "FEAT-002: Add the hosted dev project guide and update docs for sign-in"
```
