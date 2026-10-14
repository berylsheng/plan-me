import { randomUUID } from 'node:crypto';

import { signedInPhone } from '@/test-utils/supabaseTestKit';

import { flushOutbox, type OutboxOp } from '../outbox';
import type { EventRecord } from '../rows';

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

describe('flushOutbox against local Supabase', () => {
  it('creates, edits and soft-deletes in order', async () => {
    const alice = await signedInPhone('outbox');
    const event = record(alice.userId);
    const ops: OutboxOp[] = [
      { opId: '1', kind: 'insert', record: event },
      { opId: '2', kind: 'update', record: { ...event, name: 'Swim lesson', endTime: '08:00' } },
    ];
    expect(await flushOutbox(alice.client, ops)).toEqual({ done: ['1', '2'], stoppedBy: null, rejected: 0 });

    const { data } = await alice.client.from('events').select('title, start_time, end_time, deleted_at').eq('id', event.id).single();
    expect(data).toEqual({ title: 'Swim lesson', start_time: '07:00:00', end_time: '08:00:00', deleted_at: null });

    await flushOutbox(alice.client, [{ opId: '3', kind: 'delete', id: event.id, deletedAt: new Date().toISOString() }]);
    const after = await alice.client.from('events').select('deleted_at').eq('id', event.id).single();
    expect(after.data?.deleted_at).not.toBeNull();
  });

  it('treats a repeated create as already done', async () => {
    const alice = await signedInPhone('outbox');
    const op: OutboxOp = { opId: '1', kind: 'insert', record: record(alice.userId) };
    await flushOutbox(alice.client, [op]);
    expect(await flushOutbox(alice.client, [{ ...op, opId: '2' }])).toEqual({ done: ['2'], stoppedBy: null, rejected: 0 });
    const { count } = await alice.client.from('events').select('id', { count: 'exact', head: true }).eq('id', op.record.id);
    expect(count).toBe(1);
  });

  it('stops without losing anything when offline', async () => {
    const alice = await signedInPhone('outbox');
    alice.setOnline(false);
    const ops: OutboxOp[] = [
      { opId: '1', kind: 'insert', record: record(alice.userId) },
      { opId: '2', kind: 'insert', record: record(alice.userId) },
    ];
    expect(await flushOutbox(alice.client, ops)).toEqual({ done: [], stoppedBy: 'network', rejected: 0, failed: { opId: '1', status: 0 } });
  });

  it('gives up on a change the server refuses and carries on', async () => {
    const alice = await signedInPhone('outbox');
    const bob = await signedInPhone('outbox');
    const forged = record(bob.userId); // Alice can't create Bob's event
    const fine = record(alice.userId);
    const outcome = await flushOutbox(alice.client, [
      { opId: '1', kind: 'insert', record: forged },
      { opId: '2', kind: 'insert', record: fine },
    ]);
    expect(outcome).toEqual({ done: ['1', '2'], stoppedBy: null, rejected: 1 });
  });

  it('finishes an edit of an event it can no longer see without an error', async () => {
    const alice = await signedInPhone('outbox');
    const bob = await signedInPhone('outbox');
    const bobs = record(bob.userId);
    await flushOutbox(bob.client, [{ opId: '1', kind: 'insert', record: bobs }]);
    expect(await flushOutbox(alice.client, [{ opId: '2', kind: 'update', record: { ...bobs, name: 'hacked' } }])).toEqual({
      done: ['2'],
      stoppedBy: null,
      rejected: 0,
    });
    const { data } = await bob.client.from('events').select('title').eq('id', bobs.id).single();
    expect(data?.title).toBe('Swim');
  });
});
