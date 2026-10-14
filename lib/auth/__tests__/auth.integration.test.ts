import {
  callbackParams,
  confirmedAccount,
  CONFIRM_REDIRECT,
  emailLink,
  newPhone,
  openLink,
  PASSWORD,
  RESET_REDIRECT,
  uniqueEmail,
} from '@/test-utils/supabaseTestKit';

import { completeAuthRedirect, requestPasswordReset, signIn, signOut, signUp, updatePassword } from '../api';
import { parseAuthCallback } from '../callback';

describe('auth against local Supabase', () => {
  it('signs up, requires the emailed confirmation, and the link signs you in with the display name stored', async () => {
    const email = uniqueEmail('signup');
    const phone = newPhone().client;

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
    expect(await signIn(newPhone().client, { email: `  ${email.toUpperCase()} `, password: PASSWORD })).toEqual({ ok: true });
  });

  it('rejects a wrong password with the app message', async () => {
    const email = await confirmedAccount();
    expect(await signIn(newPhone().client, { email, password: 'wrong2026' })).toEqual({
      ok: false,
      code: 'invalid_credentials',
      message: 'Email or password is incorrect.',
    });
  });

  it('enforces the password rule on the server too', async () => {
    const result = await signUp(newPhone().client, { email: uniqueEmail('weak'), password: 'familyplanner', displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, code: 'weak_password' });
  });

  it('tells someone signing up with a confirmed account to sign in instead', async () => {
    const email = await confirmedAccount();
    const result = await signUp(newPhone().client, { email, password: PASSWORD, displayName: '' }, CONFIRM_REDIRECT);
    expect(result).toMatchObject({ ok: false, message: 'An account with this email already exists. Sign in instead.' });
  });

  it('resets a forgotten password with the emailed link', async () => {
    const email = await confirmedAccount();
    const phone = newPhone().client;

    expect(await requestPasswordReset(phone, email, RESET_REDIRECT)).toEqual({ ok: true });
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    expect(`${appUrl.protocol}//${appUrl.host}`).toBe('planme://reset-password');
    expect(await completeAuthRedirect(phone, parseAuthCallback(callbackParams(appUrl)))).toEqual({ ok: true });
    expect(await updatePassword(phone, 'newfamily2027')).toEqual({ ok: true });
    expect(await signOut(phone)).toEqual({ ok: true });

    expect(await signIn(newPhone().client, { email, password: PASSWORD })).toMatchObject({ ok: false, code: 'invalid_credentials' });
    expect(await signIn(newPhone().client, { email, password: 'newfamily2027' })).toEqual({ ok: true });
  });

  it('answers a reset request for an unknown email the same way', async () => {
    expect(await requestPasswordReset(newPhone().client, uniqueEmail('nobody'), RESET_REDIRECT)).toEqual({ ok: true });
  });

  it('answers repeated reset requests the same way for real and unknown emails', async () => {
    const email = await confirmedAccount();
    // Real account: three back-to-back calls on the same client so the per-email window never resets.
    // (1) First request succeeds normally.
    const phone = newPhone().client;
    expect(await requestPasswordReset(phone, email, RESET_REDIRECT)).toEqual({ ok: true });
    // (2) Raw call pins the premise: GoTrue really did rate-limit this address.
    const { error: rawError } = await phone.auth.resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT });
    expect(rawError?.code).toBe('over_email_send_rate_limit');
    // (3) Our wrapper silences the per-email limit, so callers still get ok:true.
    expect(await requestPasswordReset(phone, email, RESET_REDIRECT)).toEqual({ ok: true });
    // Unknown emails: no rate-limit error, both calls return ok:true.
    const unknownPhone = newPhone().client;
    expect(await requestPasswordReset(unknownPhone, uniqueEmail('nobody'), RESET_REDIRECT)).toEqual({ ok: true });
    expect(await requestPasswordReset(unknownPhone, uniqueEmail('nobody2'), RESET_REDIRECT)).toEqual({ ok: true });
  });

  it('explains a reset link opened on a different phone', async () => {
    const email = await confirmedAccount();
    await requestPasswordReset(newPhone().client, email, RESET_REDIRECT);
    const appUrl = await openLink(await emailLink(email, 'recovery'));
    const result = await completeAuthRedirect(newPhone().client, parseAuthCallback(callbackParams(appUrl)));
    expect(result).toMatchObject({
      ok: false,
      code: 'bad_code_verifier',
      message: 'This link has expired or was opened on a different device. Request a new one on this phone.',
    });
  });
});
