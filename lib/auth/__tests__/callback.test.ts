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
