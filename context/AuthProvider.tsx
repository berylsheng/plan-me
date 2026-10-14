import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { type AuthResult, signOut as signOutRequest } from '@/lib/auth/api';
import { authErrorCode } from '@/lib/auth/errors';
import { clearLastUser, type KnownUser, readLastUser, writeLastUser } from '@/lib/auth/lastUser';

type AuthState = {
  session: Session | null;
  /** Who is signed in on this phone. Kept while offline, even when the session can't be refreshed yet. */
  user: KnownUser | null;
  /** The server couldn't be reached to confirm the session. */
  offline: boolean;
  isLoading: boolean;
};

type AuthValue = AuthState & { client: SupabaseClient; signOut: () => Promise<AuthResult> };

const SIGNED_OUT: AuthState = { session: null, user: null, offline: false, isLoading: false };
const knownUser = (user: User): KnownUser => ({ id: user.id, email: user.email ?? null });
const signedIn = (session: Session): AuthState => ({ session, user: knownUser(session.user), offline: false, isLoading: false });

const AuthContext = createContext<AuthValue | null>(null);

/** Publishes who is signed in. Screens get the Supabase client from here too, so tests can pass a fake. */
export function AuthProvider({ client, children }: { client: SupabaseClient; children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...SIGNED_OUT, isLoading: true });

  useEffect(() => {
    let active = true;
    let sawSession = false;
    // Tracks when we know for certain the user is signed out, so readLastUser can't
    // re-populate the user after a confirmed sign-out.
    let confirmedSignedOut = false;

    // The last user on this phone, so the planner opens at once, even offline.
    readLastUser().then(last => {
      if (active && last && !confirmedSignedOut)
        setState(prev => (!prev.isLoading && !prev.offline ? prev : { ...prev, user: last, isLoading: false }));
    });

    // The real check. Offline with an expired token, supabase-js retries for ~25 s first.
    client.auth.getSession().then(
      ({ data, error }) => {
        if (!active) return;
        if (data.session) {
          if (!sawSession) {
            sawSession = true;
            confirmedSignedOut = false;
            void writeLastUser(data.session.user);
            setState(signedIn(data.session));
          }
          return;
        }
        if (sawSession) return;
        if (authErrorCode(error) === 'network') {
          if (!confirmedSignedOut) setState(prev => ({ ...prev, offline: true, isLoading: false }));
          return;
        }
        // No session and no network problem: never signed in here, or the server ended it.
        confirmedSignedOut = true;
        void clearLastUser();
        setState(SIGNED_OUT);
      },
      () => {
        // Treat a rejected getSession the same as a network error: stay offline with the last user.
        // Skip when sawSession (mirror the resolved branch) or when sign-out was already confirmed.
        if (active && !sawSession && !confirmedSignedOut) setState(prev => ({ ...prev, offline: true, isLoading: false }));
      },
    );

    // Don't call other supabase functions inside this callback (supabase-js can deadlock).
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session) {
        sawSession = true;
        confirmedSignedOut = false;
        void writeLastUser(session.user);
        setState(signedIn(session));
        return;
      }
      if (event === 'SIGNED_OUT') {
        sawSession = false;
        confirmedSignedOut = true;
        void clearLastUser();
        setState(SIGNED_OUT);
      }
      // INITIAL_SESSION without a session: getSession decides (it can tell offline from signed out).
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    const result = await signOutRequest(client);
    if (result.ok) {
      await clearLastUser();
      setState(SIGNED_OUT);
    }
    return result;
  }, [client]);

  const value = useMemo(() => ({ client, ...state, signOut }), [client, state, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
