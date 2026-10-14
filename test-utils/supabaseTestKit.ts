import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { completeAuthRedirect, signOut, signUp } from '@/lib/auth/api';
import { parseAuthCallback } from '@/lib/auth/callback';

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} is not set; run through \`npm run test:integration\``);
  return value;
};

const API_URL = required('SUPABASE_TEST_URL', process.env.SUPABASE_TEST_URL);
const PUBLISHABLE_KEY = required('SUPABASE_TEST_PUBLISHABLE_KEY', process.env.SUPABASE_TEST_PUBLISHABLE_KEY);
const MAILPIT_URL = required('SUPABASE_TEST_MAILPIT_URL', process.env.SUPABASE_TEST_MAILPIT_URL);

export const CONFIRM_REDIRECT = 'planme://auth-callback';
export const RESET_REDIRECT = 'planme://reset-password';
export const PASSWORD = 'family2026';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nz`;

/** The verify link from the newest email of this type that Mailpit caught for the address. */
export async function emailLink(email: string, type: 'signup' | 'recovery'): Promise<string> {
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
export async function openLink(link: string): Promise<URL> {
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) throw new Error(`Verify link did not redirect (HTTP ${response.status})`);
  return new URL(location);
}

export const callbackParams = (url: URL) => Object.fromEntries(url.searchParams.entries());

/** A confirmed account, signed out again. */
export async function confirmedAccount(): Promise<string> {
  const email = uniqueEmail('member');
  const phone = newPhone().client;
  await signUp(phone, { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
  const appUrl = await openLink(await emailLink(email, 'signup'));
  await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)));
  await signOut(phone);
  await sleep(1100); // Supabase sends at most one email per address per second
  return email;
}

const SERVICE_ROLE_KEY = required('SUPABASE_TEST_SERVICE_ROLE_KEY', process.env.SUPABASE_TEST_SERVICE_ROLE_KEY);

/** Local admin client, for creating test users without sending emails. Test code only. */
export const adminClient = createClient(API_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export type TestPhone = { client: SupabaseClient; setOnline: (online: boolean) => void };

/** A client like the app's, with in-memory storage and a switch to simulate losing the connection. */
export function newPhone(): TestPhone {
  const memory = new Map<string, string>();
  let online = true;
  const client = createClient(API_URL, PUBLISHABLE_KEY, {
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
    global: {
      fetch: (input, init) => (online ? fetch(input, init) : Promise.reject(new TypeError('Network request failed'))),
    },
    realtime: { disconnectOnEmptyChannelsAfterMs: 0 },
  });
  return {
    client,
    setOnline: value => {
      online = value;
    },
  };
}

/** A confirmed account made through the admin API (no email, no sign-up rate limit). */
export async function createConfirmedUser(label = 'member'): Promise<{ email: string; userId: string }> {
  const email = uniqueEmail(label);
  const { data, error } = await adminClient.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  return { email, userId: data.user.id };
}

/** A phone signed in as a new confirmed account. */
export async function signedInPhone(label = 'member'): Promise<TestPhone & { email: string; userId: string }> {
  const { email, userId } = await createConfirmedUser(label);
  const phone = newPhone();
  const { error } = await phone.client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { ...phone, email, userId };
}
