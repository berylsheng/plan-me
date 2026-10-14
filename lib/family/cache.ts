import type { KeyValueStorage } from '@/lib/events/store';

import type { Family, FamilySnapshot, Member } from './types';

/** Where one user's family details live on the phone. */
export const familyKeys = (userId: string) => ({
  family: `planme:family:${userId}`,
  tagAnswers: `planme:tagMap:${userId}`,
});

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

function isMember(v: unknown): v is Member {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    isNullableString(m.displayName) &&
    isNullableString(m.tag) &&
    isNullableString(m.joinedAt) &&
    (m.avatarPath === undefined || isNullableString(m.avatarPath))
  );
}

function isFamily(v: unknown): v is Family {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return typeof f.id === 'string' && typeof f.name === 'string' && typeof f.ownerId === 'string' && typeof f.inviteCode === 'string';
}

function isFamilySnapshot(v: unknown): v is FamilySnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return isMember(s.me) && (s.family === null || isFamily(s.family)) && Array.isArray(s.members) && s.members.every(isMember);
}

/** The family as last fetched for this user, for an offline start. Damaged data counts as none. */
export async function readFamilyCache(storage: KeyValueStorage, userId: string): Promise<FamilySnapshot | null> {
  try {
    const raw = await storage.getItem(familyKeys(userId).family);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFamilySnapshot(parsed) && parsed.me.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeFamilyCache(storage: KeyValueStorage, userId: string, snapshot: FamilySnapshot): Promise<void> {
  await storage.setItem(familyKeys(userId).family, JSON.stringify(snapshot));
}

/** Forget this user's family details and tag answers. Only for a user-initiated sign-out. */
export async function clearFamilyData(storage: KeyValueStorage, userId: string): Promise<void> {
  const keys = familyKeys(userId);
  await Promise.all([storage.removeItem(keys.family), storage.removeItem(keys.tagAnswers)]);
}
