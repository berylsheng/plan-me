import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthRetryableFetchError } from '@supabase/supabase-js';

import { FAMILY_MESSAGES, type FamilyApi } from '@/lib/family/api';
import { writeFamilyCache } from '@/lib/family/cache';
import type { FamilyResult, FamilySnapshot } from '@/lib/family/types';
import { fakeAuthClient, fakeSession } from '@/test-utils/fakeAuthClient';
import { createFakeEngine, FakeEngine } from '@/test-utils/fakeEngine';
import { FAKE_BOB, FAKE_ME } from '@/test-utils/fakeFamily';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { AuthProvider } from '../AuthProvider';
import { EventsProvider } from '../EventsProvider';
import { FamilyProvider, useFamily } from '../FamilyProvider';

const inFamily: FamilySnapshot = {
  me: FAKE_ME,
  family: { id: 'fam-1', name: 'Smiths', ownerId: FAKE_ME.id, inviteCode: 'K7QM2XWP' },
  members: [FAKE_ME, FAKE_BOB],
};
const alone: FamilySnapshot = { me: FAKE_ME, family: null, members: [FAKE_ME] };
const ok = <T,>(value: T): FamilyResult<T> => ({ ok: true, value });

function fakeApi(fetchResult: FamilyResult<FamilySnapshot> = ok(inFamily)) {
  const done = async () => ok(undefined);
  return {
    fetchFamily: jest.fn(async () => fetchResult),
    createFamily: jest.fn(done),
    joinFamily: jest.fn(done),
    leaveFamily: jest.fn(done),
    removeMember: jest.fn(done),
    regenerateInviteCode: jest.fn(async () => ok('P3RT8VWX')),
    updateProfile: jest.fn(done),
    uploadAvatar: jest.fn(async () => ok('user-1/new.jpg')),
    removeAvatar: jest.fn(done),
    avatarUrls: jest.fn(async (_client: unknown, paths: string[]) => Object.fromEntries(paths.map(p => [p, `https://signed/${p}`]))),
  } satisfies FamilyApi;
}

function setup(api = fakeApi(), fake = fakeAuthClient(fakeSession()), storage = memoryStorage()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider client={fake.client}>
      <EventsProvider storage={storage} createEngine={createFakeEngine}>
        <FamilyProvider storage={storage} api={api}>
          {children}
        </FamilyProvider>
      </EventsProvider>
    </AuthProvider>
  );
  return { api, fake, storage, ...renderHook(() => useFamily(), { wrapper }) };
}

beforeEach(async () => {
  FakeEngine.reset();
  await AsyncStorage.clear();
});

describe('FamilyProvider', () => {
  it('loads signed URLs for members with photos', async () => {
    const api = fakeApi(ok({ ...inFamily, members: [FAKE_ME, { ...FAKE_BOB, avatarPath: 'user-2/b.jpg' }] }));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.avatarUrl({ ...FAKE_BOB, avatarPath: 'user-2/b.jpg' })).toBe('https://signed/user-2/b.jpg'));
    expect(result.current.avatarUrl(FAKE_ME)).toBeNull();
  });

  it('uploads a new photo, replacing the old one', async () => {
    const api = fakeApi(ok({ ...inFamily, me: { ...FAKE_ME, avatarPath: 'user-1/old.jpg' } }));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.me?.avatarPath).toBe('user-1/old.jpg'));
    await act(async () => {
      await result.current.setAvatar('BASE64');
    });
    expect(api.uploadAvatar).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.any(String), 'BASE64', 'user-1/old.jpg');
  });

  it('fetches the family and builds the tag lookup', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.family?.name).toBe('Smiths'));
    expect(result.current.isOwner).toBe(true);
    expect(result.current.memberByTag.get('BE')?.id).toBe(FAKE_BOB.id);
    expect(result.current.memberById.get(FAKE_ME.id)?.displayName).toBe('Alice');
    expect(result.current.loading).toBe(false);
  });

  it('starts from the cached family, then shows the server version', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, FAKE_ME.id, alone);
    let resolveFetch: (r: FamilyResult<FamilySnapshot>) => void = () => {};
    const api = fakeApi();
    api.fetchFamily.mockImplementationOnce(() => new Promise(resolve => (resolveFetch = resolve)));
    const { result } = setup(api, fakeAuthClient(fakeSession()), storage);
    await waitFor(() => expect(result.current.me?.id).toBe(FAKE_ME.id));
    expect(result.current.family).toBeNull();
    await act(async () => resolveFetch(ok(inFamily)));
    expect(result.current.family?.name).toBe('Smiths');
  });

  it("keeps the cached family when the server can't be reached", async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, FAKE_ME.id, inFamily);
    const api = fakeApi({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    const { result } = setup(api, fakeAuthClient(fakeSession()), storage);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.family?.name).toBe('Smiths');
  });

  it('refreshes the family and the events after joining', async () => {
    const api = fakeApi(ok(alone));
    const { result } = setup(api);
    await waitFor(() => expect(result.current.me).not.toBeNull());
    api.fetchFamily.mockResolvedValue(ok(inFamily));
    let outcome: FamilyResult | undefined;
    await act(async () => {
      outcome = await result.current.joinFamily('K7QM2XWP');
    });
    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(result.current.family?.name).toBe('Smiths');
    expect(FakeEngine.instances[0].syncs).toContain(true);
  });

  it('returns the message of a failed action and does not refetch', async () => {
    const api = fakeApi();
    api.leaveFamily.mockResolvedValueOnce({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    const { result } = setup(api);
    await waitFor(() => expect(result.current.family).not.toBeNull());
    const fetches = api.fetchFamily.mock.calls.length;
    let outcome: FamilyResult | undefined;
    await act(async () => {
      outcome = await result.current.leaveFamily();
    });
    expect(outcome).toEqual({ ok: false, message: FAMILY_MESSAGES.offline, offline: true });
    expect(api.fetchFamily.mock.calls.length).toBe(fetches);
  });

  it("never shows the previous user's family", async () => {
    const api = fakeApi();
    const { result, fake } = setup(api);
    await waitFor(() => expect(result.current.family?.name).toBe('Smiths'));
    api.fetchFamily.mockImplementation(() => new Promise(() => {})); // B's fetch never returns
    act(() => fake.emit('SIGNED_IN', fakeSession('bob@test.nz', 'user-2')));
    expect(result.current.family).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.me).toBeNull();
  });
});

describe('FamilyProvider — auto-refresh on unknown members', () => {
  const unknownId = 'user-unknown-99';
  const unknownRecord = {
    id: 'rec-unknown-1',
    dateKey: '2026-11-03',
    name: 'Swim',
    startTime: '07:00',
    endTime: '',
    ownerId: unknownId,
    visibility: 'shared' as const,
    memberIds: [],
    updatedAt: null,
  };
  const idleStatus = { state: 'idle' as const, pending: 0, lastSyncedAt: null };

  it('calls fetchFamily again when a record is owned by an id not in memberById', async () => {
    jest.useFakeTimers();
    try {
      const { api } = setup();
      await waitFor(() => expect(FakeEngine.instances[0]).toBeDefined());
      const fetchCountBefore = api.fetchFamily.mock.calls.length;
      act(() => {
        FakeEngine.instances[0].options.onChange({ [unknownRecord.id]: unknownRecord }, idleStatus);
      });
      await jest.advanceTimersByTimeAsync(2_500);
      await waitFor(() => expect(api.fetchFamily.mock.calls.length).toBeGreaterThan(fetchCountBefore));
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not call fetchFamily a third time for the same unknown id', async () => {
    jest.useFakeTimers();
    try {
      const { api } = setup();
      await waitFor(() => expect(FakeEngine.instances[0]).toBeDefined());
      // First emit: triggers one refresh
      act(() => {
        FakeEngine.instances[0].options.onChange({ [unknownRecord.id]: unknownRecord }, idleStatus);
      });
      await jest.advanceTimersByTimeAsync(2_500);
      await waitFor(() => expect(api.fetchFamily.mock.calls.length).toBeGreaterThan(1));
      const countAfterFirst = api.fetchFamily.mock.calls.length;
      // Second emit with the same unknown id: must NOT trigger another refresh
      act(() => {
        FakeEngine.instances[0].options.onChange({ [unknownRecord.id]: unknownRecord }, idleStatus);
      });
      await jest.advanceTimersByTimeAsync(2_500);
      expect(api.fetchFamily.mock.calls.length).toBe(countAfterFirst);
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls fetchFamily once even when records change within 2 s', async () => {
    jest.useFakeTimers();
    try {
      const { api } = setup();
      await waitFor(() => expect(FakeEngine.instances[0]).toBeDefined());
      const fetchCountBefore = api.fetchFamily.mock.calls.length;
      // First emit: an unknown id appears.
      act(() => {
        FakeEngine.instances[0].options.onChange({ [unknownRecord.id]: unknownRecord }, idleStatus);
      });
      // Second emit within 2 s: a different records identity, same unknown id.
      act(() => {
        FakeEngine.instances[0].options.onChange(
          { [unknownRecord.id]: { ...unknownRecord, updatedAt: '2026-11-03T01:00:00Z' } },
          idleStatus,
        );
      });
      // Let 2 s pass — the refresh must fire exactly once.
      await jest.advanceTimersByTimeAsync(2_500);
      await waitFor(() => expect(api.fetchFamily.mock.calls.length).toBe(fetchCountBefore + 1));
    } finally {
      jest.useRealTimers();
    }
  });

  it("calls fetchFamily again when status.refused increases", async () => {
    jest.useFakeTimers();
    try {
      const { api } = setup();
      await waitFor(() => expect(FakeEngine.instances[0]).toBeDefined());
      await waitFor(() => expect(api.fetchFamily.mock.calls.length).toBeGreaterThan(0));
      const fetchCountBefore = api.fetchFamily.mock.calls.length;
      act(() => {
        FakeEngine.instances[0].options.onChange({}, { state: 'idle', pending: 0, lastSyncedAt: null, refused: 1 });
      });
      await jest.advanceTimersByTimeAsync(2_500);
      await waitFor(() => expect(api.fetchFamily.mock.calls.length).toBeGreaterThan(fetchCountBefore));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('FamilyProvider controller rulings', () => {
  const LAST_USER = 'planme:lastUser';
  const alice = { id: 'user-1', email: 'alice@test.nz' };

  it('ruling A: offline start with no cached family is not loading and is offline, and fetchFamily is not called', async () => {
    // Simulate an offline start: last user stored, but getSession returns a network error (no session).
    await AsyncStorage.setItem(LAST_USER, JSON.stringify(alice));
    const fake = fakeAuthClient(); // no initial session
    fake.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as Awaited<ReturnType<typeof fake.auth.getSession>>);
    const api = fakeApi();
    // setup() uses fakeAuthClient(fakeSession()) by default; pass our fake directly
    const { result } = setup(api, fake);
    await waitFor(() => expect(result.current.offline).toBe(true));
    // No session means hasSession is false, so loading must be false even with no cached data.
    expect(result.current.loading).toBe(false);
    // fetchFamily must not have been called because there was no session.
    expect(api.fetchFamily).not.toHaveBeenCalled();
  });

});
