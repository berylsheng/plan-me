import type { Session, SupabaseClient } from '@supabase/supabase-js';

type AuthClient = SupabaseClient['auth'];

type Listener = (event: string, session: Session | null) => void;

/**
 * A stand-in for `supabase.auth` in component tests. Every method is a jest.fn you can override.
 * Like supabase-js, getSession returns the latest session, including ones announced with `emit`.
 */
export function fakeAuthClient(initial: Session | null = null) {
  let listener: Listener | null = null;
  let current = initial;
  const unsubscribe = jest.fn();
  const auth = {
    getSession: jest.fn(
      async () =>
        ({ data: { session: current }, error: null }) as Awaited<ReturnType<AuthClient['getSession']>>,
    ),
    onAuthStateChange: jest.fn((callback: Listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithPassword: jest.fn(
      async () =>
        ({ data: { user: null, session: null }, error: null }) as unknown as Awaited<
          ReturnType<AuthClient['signInWithPassword']>
        >,
    ),
    signUp: jest.fn(
      async () =>
        ({ data: { user: null, session: null }, error: null }) as unknown as Awaited<
          ReturnType<AuthClient['signUp']>
        >,
    ),
    resend: jest.fn(
      async () =>
        ({ data: { user: null, session: null }, error: null }) as unknown as Awaited<
          ReturnType<AuthClient['resend']>
        >,
    ),
    resetPasswordForEmail: jest.fn(
      async () =>
        ({ data: {}, error: null }) as Awaited<ReturnType<AuthClient['resetPasswordForEmail']>>,
    ),
    exchangeCodeForSession: jest.fn(
      async () =>
        ({ data: { user: null, session: null }, error: null }) as unknown as Awaited<
          ReturnType<AuthClient['exchangeCodeForSession']>
        >,
    ),
    updateUser: jest.fn(
      async () =>
        ({ data: { user: null }, error: null }) as unknown as Awaited<
          ReturnType<AuthClient['updateUser']>
        >,
    ),
    signOut: jest.fn(
      async () => ({ error: null }) as Awaited<ReturnType<AuthClient['signOut']>>,
    ),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    /** Simulate supabase-js telling the app the session changed. */
    emit: (event: string, session: Session | null) => {
      current = session;
      listener?.(event, session);
    },
  };
}

export const fakeSession = (email = 'alice@test.nz', id = 'user-1'): Session => ({
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id, email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-07T00:00:00Z' },
});
