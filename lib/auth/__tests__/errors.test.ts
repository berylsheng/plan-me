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
