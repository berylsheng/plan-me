import { randomUUID } from 'node:crypto';

import { memoryStorage } from '@/test-utils/memoryStorage';
import { signedInPhone, type TestPhone } from '@/test-utils/supabaseTestKit';

import type { EventRecord } from '../rows';
import { SyncEngine, type SyncStatus } from '../syncEngine';

type Phone = TestPhone & { userId: string };
const engines: SyncEngine[] = [];
const phones: Phone[] = [];

/** Wraps signedInPhone to register the phone for afterEach channel cleanup. */
async function phone(tag: string): Promise<Phone> {
  const p = await signedInPhone(tag);
  phones.push(p);
  return p;
}

function startEngine(phone: Phone, storage = memoryStorage(), options: { realtime?: boolean; canSync?: boolean } = {}) {
  let latest: { records: Record<string, EventRecord>; status: SyncStatus | null } = { records: {}, status: null };
  const engine = new SyncEngine({
    client: phone.client,
    userId: phone.userId,
    storage,
    canSync: options.canSync ?? true,
    realtime: options.realtime ?? false,
    onChange: (records, status) => {
      latest = { records, status };
    },
  });
  engines.push(engine);
  return { engine, storage, latest: () => latest };
}

const record = (ownerId: string, overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: randomUUID(),
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '07:00',
  endTime: '',
  ownerId,
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
  ...overrides,
});

async function until(check: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function serverCount(phone: Phone, id: string, includeDeleted = false) {
  let query = phone.client.from('events').select('id', { count: 'exact', head: true }).eq('id', id);
  if (!includeDeleted) query = query.is('deleted_at', null);
  const { count } = await query;
  return count;
}

async function family(alice: Phone, bob: Phone) {
  await alice.client.rpc('create_family', { p_name: 'Test family' });
  const { data } = await alice.client.from('families').select('invite_code').single();
  await bob.client.rpc('join_family', { p_code: data?.invite_code });
}

afterEach(async () => {
  for (const engine of engines.splice(0)) engine.stop();
  for (const p of phones.splice(0)) {
    // Only close Realtime on phones that used it: on a client that never connected,
    // removeAllChannels() / disconnect() leave work behind that keeps Jest from exiting.
    if (!p.client.realtime.isConnected() && p.client.realtime.getChannels().length === 0) continue;
    await p.client.removeAllChannels();
    await p.client.realtime.disconnect();
  }
});

describe('SyncEngine against local Supabase', () => {
  it('saves a new event to the server', async () => {
    const alice = await phone('engine');
    const { engine, latest } = startEngine(alice);
    await engine.start();
    const swim = record(alice.userId);
    await engine.create([swim]);
    await engine.sync();
    expect(await serverCount(alice, swim.id)).toBe(1);
    expect(latest().status?.pending).toBe(0);
  });

  it('keeps offline changes across a restart and sends them once back online', async () => {
    const alice = await phone('engine');
    alice.setOnline(false);
    const first = startEngine(alice);
    await first.engine.start();
    const swim = record(alice.userId);
    await first.engine.create([swim]);
    await first.engine.sync();
    expect(first.latest().status?.state).toBe('offline');
    first.engine.stop();

    const second = startEngine(alice, first.storage);
    await second.engine.start();
    expect(Object.keys(second.latest().records)).toEqual([swim.id]); // there before the network
    alice.setOnline(true);
    await second.engine.sync(true);
    expect(await serverCount(alice, swim.id)).toBe(1);
    expect(second.latest().status?.pending).toBe(0);
  });

  it('never sends an event created and deleted before it could sync', async () => {
    const alice = await phone('engine');
    const { engine } = startEngine(alice, memoryStorage(), { canSync: false });
    await engine.start();
    const swim = record(alice.userId);
    await engine.create([swim]);
    await engine.update({ ...swim, name: 'Swim lesson' });
    await engine.remove([swim.id]);
    expect(engine.pending).toBe(0);
    engine.setCanSync(true);
    await engine.sync(true);
    expect(await serverCount(alice, swim.id, true)).toBe(0);
  });

  it("shows a family member's shared event live", async () => {
    const alice = await phone('engine');
    const bob = await phone('engine');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob, memoryStorage(), { realtime: true });
    await a.engine.start();
    await b.engine.start();
    await until(() => b.latest().status?.state === 'idle');
    const dinner = record(alice.userId, { visibility: 'shared', name: 'Family dinner' });
    await a.engine.create([dinner]);
    await a.engine.sync();
    await until(() => dinner.id in b.latest().records);
    expect(b.latest().records[dinner.id].name).toBe('Family dinner');
  });

  it('removes an event the creator makes personal again', async () => {
    const alice = await phone('engine');
    const bob = await phone('engine');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();
    const dinner = record(alice.userId, { visibility: 'shared' });
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);
    expect(dinner.id in b.latest().records).toBe(true);

    await alice.client.from('events').update({ visibility: 'personal' }).eq('id', dinner.id);
    await b.engine.sync(true);
    expect(dinner.id in b.latest().records).toBe(false);
  });

  it('keeps the repeat rule of a recurring event through the server', async () => {
    const alice = await phone('engine');
    const rule = { every: 1, unit: 'week' as const, until: '2026-11-24' };
    const first = startEngine(alice);
    await first.engine.start();
    const swim = record(alice.userId, { occurrenceId: randomUUID(), repeat: rule });
    await first.engine.create([swim]);
    await first.engine.sync();

    const second = startEngine(alice);
    await second.engine.start();
    await second.engine.sync(true);
    expect(second.latest().records[swim.id].repeat).toEqual(rule);
  });

  it("drops a change it can never send, and doesn't retry it", async () => {
    const alice = await phone('engine');
    const bob = await phone('engine');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();
    const dinner = record(alice.userId, { visibility: 'shared' });
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);

    bob.setOnline(false);
    await b.engine.update({ ...b.latest().records[dinner.id], name: 'Bob was here' });
    await alice.client.rpc('remove_member', { p_user: bob.userId });
    bob.setOnline(true);
    await b.engine.sync(true);

    expect(b.engine.pending).toBe(0);
    expect(dinner.id in b.latest().records).toBe(false);
    const { data } = await alice.client.from('events').select('title').eq('id', dinner.id).single();
    expect(data?.title).toBe('Swim');
  });
});
