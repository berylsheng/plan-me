import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { KeyValueStorage } from '@/lib/events/store';
import { memoryStorage } from '@/test-utils/memoryStorage';

import type { OutboxOp } from '../outbox';
import type { EventRecord } from '../rows';
import { loadUserData, saveUserData } from '../store';
import { SyncEngine, type SyncStatus } from '../syncEngine';

type FakeResponse = { error: { code?: string } | null; status: number };
const ok = (): FakeResponse => ({ error: null, status: 201 });

/** A fake client that uses a synchronous response factory for every send. */
function staticClient(factory: () => FakeResponse): SupabaseClient {
  const callFactory = () => Promise.resolve(factory());
  return {
    from: () => ({
      insert: callFactory,
      update: () => ({ eq: callFactory }),
    }),
  } as unknown as SupabaseClient;
}

/** A fake client whose insert() uses an async factory (for timing control). */
function asyncInsertClient(factory: () => Promise<FakeResponse>): SupabaseClient {
  return {
    from: () => ({
      insert: factory,
      update: () => ({ eq: () => Promise.resolve(ok()) }),
    }),
  } as unknown as SupabaseClient;
}

const rec = (ownerId: string): EventRecord => ({
  id: randomUUID(),
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '07:00',
  endTime: '',
  ownerId,
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
});

const engines: SyncEngine[] = [];

afterEach(() => {
  for (const e of engines.splice(0)) e.stop();
});

describe('SyncEngine unit tests', () => {
  it('stop() while the first send is pending: second op never sent, stored outbox unchanged', async () => {
    const uid = 'user-stop';
    const storage = memoryStorage();

    const swim1 = rec(uid);
    const swim2 = rec(uid);
    const op1: OutboxOp = { opId: 'op1', kind: 'insert', record: swim1, attempted: true };
    const op2: OutboxOp = { opId: 'op2', kind: 'insert', record: swim2, attempted: true };
    await saveUserData(storage, uid, {
      records: { [swim1.id]: swim1, [swim2.id]: swim2 },
      outbox: [op1, op2],
      // Recent sync time so no fetch is needed after flushing
      lastFullSync: new Date().toISOString(),
    });

    let sendCount = 0;
    let signalSendStarted!: () => void;
    const sendStarted = new Promise<void>(res => {
      signalSendStarted = res;
    });
    let releaseSend!: () => void;
    const sendRelease = new Promise<void>(res => {
      releaseSend = res;
    });

    const client = asyncInsertClient(async () => {
      sendCount++;
      signalSendStarted();
      await sendRelease;
      return ok();
    });

    const engine = new SyncEngine({
      client,
      userId: uid,
      storage,
      canSync: false, // suppress sync on start
      realtime: false,
      onChange: () => {},
    });
    engines.push(engine);

    await engine.start(); // canSync=false → offline immediately, no sends

    // Enable sync in background; do not await so we can stop mid-flight
    engine.setCanSync(true);
    const syncP = engine.sync(); // returns the already-running promise

    await sendStarted; // first send has begun

    engine.stop();
    releaseSend(); // let first send complete

    await syncP;

    expect(sendCount).toBe(1); // second op never sent
    const saved = await storage.getItem(`planme:outbox:${uid}`);
    const savedOps: OutboxOp[] = JSON.parse(saved ?? '[]');
    expect(savedOps).toHaveLength(2); // both ops still stored
  });

  it('storage getItem rejects: create shows record via onChange, status offline, setItem never called', async () => {
    const uid = 'user-fail-load';
    const setItemCalls: string[] = [];
    const storage: KeyValueStorage = {
      getItem: () => Promise.reject(new Error('storage unavailable')),
      setItem: key => {
        setItemCalls.push(key);
        return Promise.resolve();
      },
      removeItem: () => Promise.resolve(),
    };

    let latestRecords: Record<string, EventRecord> = {};
    let latestStatus: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };

    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: uid,
      storage,
      canSync: true,
      realtime: false,
      onChange: (r, s) => {
        latestRecords = r;
        latestStatus = s;
      },
    });
    engines.push(engine);

    await engine.start();

    const swim = rec(uid);
    await engine.create([swim]);

    expect(latestRecords[swim.id]).toBeDefined(); // shown on screen
    expect(latestStatus.state).toBe('offline'); // engine is offline (loadFailed)
    expect(setItemCalls).toHaveLength(0); // nothing persisted while loadFailed
  });

  it('stop() clears the retry timer: no send after advancing time', async () => {
    // RED: proves stop() cancels the scheduled retry (app-bug fix — a stopped engine must not fire)
    jest.useFakeTimers();
    try {
      const uid = 'user-stop-timer';
      let sendCount = 0;

      let resolveOffline!: () => void;
      const offlineP = new Promise<void>(res => { resolveOffline = res; });
      // Only resolve after 'syncing' has been seen — guards against the initial canSync=false
      // offline state that the engine emits before setCanSync(true) triggers the real flush.
      let seenSyncing = false;

      const client = {
        from: () => ({
          insert: () => {
            sendCount++;
            throw new Error('network crash');
          },
          update: () => ({ eq: () => Promise.resolve(ok()) }),
        }),
      } as unknown as SupabaseClient;

      const storage = memoryStorage();
      // Recent sync so no full-fetch is attempted on retry
      await saveUserData(storage, uid, { records: {}, outbox: [], lastFullSync: new Date().toISOString() });

      const engine = new SyncEngine({
        client,
        userId: uid,
        storage,
        canSync: false,
        realtime: false,
        onChange: (_, s) => {
          if (s.state === 'syncing') seenSyncing = true;
          if (s.state === 'offline' && seenSyncing) resolveOffline();
        },
      });
      engines.push(engine);
      await engine.start();

      const swim = rec(uid);
      await engine.create([swim]);

      engine.setCanSync(true); // starts sync in background; insert will throw
      await offlineP; // wait until runSync fails and state reaches 'offline'

      expect(jest.getTimerCount()).toBeGreaterThan(0); // retry timer is pending

      engine.stop();

      expect(jest.getTimerCount()).toBe(0); // stop() must clear the timer

      // Advance well past the retry interval: a stopped engine must send nothing more
      jest.advanceTimersByTime(10_000);
      expect(sendCount).toBe(1); // only the initial throw, never a retry
    } finally {
      jest.useRealTimers();
    }
  });

  it('client insert throws: status offline, retry timer fires and resends the op', async () => {
    jest.useFakeTimers();
    try {
      const uid = 'user-throw-retry';
      let sendCount = 0;

      let resolveOffline!: () => void;
      const offlineP = new Promise<void>(res => { resolveOffline = res; });
      // Only resolve after 'syncing' has been seen — guards against the initial canSync=false
      // offline state that the engine emits before setCanSync(true) triggers the real flush.
      let seenSyncing = false;

      const client = {
        from: () => ({
          insert: () => {
            sendCount++;
            if (sendCount === 1) throw new Error('network crash');
            return Promise.resolve(ok());
          },
          update: () => ({ eq: () => Promise.resolve(ok()) }),
        }),
      } as unknown as SupabaseClient;

      const storage = memoryStorage();
      // Recent sync so no full-fetch is attempted after the retry insert
      await saveUserData(storage, uid, { records: {}, outbox: [], lastFullSync: new Date().toISOString() });

      let latestStatus: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };
      const engine = new SyncEngine({
        client,
        userId: uid,
        storage,
        canSync: false, // suppress sync on start
        realtime: false,
        onChange: (_, s) => {
          latestStatus = s;
          if (s.state === 'syncing') seenSyncing = true;
          if (s.state === 'offline' && seenSyncing) resolveOffline();
        },
      });
      engines.push(engine);
      await engine.start();

      const swim = rec(uid);
      await engine.create([swim]);

      engine.setCanSync(true); // starts sync in background; insert will throw
      await offlineP; // wait until first send fails and state reaches 'offline'

      expect(latestStatus.state).toBe('offline');
      expect(jest.getTimerCount()).toBeGreaterThan(0); // retry timer is pending

      // Advance past RETRY_MIN_MS (2 000 ms): timer fires → sync runs → second insert succeeds
      jest.advanceTimersByTime(2_001);
      await engine.sync(); // join the running promise that the timer started

      expect(engine.pending).toBe(0); // op was resent and cleared
      expect(sendCount).toBe(2); // one throw + one success
    } finally {
      jest.useRealTimers();
    }
  });

  it('update while a delete is in-flight: record does not reappear', async () => {
    // RED: proves the ANY-delete guard in update(), not just the last-op check.
    // Scenario: insert(X) and delete(X) are both in-flight (same flush batch); update(X) is
    // called while the flush is paused — enqueue appends update after in-flight delete, so only
    // the ANY-delete guard prevents X from reappearing in records.
    const uid = 'user-ghost-inflight';
    const swim = rec(uid);
    const storage = memoryStorage();

    // Outbox: insert (attempted) + delete — same as after remove() was called during a flush.
    // Records: already empty (remove() cleared it).
    await saveUserData(storage, uid, {
      records: {},
      outbox: [
        { opId: 'op-insert', kind: 'insert', record: swim, attempted: true },
        { opId: 'op-delete', kind: 'delete', id: swim.id, deletedAt: new Date().toISOString() },
      ],
      lastFullSync: new Date().toISOString(), // skip full-fetch
    });

    // Insert pauses so both ops stay in inFlight while we call update()
    let insertStarted = false;
    let resolveInsert!: () => void;
    const client = {
      from: () => ({
        insert: async () => {
          insertStarted = true;
          await new Promise<void>(res => { resolveInsert = res; });
          return ok();
        },
        update: () => ({ eq: () => Promise.resolve(ok()) }),
      }),
    } as unknown as SupabaseClient;

    let latestRecords: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client,
      userId: uid,
      storage,
      canSync: false, // must be false so await engine.start() resolves without touching the insert
      realtime: false,
      onChange: r => { latestRecords = r; },
    });
    engines.push(engine);

    await engine.start(); // loads state without syncing (canSync=false → offline immediately)

    // Enable sync — setCanSync triggers sync(true) internally without a second call needed
    engine.setCanSync(true);
    while (!insertStarted) await Promise.resolve(); // drain microtasks until insert is in-flight

    // update(X) while delete is in inFlight: must NOT make X reappear
    await engine.update({ ...swim, name: 'Ghost swim' });
    expect(swim.id in latestRecords).toBe(false);

    // Release insert so afterEach can stop the engine cleanly
    resolveInsert();
    await engine.sync();
  });

  it('re-fetches after insert refused then fetch fails: refused record gone on retry', async () => {
    jest.useFakeTimers();
    try {
      const uid = 'user-retry-fetch';
      const storage = memoryStorage();
      const swim = rec(uid);
      let selectCount = 0;
      const client = {
        from: () => ({
          insert: () => Promise.resolve({ error: { code: 'some_constraint' }, status: 400 }),
          update: () => ({ eq: () => Promise.resolve(ok()) }),
          select: () => ({
            is: () => ({
              order: () => ({
                range: () => {
                  selectCount++;
                  if (selectCount === 1) throw new Error('network');
                  return Promise.resolve({ data: [], error: null, status: 200 });
                },
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;
      await saveUserData(storage, uid, {
        records: { [swim.id]: swim },
        outbox: [{ opId: 'op1', kind: 'insert', record: swim, attempted: false }],
        lastFullSync: new Date().toISOString(),
      });
      let latestRecords: Record<string, EventRecord> = { [swim.id]: swim };
      let latestStatus: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };
      let seenSyncing = false;
      let resolveOffline!: () => void;
      const offlineP = new Promise<void>(res => { resolveOffline = res; });
      const engine = new SyncEngine({
        client,
        userId: uid,
        storage,
        canSync: true,
        realtime: false,
        onChange: (r, s) => {
          latestRecords = r;
          latestStatus = s;
          if (s.state === 'syncing') seenSyncing = true;
          if (s.state === 'offline' && seenSyncing) resolveOffline();
        },
      });
      engines.push(engine);
      await engine.start();
      await offlineP;
      expect(latestStatus.state).toBe('offline');
      expect(selectCount).toBe(1);
      jest.advanceTimersByTime(2_001);
      await engine.sync();
      expect(selectCount).toBe(2);
      expect(swim.id in latestRecords).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('update after remove when a delete op is queued: event does not reappear in records', async () => {
    const uid = 'user-ghost';
    const storage = memoryStorage();
    const swim = rec(uid);

    // Pre-load with an attempted insert so that remove() queues a real delete op
    await saveUserData(storage, uid, {
      records: { [swim.id]: swim },
      outbox: [{ opId: 'op1', kind: 'insert', record: swim, attempted: true }],
      lastFullSync: null,
    });

    let latestRecords: Record<string, EventRecord> = {};

    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: uid,
      storage,
      canSync: false, // no sync
      realtime: false,
      onChange: r => {
        latestRecords = r;
      },
    });
    engines.push(engine);

    await engine.start();
    expect(swim.id in latestRecords).toBe(true); // initially visible

    // remove() sees attempted insert → queues a real delete op
    await engine.remove([swim.id]);
    expect(swim.id in latestRecords).toBe(false);

    // update() after delete: enqueue returns outbox unchanged; record must NOT reappear
    await engine.update({ ...swim, name: 'Ghost swim' });
    expect(swim.id in latestRecords).toBe(false); // Fix 4: no ghost
  });

  it('says whether a create was saved on the phone', async () => {
    const storage = memoryStorage();
    const engine = new SyncEngine({ client: staticClient(ok), userId: 'user-save', storage, canSync: false, realtime: false, onChange: () => {} });
    engines.push(engine);
    await engine.start();
    expect(await engine.create([rec('user-save')])).toBe(true);

    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await engine.create([rec('user-save')])).toBe(false);
  });

  it('gives up on a change after five server errors in a row', async () => {
    jest.useFakeTimers();
    try {
      // Every insert gets a 503; the re-fetch finds nothing.
      const client = {
        from: () => ({
          insert: () => Promise.resolve({ error: { code: '' }, status: 503 }),
          update: () => ({ eq: () => Promise.resolve(ok()) }),
          select: () => ({
            is: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null, status: 200 }) }) }),
          }),
        }),
      } as unknown as SupabaseClient;
      let latest: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };
      const engine = new SyncEngine({
        client,
        userId: 'user-5xx',
        storage: memoryStorage(),
        canSync: true,
        realtime: false,
        onChange: (_records, status) => {
          latest = status;
        },
      });
      engines.push(engine);
      await engine.start();
      await engine.create([rec('user-5xx')]);
      // With exponential backoff, retries fire at t≈0 (microtask), 2 s, 6 s, 14 s, 30 s.
      // Advance 25 s: catches the first four failures (count=4), not the fifth (due at 30 s).
      await jest.advanceTimersByTimeAsync(25_000);
      expect(engine.pending).toBe(1);
      // Advance past the fifth failure (30 s): count hits MAX_SERVER_ERRORS → drop.
      await jest.advanceTimersByTimeAsync(10_000);
      expect(engine.pending).toBe(0);
      expect(latest.refused).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a queued change when every request returns 503 (full outage)', async () => {
    jest.useFakeTimers();
    try {
      // Both insert AND select return 503: the server is completely down.
      const client = {
        from: () => ({
          insert: () => Promise.resolve({ error: { code: '' }, status: 503 }),
          update: () => ({ eq: () => Promise.resolve(ok()) }),
          select: () => ({
            is: () => ({
              order: () => ({
                range: () =>
                  Promise.resolve({ data: null, error: { message: 'service unavailable' }, status: 503 }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseClient;
      let latest: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };
      const engine = new SyncEngine({
        client,
        userId: 'user-outage',
        storage: memoryStorage(),
        canSync: true,
        realtime: false,
        onChange: (_records, status) => {
          latest = status;
        },
      });
      engines.push(engine);
      await engine.start();
      await engine.create([rec('user-outage')]);
      // Advance well past what would have been 5 retries if strikes were counted: 10 × 5 min.
      await jest.advanceTimersByTimeAsync(10 * 5 * 60_000);
      // The change must still be queued and refused must be absent.
      expect(engine.pending).toBe(1);
      expect(latest.refused).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('tries loading again on the next sync, keeping changes made meanwhile', async () => {
    const storage = memoryStorage();
    const stored = rec('user-load');
    await saveUserData(storage, 'user-load', { records: { [stored.id]: stored }, outbox: [], lastFullSync: null });
    // The first read fails, as if storage were busy at start.
    jest.spyOn(storage, 'getItem').mockRejectedValueOnce(new Error('busy'));
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: 'user-load',
      storage,
      canSync: false,
      realtime: false,
      onChange: next => {
        records = next;
      },
    });
    engines.push(engine);
    await engine.start();
    const added = rec('user-load');
    await engine.create([added]);
    await engine.sync(true);
    expect(Object.keys(records).sort()).toEqual([stored.id, added.id].sort());
    expect((await loadUserData(storage, 'user-load')).records[added.id]).toBeDefined();
  });

  it("keeps a queued stored delete when memory gets the same event after a failed load", async () => {
    const uid = 'user-retry-del';
    const storage = memoryStorage();
    const x = rec(uid);
    // Storage holds a queued delete of x (already attempted).
    await saveUserData(storage, uid, {
      records: {},
      outbox: [{ opId: 'del-op', kind: 'delete', id: x.id, deletedAt: new Date().toISOString(), attempted: true }],
      lastFullSync: null,
    });
    // Both the start() load and the retryLoad inside start()'s sync fail, so loadFailed stays true
    // until the explicit engine.sync(true) call below — keeping the window open for an in-memory op.
    jest.spyOn(storage, 'getItem')
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'));
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: uid,
      storage,
      canSync: false,
      realtime: false,
      onChange: (r, _s) => {
        records = r;
      },
    });
    engines.push(engine);
    await engine.start();
    // Simulate a Realtime-style delivery of x while the load had failed (an update, since a
    // Realtime row-change is an update not a fresh insert; enqueue ignores an update after a delete).
    await engine.update(x);
    // Retry the load: the stored delete should win, x must not appear.
    await engine.sync(true);
    expect(records[x.id]).toBeUndefined();
    const saved = await loadUserData(storage, uid);
    // Outbox should hold only the delete (the in-memory update was swallowed by enqueue).
    expect(saved.outbox).toHaveLength(1);
    expect(saved.outbox[0]).toMatchObject({ kind: 'delete', id: x.id });
  });

  it("folds an in-memory update into a stored unattempted insert after a failed load", async () => {
    const uid = 'user-retry-fold';
    const storage = memoryStorage();
    const x = { ...rec(uid), name: 'Original' };
    // Storage holds an unattempted insert of x.
    await saveUserData(storage, uid, {
      records: { [x.id]: x },
      outbox: [{ opId: 'ins-op', kind: 'insert', record: x, attempted: false }],
      lastFullSync: null,
    });
    // Both the start() load and the retryLoad inside start()'s sync fail, so loadFailed stays true.
    jest.spyOn(storage, 'getItem')
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'));
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok),
      userId: uid,
      storage,
      canSync: false,
      realtime: false,
      onChange: (r, _s) => {
        records = r;
      },
    });
    engines.push(engine);
    await engine.start();
    // While the load had failed, the user edits x.
    await engine.update({ ...x, name: 'Updated' });
    // Retry the load: the update should be folded into the unattempted insert op.
    await engine.sync(true);
    expect(records[x.id]?.name).toBe('Updated');
    const saved = await loadUserData(storage, uid);
    expect(saved.outbox).toHaveLength(1);
    expect(saved.outbox[0]).toMatchObject({ kind: 'insert', record: expect.objectContaining({ name: 'Updated' }) });
  });

  it('counts a refused op even when a later op in the same batch stops on network failure', async () => {
    const uid = 'user-refused-then-network';
    const storage = memoryStorage();
    const swim1 = rec(uid);
    const swim2 = rec(uid);
    let insertCallCount = 0;
    let selectCallCount = 0;
    // First insert → 400 (rejected), second insert → status 0 (supabase-js network failure format)
    // Subsequent inserts (retries) succeed so sync can reach the fetch stage
    const rangeOk = () => {
      selectCallCount++;
      return Promise.resolve({ data: [], error: null, status: 200 });
    };
    const client = {
      from: () => ({
        insert: async () => {
          insertCallCount++;
          if (insertCallCount === 1) return { error: { code: 'some_constraint' }, status: 400 };
          if (insertCallCount === 2) return { error: { message: 'failed to fetch' }, status: 0 };
          return ok();
        },
        update: () => ({ eq: () => Promise.resolve(ok()) }),
        // fetchVisibleEvents: .select(cols).is('deleted_at', null).order('id').range(from, to)
        select: () => ({ is: () => ({ order: () => ({ range: rangeOk }) }) }),
      }),
    } as unknown as SupabaseClient;
    await saveUserData(storage, uid, {
      records: { [swim1.id]: swim1, [swim2.id]: swim2 },
      outbox: [
        { opId: 'op1', kind: 'insert', record: swim1, attempted: false },
        { opId: 'op2', kind: 'insert', record: swim2, attempted: false },
      ],
      lastFullSync: new Date().toISOString(),
    });
    let latestStatus: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };
    const engine = new SyncEngine({
      client,
      userId: uid,
      storage,
      canSync: true,
      realtime: false,
      onChange: (_r, s) => {
        latestStatus = s;
      },
    });
    engines.push(engine);
    await engine.start();
    // After start() the first sync ran: op1 rejected, op2 stopped on network
    expect(latestStatus.refused).toBe(1);
    expect(latestStatus.pending).toBe(1); // op1 gone, op2 still queued
    expect(selectCallCount).toBe(0); // fetch skipped due to network stop
    // Now run a second sync WITHOUT requesting a refresh — wantRefresh must trigger the fetch
    await engine.sync(false);
    expect(selectCallCount).toBe(1); // wantRefresh caused a full fetch
  });

  it('applies an edit that removes, updates and creates events in one save', async () => {
    const storage = memoryStorage();
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok), userId: 'user-apply', storage, canSync: false, realtime: false,
      onChange: next => { records = next; },
    });
    engines.push(engine);
    await engine.start();
    const a = rec('user-apply');
    const b = rec('user-apply');
    await engine.create([a, b]);
    const setItem = jest.spyOn(storage, 'setItem');
    const c = rec('user-apply');

    expect(await engine.apply({ remove: [a.id], update: [{ ...b, name: 'Swim club' }], create: [c] })).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(3); // one save: outbox, records, sync state
    expect(Object.keys(records).sort()).toEqual([b.id, c.id].sort());
    expect(records[b.id].name).toBe('Swim club');
    expect(engine.pending).toBe(2); // a was never sent, so its create is cancelled: b's create (folded edit) and c's create
    expect((await loadUserData(storage, 'user-apply')).records[c.id]).toBeDefined();
  });

  it('says when an edit could not be stored on the phone', async () => {
    const storage = memoryStorage();
    const engine = new SyncEngine({ client: staticClient(ok), userId: 'user-apply2', storage, canSync: false, realtime: false, onChange: () => {} });
    engines.push(engine);
    await engine.start();
    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await engine.apply({ remove: [], update: [], create: [rec('user-apply2')] })).toBe(false);
  });

  it("leaves everything as it was when an edit can't be stored", async () => {
    const storage = memoryStorage();
    let records: Record<string, EventRecord> = {};
    let changes = 0;
    const engine = new SyncEngine({
      client: staticClient(ok), userId: 'user-apply3', storage, canSync: false, realtime: false,
      onChange: next => { records = next; changes += 1; },
    });
    engines.push(engine);
    await engine.start();
    const a = rec('user-apply3');
    await engine.create([a]);
    const before = { ...records };
    const pendingBefore = engine.pending;
    const seen = changes;
    jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('disk full'));

    expect(await engine.apply({ remove: [a.id], update: [], create: [rec('user-apply3'), rec('user-apply3')] })).toBe(false);
    expect(changes).toBe(seen); // nothing new shown
    expect(records).toEqual(before);
    expect(engine.pending).toBe(pendingBefore);
  });

  it('makes one series when "make it weekly" fails to store and is saved again', async () => {
    const storage = memoryStorage();
    let records: Record<string, EventRecord> = {};
    const engine = new SyncEngine({
      client: staticClient(ok), userId: 'user-apply4', storage, canSync: false, realtime: false,
      onChange: next => { records = next; },
    });
    engines.push(engine);
    await engine.start();
    const swim = rec('user-apply4');
    await engine.create([swim]);
    const series = '00000000-0000-4000-8000-000000000099';
    const weekly = { every: 1, unit: 'week' as const, until: '2026-11-17' };
    // What the form plans each time Save is pressed (the event and its series as the form opened).
    const plan = () => ({
      remove: [],
      update: [{ ...swim, occurrenceId: series, repeat: weekly }],
      create: ['2026-11-10', '2026-11-17'].map(dateKey => ({ ...rec('user-apply4'), dateKey, occurrenceId: series, repeat: weekly })),
    });
    const setItem = jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    expect(await engine.apply(plan())).toBe(false);
    setItem.mockRestore();
    expect(await engine.apply(plan())).toBe(true);

    expect(Object.values(records).map(r => r.dateKey).sort()).toEqual(['2026-11-03', '2026-11-10', '2026-11-17']);
    expect(engine.pending).toBe(3);
    expect((await loadUserData(storage, 'user-apply4')).outbox).toHaveLength(3);
  });
});
