import { randomUUID } from 'node:crypto';

import { adminClient, signedInPhone } from '@/test-utils/supabaseTestKit';

import { deleteAccount } from '../api';

describe('Deleting an account against local Supabase', () => {
  it('deletes the user and their personal events, and keeps shared ones', async () => {
    const alice = await signedInPhone('delete');
    const bob = await signedInPhone('delete');
    await alice.client.rpc('create_family', { p_name: 'Bye' });
    const { data: fam } = await alice.client.from('families').select('invite_code').single();
    await bob.client.rpc('join_family', { p_code: fam?.invite_code });

    const personal = randomUUID();
    const shared = randomUUID();
    await alice.client.from('events').insert([
      { id: personal, owner_id: alice.userId, visibility: 'personal', title: 'Mine', date: '2026-11-03' },
      { id: shared, owner_id: alice.userId, visibility: 'shared', title: 'Ours', date: '2026-11-03' },
    ]);

    expect(await deleteAccount(alice.client)).toEqual({ ok: true });

    const { data: user } = await adminClient.auth.admin.getUserById(alice.userId);
    expect(user.user).toBeNull();
    const { data: rows } = await adminClient.from('events').select('id, owner_id').in('id', [personal, shared]);
    expect(rows).toEqual([{ id: shared, owner_id: null }]);
  });
});
