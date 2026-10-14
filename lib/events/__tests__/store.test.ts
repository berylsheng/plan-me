import { memoryStorage } from '@/test-utils/memoryStorage';

import type { OutboxOp } from '../outbox';
import type { EventRecord } from '../rows';
import { clearUserData, loadUserData, saveUserData, userKeys } from '../store';

const record = (id: string): EventRecord => ({
  id,
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '',
  endTime: '',
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
});
const A = '00000000-0000-4000-8000-00000000000a';
const op: OutboxOp = { opId: '1', kind: 'insert', record: record(A) };

describe('user data on the phone', () => {
  it('round-trips records, outbox and sync time under per-user keys', async () => {
    const storage = memoryStorage();
    const data = { records: { [A]: record(A) }, outbox: [op], lastFullSync: '2026-10-09T00:00:00.000Z' };
    await saveUserData(storage, 'user-1', data);
    expect(Object.keys(storage.dump()).sort()).toEqual(['planme:events:user-1', 'planme:outbox:user-1', 'planme:sync:user-1']);
    expect(await loadUserData(storage, 'user-1')).toEqual(data);
  });

  it('keeps each user separate', async () => {
    const storage = memoryStorage();
    await saveUserData(storage, 'user-1', { records: { [A]: record(A) }, outbox: [], lastFullSync: null });
    expect(await loadUserData(storage, 'user-2')).toEqual({ records: {}, outbox: [], lastFullSync: null });
  });

  it("skips damaged entries instead of losing everything", async () => {
    const keys = userKeys('user-1');
    const storage = memoryStorage({
      [keys.records]: JSON.stringify({ [A]: record(A), b: { id: 'b', dateKey: 'garbage' } }),
      [keys.outbox]: JSON.stringify([op, { kind: 'wipe' }]),
      [keys.sync]: '{not json',
    });
    expect(await loadUserData(storage, 'user-1')).toEqual({ records: { [A]: record(A) }, outbox: [op], lastFullSync: null });
  });

  it('writes outbox before records (sequential, not parallel)', async () => {
    // RED proof: under Promise.all the fast records write would finish first; sequential ordering
    // means outbox always completes before records starts.
    const uid = 'user-1';
    const keys = userKeys(uid);
    const completedOrder: string[] = [];

    const storage: Parameters<typeof saveUserData>[0] = {
      getItem: () => Promise.resolve(null),
      setItem: async (k, _v) => {
        if (k === keys.outbox) {
          // Slow write: resolves after one tick — under Promise.all, records would finish first
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        completedOrder.push(k);
      },
      removeItem: () => Promise.resolve(),
    };

    await saveUserData(storage, uid, { records: { [A]: record(A) }, outbox: [op], lastFullSync: null });

    // Sequential guarantee: outbox write must complete before records write starts
    expect(completedOrder[0]).toBe(keys.outbox);
    expect(completedOrder[1]).toBe(keys.records);
  });

  it('clears one user', async () => {
    const storage = memoryStorage();
    await saveUserData(storage, 'user-1', { records: { [A]: record(A) }, outbox: [op], lastFullSync: null });
    await saveUserData(storage, 'user-2', { records: { [A]: record(A) }, outbox: [], lastFullSync: null });
    await clearUserData(storage, 'user-1');
    expect(Object.keys(storage.dump()).sort()).toEqual(['planme:events:user-2', 'planme:outbox:user-2', 'planme:sync:user-2']);
  });
});
