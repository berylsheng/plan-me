import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { flushOutbox, type OutboxOp } from '../outbox';
import type { EventRecord } from '../rows';

type FakeResponse = { error: { code?: string } | null; status: number };

const ok = (status = 201): FakeResponse => ({ error: null, status });

function makeClient(responses: FakeResponse[]): SupabaseClient {
  let i = 0;
  const next = (): Promise<FakeResponse> => Promise.resolve(responses[i++]!);
  return {
    from: () => ({
      insert: () => next(),
      update: () => ({ eq: () => next() }),
    }),
  } as unknown as SupabaseClient;
}

const record = (): EventRecord => ({
  id: randomUUID(),
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '',
  endTime: '',
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
});

const insertOp = (opId: string): OutboxOp => ({ opId, kind: 'insert', record: record() });
const updateOp = (opId: string): OutboxOp => ({ opId, kind: 'update', record: record() });

describe('flushOutbox', () => {
  it('stops at a network failure part-way through, never sending later ops', async () => {
    const ops = [insertOp('1'), insertOp('2'), insertOp('3')];
    const result = await flushOutbox(
      makeClient([ok(201), { error: { code: '' }, status: 0 }, ok(201)]),
      ops,
    );
    expect(result).toEqual({ done: ['1'], stoppedBy: 'network', rejected: 0, failed: { opId: '2', status: 0 } });
  });

  it('stops on an auth failure', async () => {
    const result = await flushOutbox(
      makeClient([{ error: { code: 'PGRST301' }, status: 401 }]),
      [insertOp('1')],
    );
    expect(result).toEqual({ done: [], stoppedBy: 'auth', rejected: 0, failed: { opId: '1', status: 401 } });
  });

  it('counts a 23505 on an update as rejected and carries on (op is in done)', async () => {
    const result = await flushOutbox(
      makeClient([{ error: { code: '23505' }, status: 409 }]),
      [updateOp('1')],
    );
    expect(result).toEqual({ done: ['1'], stoppedBy: null, rejected: 1 });
  });

  it('counts a 23505 on an insert as done (not rejected)', async () => {
    const result = await flushOutbox(
      makeClient([{ error: { code: '23505' }, status: 409 }]),
      [insertOp('1')],
    );
    expect(result).toEqual({ done: ['1'], stoppedBy: null, rejected: 0 });
  });

  it('shouldContinue returning false after the first op: only op1 in done, op2 never sent, interrupted: true', async () => {
    let calls = 0;
    const ops = [insertOp('op1'), insertOp('op2')];
    const result = await flushOutbox(
      makeClient([ok(201), ok(201)]),
      ops,
      () => calls++ === 0, // true first call, false second
    );
    expect(result).toEqual({ done: ['op1'], stoppedBy: null, rejected: 0, interrupted: true });
  });

  it('says which change failed and how', async () => {
    const client = makeClient([{ error: { code: '' }, status: 503 }]);
    expect(await flushOutbox(client, [insertOp('op1')])).toEqual({
      done: [],
      stoppedBy: 'network',
      rejected: 0,
      failed: { opId: 'op1', status: 503 },
    });
  });
});
