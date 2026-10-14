import type { FamilyValue } from '@/context/FamilyProvider';
import type { Member } from '@/lib/family/types';

export const FAKE_ME: Member = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: '2026-10-01T00:00:00Z' };
export const FAKE_BOB: Member = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: '2026-10-02T00:00:00Z' };

/** A family of Alice (owner, the signed-in user) and Bob. Every action is a jest.fn that succeeds. */
export function fakeFamilyValue(overrides: Partial<FamilyValue> = {}): FamilyValue {
  const members = overrides.members ?? [FAKE_ME, FAKE_BOB];
  const ok = async () => ({ ok: true as const, value: undefined });
  return {
    me: FAKE_ME,
    family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_ME.id, inviteCode: 'K7QM2XWP' },
    members,
    isOwner: true,
    loading: false,
    offline: false,
    memberById: new Map(members.map(m => [m.id, m])),
    memberByTag: new Map(members.flatMap(m => (m.tag ? [[m.tag, m] as const] : []))),
    refresh: jest.fn(async () => {}),
    createFamily: jest.fn(ok),
    joinFamily: jest.fn(ok),
    leaveFamily: jest.fn(ok),
    removeMember: jest.fn(ok),
    regenerateInviteCode: jest.fn(async () => ({ ok: true as const, value: 'P3RT8VWX' })),
    updateProfile: jest.fn(ok),
    avatarUrl: () => null,
    setAvatar: jest.fn(ok),
    removeAvatar: jest.fn(ok),
    ...overrides,
  };
}
