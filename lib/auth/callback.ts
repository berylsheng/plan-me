import { messageForCode } from './errors';

export type CallbackParams = Record<string, string | string[] | undefined>;

export type CallbackAction =
  | { kind: 'exchange'; code: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'none' };

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * What to do with the query params of an email link (sign-up confirmation or password
 * reset). `error_description` is ignored on purpose: anyone can put text in a link.
 */
export function parseAuthCallback(params: CallbackParams): CallbackAction {
  const errorCode = first(params.error_code) ?? first(params.error);
  if (errorCode) return { kind: 'error', code: errorCode, message: messageForCode(errorCode) };
  const code = first(params.code)?.trim();
  return code ? { kind: 'exchange', code } : { kind: 'none' };
}
