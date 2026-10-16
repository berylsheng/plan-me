import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import { AuthProvider, useAuth } from '../AuthProvider';

const LAST_USER = 'planme:lastUser';
const alice = { id: 'user-1', email: 'alice@test.nz' };

beforeEach(async () => {
  await AsyncStorage.clear();
});

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

  it('keeps the session from a SIGNED_IN event even when getSession resolves later with null', async () => {
    // Simulate: SIGNED_IN fires (child effect) before getSession resolves (parent effect).
    let resolveGetSession: (v: { data: { session: null }; error: null }) => void;
    const getSessionPromise = new Promise<{ data: { session: null }; error: null }>(resolve => {
      resolveGetSession = resolve;
    });
    const fake = fakeAuthClient();
    fake.auth.getSession.mockReturnValueOnce(getSessionPromise as ReturnType<typeof fake.auth.getSession>);
    const { result } = setup(fake);
    // Still loading — getSession hasn't resolved.
    expect(result.current.isLoading).toBe(true);
    // Auth event arrives before getSession resolves.
    const session = fakeSession();
    act(() => fake.emit('SIGNED_IN', session));
    expect(result.current.session).toBe(session);
    expect(result.current.isLoading).toBe(false);
    // getSession now resolves with null — must NOT overwrite the session.
    await act(async () => resolveGetSession({ data: { session: null }, error: null }));
    expect(result.current.session).toBe(session);
  });
});

describe('AuthProvider offline', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens at once for the last user, before the session check finishes', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const fake = fakeAuthClient();
    fake.auth.getSession.mockReturnValueOnce(new Promise<never>(() => {})); // offline refresh retries
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toEqual(alice);
    expect(result.current.session).toBeNull();
  });

  it('stays signed in, marked offline, when the session cannot be refreshed', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const fake = fakeAuthClient();
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.user).toEqual(alice);
  });

  it('stays signed in when the server has a problem refreshing the session (BUG-006)', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const fake = fakeAuthClient();
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new AuthRetryableFetchError('Internal Server Error', 500) });
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.user).toEqual(alice);
  });

  it('signs out, and forgets the last user, when there is no session and no network problem', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const { result } = setup(fakeAuthClient(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {});
    expect(result.current.user).toBeNull();
    expect(await AsyncStorage.getItem(LAST_USER)).toBeNull();
  });

  it('clears alice and storage after getSession confirms sign-out (alice appears first)', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    let resolveGetSession: (v: { data: { session: null }; error: null }) => void;
    const getSessionPromise = new Promise<{ data: { session: null }; error: null }>(resolve => {
      resolveGetSession = resolve;
    });
    const fake = fakeAuthClient();
    fake.auth.getSession.mockReturnValueOnce(getSessionPromise as ReturnType<typeof fake.auth.getSession>);
    const { result } = setup(fake);
    // readLastUser resolves first while getSession is still pending → alice appears
    await waitFor(() => expect(result.current.user).toEqual(alice));
    // getSession now confirms no session → alice must disappear
    await act(async () => resolveGetSession({ data: { session: null }, error: null }));
    expect(result.current.user).toBeNull();
    expect(await AsyncStorage.getItem(LAST_USER)).toBeNull();
  });

  it('remembers whoever signs in', async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => fake.emit('SIGNED_IN', fakeSession()));
    expect(result.current.user).toEqual(alice);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(LAST_USER)) ?? 'null')).toEqual(alice));
  });

  it('forgets the user when the server ends the session', async () => {
    const { result, fake } = setup(fakeAuthClient(fakeSession()));
    await waitFor(() => expect(result.current.user).toEqual(alice));
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.user).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(LAST_USER)).toBeNull());
  });

  it("signOut clears the user only when it works", async () => {
    const fake = fakeAuthClient(fakeSession());
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.user).toEqual(alice));
    fake.auth.signOut.mockResolvedValueOnce({ error: new AuthApiError('nope', 500, 'unexpected_failure') });
    await act(async () => {
      expect(await result.current.signOut()).toMatchObject({ ok: false });
    });
    expect(result.current.user).toEqual(alice);
    await act(async () => {
      expect(await result.current.signOut()).toEqual({ ok: true });
    });
    expect(result.current.user).toBeNull();
    expect(fake.auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
  });

  it("ignores a stored user when sign-out was already confirmed via event", async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    let resolveGetItem!: (v: string | null) => void;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      (_key: string) => new Promise<string | null>(resolve => { resolveGetItem = resolve; }),
    );
    const fake = fakeAuthClient();
    // Keep getSession pending so only the SIGNED_OUT event sets confirmedSignedOut.
    fake.auth.getSession.mockReturnValueOnce(new Promise<never>(() => {}));
    const { result } = setup(fake);
    // SIGNED_OUT event fires before readLastUser resolves.
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.user).toBeNull();
    // readLastUser now resolves with a stored user — must be ignored.
    await act(async () => resolveGetItem(JSON.stringify(alice)));
    expect(result.current.user).toBeNull();
  });

  it('goes offline (not signed out) when getSession rejects', async () => {
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const fake = fakeAuthClient();
    fake.auth.getSession.mockRejectedValueOnce(new Error('network failure'));
    const { result } = setup(fake);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.user).toEqual(alice);
  });

  it('stays signed out when SIGNED_OUT fires then getSession returns a network error', async () => {
    // This test fails if the !confirmedSignedOut guard is removed from the network-error branch.
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    let resolveGetItem!: (v: string | null) => void;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      (_key: string) => new Promise<string | null>(resolve => { resolveGetItem = resolve; }),
    );
    let resolveGetSession!: (v: { data: { session: null }; error: AuthRetryableFetchError }) => void;
    const getSessionPromise = new Promise<{ data: { session: null }; error: AuthRetryableFetchError }>(resolve => {
      resolveGetSession = resolve;
    });
    const fake = fakeAuthClient();
    fake.auth.getSession.mockReturnValueOnce(getSessionPromise as ReturnType<typeof fake.auth.getSession>);
    const { result } = setup(fake);
    // Confirm sign-out before either promise resolves.
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.user).toBeNull();
    // getSession resolves with network error after sign-out confirmed — must NOT set offline.
    await act(async () => resolveGetSession({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }));
    expect(result.current.offline).toBe(false);
    // readLastUser resolves — must NOT restore alice.
    await act(async () => resolveGetItem(JSON.stringify(alice)));
    expect(result.current.user).toBeNull();
    expect(result.current.offline).toBe(false);
  });

  it('stays signed out when SIGNED_OUT fires then getSession rejects', async () => {
    // This test fails if the !confirmedSignedOut guard is removed from the rejection handler.
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    let resolveGetItem!: (v: string | null) => void;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      (_key: string) => new Promise<string | null>(resolve => { resolveGetItem = resolve; }),
    );
    let rejectGetSession!: (reason: Error) => void;
    const getSessionPromise = new Promise<never>((_resolve, reject) => {
      rejectGetSession = reject;
    });
    const fake = fakeAuthClient();
    fake.auth.getSession.mockReturnValueOnce(getSessionPromise as ReturnType<typeof fake.auth.getSession>);
    const { result } = setup(fake);
    // Confirm sign-out before either promise resolves.
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.user).toBeNull();
    // getSession rejects after sign-out confirmed — must NOT set offline.
    await act(async () => { rejectGetSession(new Error('network failure')); });
    expect(result.current.offline).toBe(false);
    // readLastUser resolves — must NOT restore alice.
    await act(async () => resolveGetItem(JSON.stringify(alice)));
    expect(result.current.user).toBeNull();
    expect(result.current.offline).toBe(false);
  });

  it('resets to bob after sign-out then sign-in as bob', async () => {
    const { result, fake } = setup(fakeAuthClient(fakeSession()));
    await waitFor(() => expect(result.current.user).toEqual(alice));
    act(() => fake.emit('SIGNED_OUT', null));
    expect(result.current.user).toBeNull();
    const bobSession: Session = {
      ...fakeSession('bob@test.nz'),
      user: { ...fakeSession('bob@test.nz').user, id: 'user-2' },
    };
    act(() => fake.emit('SIGNED_IN', bobSession));
    expect(result.current.user).toEqual({ id: 'user-2', email: 'bob@test.nz' });
  });
});
