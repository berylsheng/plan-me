import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';

import { changePassword, completeAuthRedirect, deleteAccount, requestPasswordReset, signIn, signOut, signUp } from '../api';
import { GENERIC_MESSAGE, LINK_PROBLEM_MESSAGE, messageForCode } from '../errors';

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

  it('silences over_email_send_rate_limit on reset (would reveal a real account)', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('slow down', 429, 'over_email_send_rate_limit') });
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toEqual({ ok: true });
  });

  it('reports other failures on reset', async () => {
    const fake = fakeAuthClient();
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('boom', 500, 'unexpected_failure') });
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, message: GENERIC_MESSAGE });
    fake.auth.resetPasswordForEmail.mockResolvedValueOnce({ data: null, error: new AuthApiError('slow down', 429, 'over_request_rate_limit') });
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'over_request_rate_limit' });
    fake.auth.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await requestPasswordReset(fake.client, 'a@test.nz', 'x')).toMatchObject({ ok: false, code: 'network' });
  });

  it('maps email_address_not_authorized to a setup-help message', () => {
    expect(messageForCode('email_address_not_authorized')).toMatch(/app owner/);
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

  it('treats a network failure as success when auth-js already cleared the local session', async () => {
    const fake = fakeAuthClient();
    fake.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await signOut(fake.client)).toEqual({ ok: true });
  });

  it('treats a server error as success when auth-js already cleared the local session (BUG-006)', async () => {
    const fake = fakeAuthClient();
    fake.auth.signOut.mockResolvedValueOnce({ error: new AuthRetryableFetchError('Bad Gateway', 502) } as never);
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await signOut(fake.client)).toEqual({ ok: true });
  });

  it('returns network failure when the session is still present after a drop', async () => {
    const fake = fakeAuthClient();
    fake.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession() }, error: null });
    expect(await signOut(fake.client)).toMatchObject({ ok: false, code: 'network' });
  });

  it('reports the failure when an expired session is still stored offline', async () => {
    // auth-js can't refresh it, so getSession hides the session but reports the error.
    const fake = fakeAuthClient();
    fake.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    fake.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    expect(await signOut(fake.client)).toMatchObject({ ok: false, code: 'network' });
  });

  it('reports the original failure if checking the session throws', async () => {
    const fake = fakeAuthClient();
    fake.auth.signOut.mockRejectedValueOnce(new TypeError('Network request failed'));
    fake.auth.getSession.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await signOut(fake.client)).toMatchObject({ ok: false, code: 'network' });
  });
});

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

  it('says offline when the response carries status 0 with an error object (network shape)', async () => {
    expect(
      await deleteAccount(rpcClient({ error: { message: 'TypeError: Network request failed', code: '' }, status: 0 })),
    ).toEqual({ ok: false, code: 'network', message: "You're offline. Connect to the internet to delete your account." });
  });

  it('tells the user to sign in again when the server returns 401', async () => {
    expect(await deleteAccount(rpcClient({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }))).toEqual({
      ok: false,
      code: 'auth',
      message: 'Sign in again to do this.',
    });
  });
});

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
