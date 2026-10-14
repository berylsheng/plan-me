import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure } from '@/lib/events/failures';
import { avatarUrls, removeAvatar, uploadAvatar } from '@/lib/profile/avatars';

import { FAMILY_MESSAGES } from './messages';
import type { Family, FamilyResult, FamilySnapshot, Member } from './types';
import { displayNameProblem, familyNameProblem, inviteCodeProblem, normaliseInviteCode, normaliseTag, tagProblem } from './validation';

export { FAMILY_MESSAGES };

type DbError = { code?: string; message?: string } | null;
type Response<T> = { data: T | null; error: DbError; status: number };

const failed = (message: string, offline = false): FamilyResult<never> => ({ ok: false, message, offline });

function fromError(error: DbError, status: number): FamilyResult<never> {
  const kind = classifyFailure(error, status);
  if (kind === 'network') return failed(FAMILY_MESSAGES.offline, true);
  if (kind === 'auth') return failed(FAMILY_MESSAGES.signInAgain);
  // The family functions raise these names as the exception message.
  if (error?.message === 'already_in_family') return failed(FAMILY_MESSAGES.alreadyInFamily);
  if (error?.message === 'not_family_owner') return failed(FAMILY_MESSAGES.notOwner);
  return failed(FAMILY_MESSAGES.unknown);
}

/** Run one request. A thrown error means the request couldn't be sent. */
async function run<T>(call: () => PromiseLike<Response<T>>): Promise<FamilyResult<T | null>> {
  try {
    const { data, error, status } = await call();
    return error ? fromError(error, status) : { ok: true, value: data };
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
}

const done = (result: FamilyResult<unknown>): FamilyResult => (result.ok ? { ok: true, value: undefined } : result);

const PROFILE_COLUMNS = 'id, display_name, tag, avatar_url, family_id, joined_family_at';
type ProfileRow = {
  id: string;
  display_name: string | null;
  tag: string | null;
  avatar_url: string | null;
  family_id: string | null;
  joined_family_at: string | null;
};
type FamilyRow = { id: string; name: string; owner_id: string; invite_code: string };

const toMember = (row: ProfileRow): Member => ({
  id: row.id,
  displayName: row.display_name,
  tag: row.tag,
  joinedAt: row.joined_family_at,
  avatarPath: row.avatar_url,
});
const toFamily = (row: FamilyRow): Family => ({ id: row.id, name: row.name, ownerId: row.owner_id, inviteCode: row.invite_code });

/** The user's profile, family and fellow members (longest-standing first). */
export async function fetchFamily(client: SupabaseClient, userId: string): Promise<FamilyResult<FamilySnapshot>> {
  const mine = await run<ProfileRow>(() => client.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single());
  if (!mine.ok) return mine;
  if (!mine.value) return failed(FAMILY_MESSAGES.unknown);
  const me = toMember(mine.value);
  const familyId = mine.value.family_id;
  if (!familyId) return { ok: true, value: { me, family: null, members: [me] } };

  const [family, people] = await Promise.all([
    run<FamilyRow>(() => client.from('families').select('id, name, owner_id, invite_code').eq('id', familyId).single()),
    run<ProfileRow[]>(() => client.from('profiles').select(PROFILE_COLUMNS).eq('family_id', familyId).order('joined_family_at')),
  ]);
  if (!family.ok) return family;
  if (!people.ok) return people;
  if (!family.value) return failed(FAMILY_MESSAGES.unknown);
  const members = (people.value ?? []).map(toMember);
  return {
    ok: true,
    value: { me, family: toFamily(family.value), members: members.some(m => m.id === me.id) ? members : [me, ...members] },
  };
}

export async function createFamily(client: SupabaseClient, name: string): Promise<FamilyResult> {
  const problem = familyNameProblem(name);
  if (problem) return failed(problem);
  return done(await run(() => client.rpc('create_family', { p_name: name.trim() })));
}

export async function joinFamily(client: SupabaseClient, codeInput: string): Promise<FamilyResult> {
  const code = normaliseInviteCode(codeInput);
  const problem = inviteCodeProblem(code);
  if (problem) return failed(problem);
  const result = await run<string>(() => client.rpc('join_family', { p_code: code }));
  if (!result.ok) return result;
  switch (result.value) {
    case 'joined':
      return { ok: true, value: undefined };
    case 'invalid_code':
      return failed(FAMILY_MESSAGES.codeNotFound);
    case 'rate_limited':
      return failed(FAMILY_MESSAGES.rateLimited);
    case 'already_in_family':
      return failed(FAMILY_MESSAGES.alreadyInFamily);
    default:
      return failed(FAMILY_MESSAGES.unknown);
  }
}

export const leaveFamily = async (client: SupabaseClient): Promise<FamilyResult> =>
  done(await run(() => client.rpc('leave_family')));

export const removeMember = async (client: SupabaseClient, memberId: string): Promise<FamilyResult> =>
  done(await run(() => client.rpc('remove_member', { p_user: memberId })));

export async function regenerateInviteCode(client: SupabaseClient): Promise<FamilyResult<string>> {
  const result = await run<string>(() => client.rpc('regenerate_invite_code'));
  if (!result.ok) return result;
  return result.value ? { ok: true, value: result.value } : failed(FAMILY_MESSAGES.unknown);
}

export type ProfileChanges = { displayName: string; tag: string };

/** Change the user's name and tag. Tags are unique within a family. */
export async function updateProfile(client: SupabaseClient, userId: string, changes: ProfileChanges): Promise<FamilyResult> {
  const tag = normaliseTag(changes.tag);
  const problem = displayNameProblem(changes.displayName) ?? tagProblem(tag);
  if (problem) return failed(problem);
  try {
    const { error, status } = await client
      .from('profiles')
      .update({ display_name: changes.displayName.trim() || null, tag })
      .eq('id', userId);
    if (!error) return { ok: true, value: undefined };
    if (error.code === '23505' && tag) return failed(`Someone in your family already uses @${tag}.`);
    return fromError(error, status);
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
}

export const familyApi = {
  fetchFamily,
  createFamily,
  joinFamily,
  leaveFamily,
  removeMember,
  regenerateInviteCode,
  updateProfile,
  uploadAvatar,
  removeAvatar,
  avatarUrls,
};
export type FamilyApi = typeof familyApi;
