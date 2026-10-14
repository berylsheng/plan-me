import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signedInPhone } from '@/test-utils/supabaseTestKit';

import { fetchVisibleEvents } from '../pull';

async function insertEvent(client: SupabaseClient, ownerId: string, title: string, visibility: 'personal' | 'shared' = 'personal') {
  const id = randomUUID();
  const { error } = await client.from('events').insert({ id, owner_id: ownerId, visibility, title, date: '2026-11-03' });
  if (error) throw new Error(error.message);
  return id;
}

async function familyOf(alice: Awaited<ReturnType<typeof signedInPhone>>, bob: Awaited<ReturnType<typeof signedInPhone>>) {
  const { error } = await alice.client.rpc('create_family', { p_name: 'Test family' });
  if (error) throw new Error(error.message);
  const { data } = await alice.client.from('families').select('invite_code').single();
  const joined = await bob.client.rpc('join_family', { p_code: data?.invite_code });
  expect(joined.data).toBe('joined');
}

describe('fetchVisibleEvents against local Supabase', () => {
  it("returns your events and your family's shared ones, not their personal ones or deleted ones", async () => {
    const alice = await signedInPhone('pull');
    const bob = await signedInPhone('pull');
    await familyOf(alice, bob);
    const personal = await insertEvent(alice.client, alice.userId, 'Alice only');
    const shared = await insertEvent(alice.client, alice.userId, 'Family dinner', 'shared');
    const deleted = await insertEvent(bob.client, bob.userId, 'Cancelled');
    await bob.client.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', deleted);
    const bobs = await insertEvent(bob.client, bob.userId, 'Bob only');

    const result = await fetchVisibleEvents(bob.client);
    if (!result.ok) throw new Error(result.reason);
    const ids = result.rows.map(r => r.id);
    expect(ids).toEqual(expect.arrayContaining([shared, bobs]));
    expect(ids).not.toContain(personal);
    expect(ids).not.toContain(deleted);
  });

  it('reads every page', async () => {
    const alice = await signedInPhone('pull');
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await insertEvent(alice.client, alice.userId, `E${i}`));
    const result = await fetchVisibleEvents(alice.client, 2);
    expect(result.ok && result.rows.map(r => r.id).sort()).toEqual(ids.sort());
  });

  it('reports being offline', async () => {
    const alice = await signedInPhone('pull');
    alice.setOnline(false);
    expect(await fetchVisibleEvents(alice.client)).toEqual({ ok: false, reason: 'network' });
  });
});
