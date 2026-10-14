import type { AuthError, SupabaseClient } from '@supabase/supabase-js';

import type { CallbackAction } from './callback';
import { authErrorCode, authErrorMessage, GENERIC_MESSAGE, LINK_PROBLEM_MESSAGE } from './errors';
import { classifyFailure } from '@/lib/events/failures';
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

/** over_email_send_rate_limit is silenced: GoTrue only raises it for real accounts,
 * so surfacing it would reveal whether an address has an account. */
const SILENCED_RESET_FAILURES = new Set(['over_email_send_rate_limit']);

/** Ask for a reset email. Silences over_email_send_rate_limit only. Reports every other failure. */
export async function requestPasswordReset(client: SupabaseClient, email: string, redirectTo: string): Promise<AuthResult> {
  const result = await run(() => client.auth.resetPasswordForEmail(normaliseEmail(email), { redirectTo }));
  return result.ok || !SILENCED_RESET_FAILURES.has(result.code ?? '') ? result : { ok: true };
}

/** Finish an email link: swap its one-time code for a session (PKCE). */
export async function completeAuthRedirect(client: SupabaseClient, action: CallbackAction): Promise<AuthResult> {
  if (action.kind === 'error') return { ok: false, code: action.code, message: action.message };
  if (action.kind === 'none') return { ok: false, code: 'missing_code', message: LINK_PROBLEM_MESSAGE };
  return run(() => client.auth.exchangeCodeForSession(action.code));
}

export const updatePassword = (client: SupabaseClient, password: string) => run(() => client.auth.updateUser({ password }));

/** Sign out on this phone only; other family devices stay signed in.
 * A network failure is treated as success when auth-js already cleared the local session. */
export async function signOut(client: SupabaseClient): Promise<AuthResult> {
  const result = await run(() => client.auth.signOut({ scope: 'local' }));
  if (!result.ok && result.code === 'network') {
    // Offline, auth-js still clears a valid session locally, so the sign-out did happen.
    // An expired one it can't refresh stays stored: getSession then reports an error.
    try {
      const { data, error } = await client.auth.getSession();
      if (!data.session && !error) return { ok: true };
    } catch {
      // Can't tell; report the original failure.
    }
  }
  return result;
}

export const DELETE_OFFLINE = "You're offline. Connect to the internet to delete your account.";
export const DELETE_AUTH = 'Sign in again to do this.';

/** Delete the account on the server (Plan 2's delete_account): personal events go, shared events stay
 * with the family as "Former member", and the server session ends. */
export async function deleteAccount(client: SupabaseClient): Promise<AuthResult> {
  try {
    const { error, status } = await client.rpc('delete_account');
    if (!error) return { ok: true };
    if (!status) return { ok: false, code: 'network', message: DELETE_OFFLINE };
    if (status === 401 || classifyFailure(error, status) === 'auth') return { ok: false, code: 'auth', message: DELETE_AUTH };
    return { ok: false, code: error.code, message: GENERIC_MESSAGE };
  } catch {
    return { ok: false, code: 'network', message: DELETE_OFFLINE };
  }
}

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
