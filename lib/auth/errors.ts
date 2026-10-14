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
  email_address_not_authorized:
    "This email address can't receive Plan-Me emails yet. Ask the app owner to finish the email setup.",
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
