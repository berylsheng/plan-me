import { signedInPhone } from '@/test-utils/supabaseTestKit';

import {
  createFamily,
  FAMILY_MESSAGES,
  fetchFamily,
  joinFamily,
  leaveFamily,
  regenerateInviteCode,
  removeMember,
  updateProfile,
} from '../api';
import { formatInviteCode } from '../validation';

async function familyOfTwo() {
  const alice = await signedInPhone('fam');
  const bob = await signedInPhone('fam');
  expect(await createFamily(alice.client, 'Smiths')).toEqual({ ok: true, value: undefined });
  const snapshot = await fetchFamily(alice.client, alice.userId);
  if (!snapshot.ok || !snapshot.value.family) throw new Error('no family');
  // People type codes with a dash and in lower case.
  const typed = formatInviteCode(snapshot.value.family.inviteCode).toLowerCase();
  expect(await joinFamily(bob.client, typed)).toEqual({ ok: true, value: undefined });
  return { alice, bob, code: snapshot.value.family.inviteCode };
}

describe('Family api against local Supabase', () => {
  it('creates a family with you as owner', async () => {
    const alice = await signedInPhone('fam');
    await createFamily(alice.client, '  Smiths ');
    const result = await fetchFamily(alice.client, alice.userId);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.family).toMatchObject({ name: 'Smiths', ownerId: alice.userId });
    expect(result.value.family?.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(result.value.members.map(m => m.id)).toEqual([alice.userId]);
  });

  it('lets a second person join with the code, and both see two members', async () => {
    const { alice, bob } = await familyOfTwo();
    for (const phone of [alice, bob]) {
      const result = await fetchFamily(phone.client, phone.userId);
      if (!result.ok) throw new Error(result.message);
      expect(result.value.members.map(m => m.id)).toEqual([alice.userId, bob.userId]);
    }
  });

  it('explains a wrong code and a second family', async () => {
    const { bob } = await familyOfTwo();
    const carol = await signedInPhone('fam');
    expect(await joinFamily(carol.client, 'ZZZZZZZZ')).toEqual({ ok: false, message: FAMILY_MESSAGES.codeNotFound, offline: false });
    expect(await createFamily(bob.client, 'Other')).toEqual({ ok: false, message: FAMILY_MESSAGES.alreadyInFamily, offline: false });
  });

  it('stops guessing after five wrong codes', async () => {
    const carol = await signedInPhone('fam');
    for (let i = 0; i < 5; i++) await joinFamily(carol.client, 'ZZZZZZZZ');
    expect(await joinFamily(carol.client, 'ZZZZZZZZ')).toEqual({ ok: false, message: FAMILY_MESSAGES.rateLimited, offline: false });
  });

  it('lets only the owner make a new code', async () => {
    const { alice, bob, code } = await familyOfTwo();
    expect(await regenerateInviteCode(bob.client)).toEqual({ ok: false, message: FAMILY_MESSAGES.notOwner, offline: false });
    const fresh = await regenerateInviteCode(alice.client);
    if (!fresh.ok) throw new Error(fresh.message);
    expect(fresh.value).not.toBe(code);
  });

  it('keeps tags unique within the family', async () => {
    const { alice, bob } = await familyOfTwo();
    expect(await updateProfile(alice.client, alice.userId, { displayName: 'Alice', tag: 'al' })).toEqual({ ok: true, value: undefined });
    expect(await updateProfile(bob.client, bob.userId, { displayName: 'Bob', tag: 'AL' })).toEqual({
      ok: false,
      message: 'Someone in your family already uses @AL.',
      offline: false,
    });
  });

  it('lets the owner remove a member, and a member leave', async () => {
    const { alice, bob } = await familyOfTwo();
    expect(await removeMember(alice.client, bob.userId)).toEqual({ ok: true, value: undefined });
    const bobView = await fetchFamily(bob.client, bob.userId);
    expect(bobView.ok && bobView.value.family).toBeNull();

    expect(await leaveFamily(alice.client)).toEqual({ ok: true, value: undefined });
    const aliceView = await fetchFamily(alice.client, alice.userId);
    expect(aliceView.ok && aliceView.value.family).toBeNull();
  });

  it("says offline when the phone can't reach the server", async () => {
    const alice = await signedInPhone('fam');
    alice.setOnline(false);
    expect(await fetchFamily(alice.client, alice.userId)).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
  });
});
