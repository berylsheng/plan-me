import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthApiError } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import * as legacyModule from '@/lib/events/legacy';
import { LEGACY_KEYS } from '@/lib/events/legacy';
import type { EventRecord } from '@/lib/events/rows';
import type { EventChanges, SyncEngineLike, SyncEngineOptions, SyncStatus } from '@/lib/events/syncEngine';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { AuthProvider } from '../AuthProvider';
import { EventsProvider, useEvents } from '../EventsProvider';

class FakeEngine implements SyncEngineLike {
  static instances: FakeEngine[] = [];
  stopped = false;
  canSync: boolean;
  created: EventRecord[][] = [];
  updated: EventRecord[] = [];
  removed: string[][] = [];
  cleared = false;
  pending = 0;
  constructor(public options: SyncEngineOptions) {
    this.canSync = options.canSync;
    FakeEngine.instances.push(this);
  }
  async start() {}
  stop() {
    this.stopped = true;
  }
  async sync() {}
  setCanSync(canSync: boolean) {
    this.canSync = canSync;
  }
  createResult = true;
  async create(records: EventRecord[]) {
    this.created.push(records);
    return this.createResult;
  }
  async update(record: EventRecord) {
    this.updated.push(record);
  }
  async remove(ids: string[]) {
    this.removed.push(ids);
  }
  async clearLocalData() {
    this.cleared = true;
  }
  applied: EventChanges[] = [];
  applyResult = true;
  async apply(changes: EventChanges) {
    this.applied.push(changes);
    return this.applyResult;
  }
}
const createEngine = (options: SyncEngineOptions) => new FakeEngine(options);
const idle: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null };

const swim = { id: 'e1', dateKey: '2026-11-03', name: 'Swim', startTime: '07:00', endTime: '' };

function setup(fake = fakeAuthClient(fakeSession())) {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={fake.client}>
      <EventsProvider storage={storage} createEngine={createEngine}>
        {children}
      </EventsProvider>
    </AuthProvider>
  );
  return { fake, storage, ...renderHook(() => useEvents(), { wrapper }) };
}

function setupWith(storage: ReturnType<typeof memoryStorage>, fake = fakeAuthClient(fakeSession())) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={fake.client}>
      <EventsProvider storage={storage} createEngine={createEngine}>
        {children}
      </EventsProvider>
    </AuthProvider>
  );
  return { fake, storage, ...renderHook(() => useEvents(), { wrapper }) };
}

const engine = (n = 0) => FakeEngine.instances[n];

beforeEach(async () => {
  FakeEngine.instances = [];
  await AsyncStorage.clear();
});

describe('EventsProvider', () => {
  it('starts an engine for the signed-in user', async () => {
    setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    expect(engine().options.userId).toBe('user-1');
    expect(engine().canSync).toBe(true);
  });

  it('has no engine while signed out', async () => {
    const { result } = setup(fakeAuthClient(null));
    await waitFor(() => expect(result.current.status.state).toBe('loading'));
    expect(FakeEngine.instances).toHaveLength(0);
  });

  it('switches engines when someone else signs in', async () => {
    const { fake, result } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));

    // A's engine emits a record and a non-initial status
    const aRecord: EventRecord = { ...swim, ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null };
    act(() => engine(0).options.onChange({ [aRecord.id]: aRecord }, idle));
    expect(result.current.records[aRecord.id]).toBeDefined(); // A sees it
    expect(result.current.status.state).toBe('idle'); // A's status visible

    // B signs in — check synchronously on first render that A's data is gone
    act(() => fake.emit('SIGNED_IN', fakeSession('bob@test.nz', 'user-2')));
    // Immediately (no waitFor): neither A's event nor A's status must be visible to B
    expect(result.current.records[aRecord.id]).toBeUndefined();
    expect(result.current.status).toEqual({ state: 'loading', pending: 0, lastSyncedAt: null });

    await waitFor(() => expect(FakeEngine.instances).toHaveLength(2));
    expect(engine(0).stopped).toBe(true);
    expect(engine(1).options.userId).toBe('user-2');

    // B must never see A's record — even if A's stale onChange fires now
    act(() => engine(0).options.onChange({ [aRecord.id]: aRecord }, idle));
    expect(result.current.records[aRecord.id]).toBeUndefined();
  });

  it("shows the engine's events as planner items", async () => {
    const { result } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    const record: EventRecord = { ...swim, ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null };
    act(() => engine().options.onChange({ e1: record }, idle));
    expect(result.current.items).toEqual({ '2026-11-03': [record] });
  });

  it('adds new events as personal events owned by the user', async () => {
    const { result } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    act(() => result.current.addEvents([swim]));
    expect(engine().created[0]).toEqual([{ ...swim, ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null }]);
  });

  it('keeps owner and sharing when an event is edited', async () => {
    const { result } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    const theirs: EventRecord = { ...swim, ownerId: 'user-9', visibility: 'shared', memberIds: ['m'], updatedAt: 't' };
    act(() => engine().options.onChange({ e1: theirs }, idle));
    act(() => result.current.updateEvent({ ...swim, name: 'Swim lesson' }));
    expect(engine().updated[0]).toEqual({ ...theirs, name: 'Swim lesson' });
    act(() => result.current.deleteEvents(['e1']));
    expect(engine().removed[0]).toEqual(['e1']);
  });

  it('passes the repeat rule through when updating a recurring event', async () => {
    const rule = { every: 1, unit: 'week' as const, until: '2026-11-24' };
    const seriesId = '11111111-2222-4333-8444-555555555555';
    const { result } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    const theirs: EventRecord = { ...swim, ownerId: 'user-9', visibility: 'shared', memberIds: ['m'], updatedAt: 't', occurrenceId: seriesId, repeat: rule };
    act(() => engine().options.onChange({ e1: theirs }, idle));
    act(() => result.current.updateEvent({ ...swim, name: 'Swim lesson', occurrenceId: seriesId, repeat: rule }));
    expect(engine().updated[0].repeat).toEqual(rule);
  });

  it('only lets the engine send changes when there is a session', async () => {
    await AsyncStorage.setItem('planme:lastUser', JSON.stringify({ id: 'user-1', email: 'alice@test.nz' }));
    const fake = fakeAuthClient(null);
    fake.auth.getSession.mockReturnValueOnce(new Promise<never>(() => {}));
    setup(fake);
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    expect(engine().canSync).toBe(false);
    act(() => fake.emit('TOKEN_REFRESHED', fakeSession()));
    await waitFor(() => expect(engine().canSync).toBe(true));
  });

  it("deletes this phone's data only when sign-out works", async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    fake.auth.signOut.mockResolvedValueOnce({ error: new AuthApiError('nope', 500, 'unexpected_failure') });
    await act(async () => {
      await result.current.signOutAndForget();
    });
    expect(engine().cleared).toBe(false);
    await act(async () => {
      expect(await result.current.signOutAndForget()).toEqual({ ok: true });
    });
    expect(engine().cleared).toBe(true);
  });

  it('offers the events already on the phone and adds them as personal events', async () => {
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));
    await act(async () => {
      await result.current.claimLegacy();
    });
    expect(result.current.legacy).toBeNull();
    expect(engine().created[0][0]).toMatchObject({ name: 'Swim', ownerId: 'user-1', visibility: 'personal' });
  });

  it("keeps planMeTasks while pending > 0 and removes it once the engine reports all claimed ids on the server", async () => {
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));
    await act(async () => { await result.current.claimLegacy(); });

    const claimedRecord = engine().created[0]?.[0];
    expect(claimedRecord).toBeDefined();

    // Engine reports syncing with pending > 0: planMeTasks must still be there
    act(() => engine().options.onChange(
      { [claimedRecord!.id]: claimedRecord! },
      { state: 'syncing', pending: 1, lastSyncedAt: null },
    ));
    await waitFor(() => expect(result.current.status.state).toBe('syncing'));
    expect(storage.dump().planMeTasks).toBeDefined();

    // Engine reports idle with all ids present: planMeTasks and claim should be removed
    act(() => engine().options.onChange(
      { [claimedRecord!.id]: claimedRecord! },
      { state: 'idle', pending: 0, lastSyncedAt: new Date().toISOString() },
    ));
    await waitFor(() => expect(storage.dump().planMeTasks).toBeUndefined());
    expect(storage.dump()[LEGACY_KEYS.claim]).toBeUndefined();
  });

  it("re-queues claimed records on load when the engine has empty records", async () => {
    const CLAIM_ID = '00000000-0000-4000-8000-000000000001';
    const claimedRecord: EventRecord = {
      id: CLAIM_ID,
      dateKey: '2026-11-03',
      name: 'Swim',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    };
    const claim = { userId: 'user-1', records: [claimedRecord], claimedAt: '2026-11-01T00:00:00.000Z' };

    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
      [LEGACY_KEYS.claim]: JSON.stringify(claim),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await waitFor(() => expect(result.current.legacy).toBeNull()); // settle offer state

    // Engine starts and reports idle with empty records (crash recovery scenario)
    act(() => engine().options.onChange({}, { state: 'idle', pending: 0, lastSyncedAt: null }));

    // Provider must re-queue the claimed records with the same ids
    await waitFor(() => expect(engine().created).toHaveLength(1));
    expect(engine().created[0]).toEqual([claimedRecord]);
  });

  it("clears local data even when the auth event commits userId to null before the storage read returns", async () => {
    const base = memoryStorage();
    const slow = {
      getItem: async (key: string): Promise<string | null> => {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        return base.getItem(key);
      },
      setItem: async (key: string, value: string): Promise<void> => {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        return base.setItem(key, value);
      },
      removeItem: async (key: string): Promise<void> => {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        return base.removeItem(key);
      },
    };
    const fake = fakeAuthClient(fakeSession());
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={slow} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    // No act() — lets React flush setState(SIGNED_OUT) during the 20ms storage delay,
    // which nulls engineRef.current before clearLocalData() is reached on current code.
    void result.current.signOutAndForget();
    await waitFor(() => expect(engine().cleared).toBe(true), { timeout: 10000 });
  }, 15000);

  it("does not re-queue claimed records that the user has since deleted", async () => {
    const CLAIM_ID = '00000000-0000-4000-8000-000000000001';
    const claimedRecord: EventRecord = {
      id: CLAIM_ID,
      dateKey: '2026-11-03',
      name: 'Swim',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    };
    const claim = { userId: 'user-1', records: [claimedRecord], claimedAt: '2026-11-01T00:00:00.000Z' };
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      [LEGACY_KEYS.claim]: JSON.stringify(claim),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await waitFor(() => expect(result.current.legacy).toBeNull()); // settle offer state

    // First emit: claimed record is already present in the engine
    act(() => engine().options.onChange(
      { [CLAIM_ID]: claimedRecord },
      { state: 'idle', pending: 0, lastSyncedAt: null },
    ));
    await waitFor(() => expect(result.current.status.state).toBe('idle'));
    expect(engine().created).toHaveLength(0);

    // User deletes the record — engine reports it gone with pending > 0
    act(() => engine().options.onChange(
      {},
      { state: 'syncing', pending: 1, lastSyncedAt: null },
    ));
    await waitFor(() => expect(result.current.status.pending).toBe(1));
    // Re-queue must NOT fire for this engine again
    expect(engine().created).toHaveLength(0);
  });

  it("offers the events again to the same user after their claim is released on sign-out", async () => {
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));
    await act(async () => { await result.current.claimLegacy(); });
    await act(async () => { await result.current.signOutAndForget(); });
    // Same user signs back in
    act(() => fake.emit('SIGNED_IN', fakeSession()));
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));
  });

  it("releases the claim after a successful sign-out but not after a failed sign-out", async () => {
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));
    await act(async () => { await result.current.claimLegacy(); });

    // Failed sign-out: claim must not be released
    fake.auth.signOut.mockResolvedValueOnce({ error: new AuthApiError('nope', 500, 'unexpected_failure') });
    await act(async () => { await result.current.signOutAndForget(); });
    const afterFail = JSON.parse(storage.dump()[LEGACY_KEYS.claim] ?? 'null') as { released?: boolean } | null;
    expect(afterFail?.released).toBeUndefined();

    // Successful sign-out: claim must be released (not yet synced)
    await act(async () => { await result.current.signOutAndForget(); });
    const afterOk = JSON.parse(storage.dump()[LEGACY_KEYS.claim] ?? 'null') as { released?: boolean } | null;
    expect(afterOk?.released).toBe(true);
  });

  it("does not re-queue if claim is already queued — outbox persisted, only re-create if outbox was lost", async () => {
    const CLAIM_ID = '00000000-0000-4000-8000-000000000001';
    const claimedRecord: EventRecord = {
      id: CLAIM_ID,
      dateKey: '2026-11-03',
      name: 'Swim',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    };
    const claim = {
      userId: 'user-1',
      records: [claimedRecord],
      claimedAt: '2020-01-01T00:00:00.000Z',
      queued: true,
    };
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
      [LEGACY_KEYS.claim]: JSON.stringify(claim),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await waitFor(() => expect(result.current.legacy).toBeNull());
    // Engine starts — CLAIM_ID absent from records (insert is in outbox, not yet flushed)
    act(() => engine().options.onChange({}, { state: 'idle', pending: 1, lastSyncedAt: null }));
    // Drain microtasks so any re-queue effect can fire
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    // Because claim.queued is true, create must NOT be called
    expect(engine().created).toHaveLength(0);
    // Once the engine reports the claimed id back from the server: claim finishes
    act(() => engine().options.onChange(
      { [CLAIM_ID]: claimedRecord },
      { state: 'idle', pending: 0, lastSyncedAt: new Date().toISOString() },
    ));
    await waitFor(() => expect(storage.dump().planMeTasks).toBeUndefined());
  });

  it("doesn't mark the claim queued when the events weren't saved", async () => {
    const { result, storage } = setup();
    await storage.setItem(LEGACY_KEYS.items, JSON.stringify({ '2026-11-03': [swim] }));
    await waitFor(() => expect(engine()).toBeDefined());
    act(() => engine().options.onChange({}, idle));
    engine().createResult = false;
    await act(async () => {
      await result.current.claimLegacy();
    });
    const claim = JSON.parse((await storage.getItem(LEGACY_KEYS.claim)) ?? 'null');
    expect(claim.queued).toBeUndefined();
  });

  it('does not bring back a claimed event deleted before a restart, and still finishes the claim', async () => {
    const storage = memoryStorage();
    const swim2 = { ...swim, id: 'e2', name: 'Swim 2' };
    await storage.setItem(LEGACY_KEYS.items, JSON.stringify({ '2026-11-03': [swim, swim2] }));
    const first = setupWith(storage);
    await waitFor(() => expect(engine(0)).toBeDefined());
    act(() => engine(0).options.onChange({}, idle));
    await act(async () => {
      await first.result.current.claimLegacy();
    });
    const [kept, deleted] = engine(0).created[0];
    act(() => engine(0).options.onChange({ [kept.id]: kept, [deleted.id]: deleted }, { ...idle, pending: 2 }));
    act(() => first.result.current.deleteEvents([deleted.id]));
    await waitFor(async () => {
      const claim = JSON.parse((await storage.getItem(LEGACY_KEYS.claim)) ?? 'null');
      expect(claim.records.map((r: { id: string }) => r.id)).toEqual([kept.id]);
    });
    first.unmount();

    // Restart: a new engine with only the kept event, synced after the claim.
    setupWith(storage);
    await waitFor(() => expect(engine(1)).toBeDefined());
    act(() => engine(1).options.onChange({ [kept.id]: kept }, { state: 'idle', pending: 0, lastSyncedAt: new Date(Date.now() + 1000).toISOString() }));
    await waitFor(async () => expect(await storage.getItem(LEGACY_KEYS.items)).toBeNull());
    expect(engine(1).created).toHaveLength(0);
  });

  it("forgets the user's family details on sign-out", async () => {
    const { result, storage } = setup();
    await waitFor(() => expect(FakeEngine.instances).toHaveLength(1));
    await storage.setItem('planme:family:user-1', '{}');
    await storage.setItem('planme:tagMap:user-1', '{}');
    await act(async () => {
      await result.current.signOutAndForget();
    });
    expect(await storage.getItem('planme:family:user-1')).toBeNull();
    expect(await storage.getItem('planme:tagMap:user-1')).toBeNull();
  });

  it('keeps who sees an event when an edit does not say', async () => {
    const { result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const record = { ...swim, id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f', ownerId: 'user-1', visibility: 'shared' as const, memberIds: ['user-2'], updatedAt: null };
    act(() => engine().options.onChange({ [record.id]: record }, idle));
    act(() => result.current.updateEvent({ ...swim, id: record.id, name: 'Swim club' }));
    await waitFor(() => expect(engine().updated).toHaveLength(1));
    expect(engine().updated[0]).toMatchObject({ name: 'Swim club', visibility: 'shared', memberIds: ['user-2'] });
  });

  it('forgets everything on the phone after deleting the account', async () => {
    const { result, fake, storage } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => ({ data: null, error: null, status: 204 }));
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    await storage.setItem('planme:family:user-1', '{}');
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome).toEqual({ ok: true });
    expect(engine().cleared).toBe(true);
    expect(await storage.getItem('planme:family:user-1')).toBeNull();
    expect(fake.auth.signOut).toHaveBeenCalled();
  });

  it("keeps everything when the server can't delete the account", async () => {
    const { result, fake, storage } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    await storage.setItem('planme:family:user-1', '{}');
    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome?.ok).toBe(false);
    expect(engine().cleared).toBe(false);
    expect(await storage.getItem('planme:family:user-1')).toBe('{}');
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', { message: 'TypeError: Network request failed' }, "You're offline. Connect to the internet to delete your account."],
    ['signed out', { message: 'jwt expired', status: 401 }, 'Sign in again to do this.'],
    ['failing', { message: 'boom', status: 500 }, "Couldn't delete your photo. Try again."],
  ])("explains a photo clean-up that fails (%s) and deletes nothing", async (_label, error, message) => {
    const { result, fake, storage } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const rpcMock = jest.fn();
    (fake.client as unknown as { rpc: jest.Mock }).rpc = rpcMock;
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: null, error }) }),
    };
    await storage.setItem('planme:family:user-1', '{}');
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome).toMatchObject({ ok: false, message });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(engine().cleared).toBe(false);
    expect(await storage.getItem('planme:family:user-1')).toBe('{}');
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });

  function failingRpc(fake: ReturnType<typeof fakeAuthClient>) {
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => ({
      data: null,
      error: { code: '', message: 'TypeError: Network request failed' },
      status: 0,
    }));
    const eqMock = jest.fn(async () => ({ data: null, error: null, status: 200 }));
    (fake.client as unknown as { from: jest.Mock }).from = jest.fn(() => ({ update: () => ({ eq: eqMock }) }));
    return eqMock;
  }

  it("says the photo was removed when it was, but the account couldn't be deleted", async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [{ name: 'a.jpg' }], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    const eqMock = failingRpc(fake);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome).toMatchObject({
      ok: false,
      message: "You're offline. Connect to the internet to delete your account. Your photo was removed.",
    });
    expect(eqMock).toHaveBeenCalled();
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });

  it("doesn't mention a photo when there wasn't one", async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    failingRpc(fake);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.deleteAccountAndForget();
    });
    expect(outcome).toMatchObject({ ok: false, message: "You're offline. Connect to the internet to delete your account." });
  });

  it('calls signOut even when clearLocalData throws', async () => {
    const { result, fake } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    (fake.client as unknown as { rpc: jest.Mock }).rpc = jest.fn(async () => ({ data: null, error: null, status: 204 }));
    (fake.client as unknown as { storage: unknown }).storage = {
      from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }),
    };
    engine().clearLocalData = jest.fn(async () => { throw new Error('Storage full'); });
    await act(async () => {
      try {
        await result.current.deleteAccountAndForget();
      } catch {
        // clearLocalData threw; we only care that signOut still ran
      }
    });
    expect(fake.auth.signOut).toHaveBeenCalled();
  });

  it("does not show user A's offer to user B on the first render after the switch", async () => {
    const fake = fakeAuthClient(fakeSession());
    const storage = memoryStorage({
      planMeTasks: JSON.stringify({ '2026-11-03': [{ id: 'old', dateKey: '2026-11-03', name: 'Swim', startTime: '', endTime: '' }] }),
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider client={fake.client}>
        <EventsProvider storage={storage} createEngine={createEngine}>
          {children}
        </EventsProvider>
      </AuthProvider>
    );
    const { result } = renderHook(() => useEvents(), { wrapper });
    await waitFor(() => expect(result.current.legacy).toEqual({ count: 1 }));

    // B signs in synchronously
    act(() => fake.emit('SIGNED_IN', fakeSession('bob@test.nz', 'user-2')));

    // Immediately (same render): B must not see A's legacy offer
    expect(result.current.legacy).toBeNull();
  });

  it('saves an edit from the form in one go and reports whether it was stored', async () => {
    const { result } = setup();
    await waitFor(() => expect(engine()).toBeDefined());
    const swimRecord: EventRecord = { ...swim, id: 'aaaaaaaa-0000-4000-8000-000000000001', ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null };
    act(() => engine().options.onChange({ [swimRecord.id]: swimRecord }, idle));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.saveEventChanges({
        remove: [],
        update: [{ ...swimRecord, name: 'Swim club' }],
        create: [{ id: 'aaaaaaaa-0000-4000-8000-000000000002', dateKey: '2026-11-10', name: 'Swim club', startTime: '', endTime: '' }],
      });
    });
    expect(saved).toBe(true);
    expect(engine().applied[0].update[0]).toMatchObject({ id: swimRecord.id, name: 'Swim club', ownerId: swimRecord.ownerId });
    expect(engine().applied[0].create[0]).toMatchObject({ ownerId: 'user-1', visibility: 'personal', updatedAt: null });

    const drop = jest.spyOn(legacyModule, 'dropFromClaim');
    engine().applyResult = false;
    await act(async () => {
      saved = await result.current.saveEventChanges({ remove: [swimRecord.id], update: [], create: [] });
    });
    expect(saved).toBe(false);
    expect(drop).not.toHaveBeenCalled(); // the event is still there, so it stays in the claim

    engine().applyResult = true;
    await act(async () => {
      saved = await result.current.saveEventChanges({ remove: [swimRecord.id], update: [], create: [] });
    });
    expect(drop).toHaveBeenCalledWith(expect.anything(), 'user-1', [swimRecord.id]);
    drop.mockRestore();
  });
});
