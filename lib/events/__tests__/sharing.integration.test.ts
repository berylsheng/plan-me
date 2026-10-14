import { randomUUID } from 'node:crypto';

import { memoryStorage } from '@/test-utils/memoryStorage';
import { signedInPhone, type TestPhone } from '@/test-utils/supabaseTestKit';

import type { EventRecord } from '../rows';
import { SyncEngine, type SyncStatus } from '../syncEngine';

type Phone = TestPhone & { userId: string };
const engines: SyncEngine[] = [];

function startEngine(phone: Phone) {
  let latest: { records: Record<string, EventRecord>; status: SyncStatus | null } = { records: {}, status: null };
  const engine = new SyncEngine({
    client: phone.client,
    userId: phone.userId,
    storage: memoryStorage(),
    canSync: true,
    realtime: false,
    onChange: (records, status) => {
      latest = { records, status };
    },
  });
  engines.push(engine);
  return { engine, latest: () => latest };
}

const record = (ownerId: string, overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: randomUUID(),
  dateKey: '2026-11-03',
  name: 'Family dinner',
  startTime: '18:00',
  endTime: '',
  ownerId,
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
  ...overrides,
});

async function family(alice: Phone, bob: Phone) {
  await alice.client.rpc('create_family', { p_name: 'Test family' });
  const { data } = await alice.client.from('families').select('invite_code').single();
  await bob.client.rpc('join_family', { p_code: data?.invite_code });
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

describe('Sharing events with the family', () => {
  it('shows a shared event to the family, and hides it again when the creator makes it personal', async () => {
    const alice = await signedInPhone('share');
    const bob = await signedInPhone('share');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();

    const dinner = record(alice.userId);
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toBeUndefined();

    await a.engine.update({ ...dinner, visibility: 'shared' });
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toMatchObject({ visibility: 'shared', ownerId: alice.userId });

    await a.engine.update({ ...dinner, visibility: 'personal' });
    await a.engine.sync();
    await b.engine.sync(true);
    expect(b.latest().records[dinner.id]).toBeUndefined();
  });

  it('lets a member edit a shared event but not make it personal', async () => {
    const alice = await signedInPhone('share');
    const bob = await signedInPhone('share');
    await family(alice, bob);
    const a = startEngine(alice);
    const b = startEngine(bob);
    await a.engine.start();
    await b.engine.start();

    const dinner = record(alice.userId, { visibility: 'shared', memberIds: [bob.userId] });
    await a.engine.create([dinner]);
    await a.engine.sync();
    await b.engine.sync(true);

    await b.engine.update({ ...b.latest().records[dinner.id], name: "Dinner at Nan's" });
    await b.engine.sync();
    await a.engine.sync(true);
    expect(a.latest().records[dinner.id]).toMatchObject({ name: "Dinner at Nan's", memberIds: [bob.userId] });

    await b.engine.update({ ...b.latest().records[dinner.id], visibility: 'personal' });
    await b.engine.sync();
    expect(b.latest().status?.refused).toBe(1);
    // The re-fetch after the refusal put the server's version back.
    expect(b.latest().records[dinner.id]?.visibility).toBe('shared');
  });

  it('refuses a shared event from someone not in a family', async () => {
    const carol = await signedInPhone('share');
    const c = startEngine(carol);
    await c.engine.start();
    const lonely = record(carol.userId, { visibility: 'shared' });
    await c.engine.create([lonely]);
    await c.engine.sync();
    expect(c.latest().status?.refused).toBe(1);
    expect(c.latest().records[lonely.id]).toBeUndefined();
  });
});
