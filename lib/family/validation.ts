// The rules the database also enforces (profiles, families and join_family in supabase/migrations).

const INVITE_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const TAG = /^[A-Z]{2,4}$/;
const MAX_NAME = 50;

const length = (text: string) => Array.from(text).length;

/** What people type or paste: any case, with spaces or a dash. */
export const normaliseInviteCode = (input: string): string => input.toUpperCase().replace(/[\s-]/g, '');

export const formatInviteCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export function inviteCodeProblem(code: string): string | null {
  if (!code) return 'Enter the invite code.';
  if (!INVITE_CODE.test(code)) return 'Invite codes are 8 letters and numbers, like K7QM-2XWP.';
  return null;
}

/** "@az" → "AZ"; blank → no tag. */
export function normaliseTag(input: string): string | null {
  const tag = input.trim().replace(/^@/, '').toUpperCase();
  return tag === '' ? null : tag;
}

export function tagProblem(tag: string | null): string | null {
  return tag !== null && !TAG.test(tag) ? 'A tag is 2 to 4 letters, like AZ.' : null;
}

export function familyNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for your family.';
  if (length(trimmed) > MAX_NAME) return 'Keep the name to 50 characters or fewer.';
  return null;
}

export function displayNameProblem(name: string): string | null {
  return length(name.trim()) > MAX_NAME ? 'Keep your name to 50 characters or fewer.' : null;
}
