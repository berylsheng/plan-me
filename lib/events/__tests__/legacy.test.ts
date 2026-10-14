import { memoryStorage } from '@/test-utils/memoryStorage';

import type { EventRecord } from '../rows';
import {
  activeClaim,
  claimLegacy,
  claimSynced,
  declineLegacy,
  dropFromClaim,
  finishLegacyClaim,
  LEGACY_KEYS,
  legacyOffer,
  markClaimQueued,
  readClaim,
  readLegacyItems,
  releaseLegacyClaim,
} from '../legacy';

const saved = {
  '2026-11-03': [{ id: 'a', dateKey: '2026-11-03', name: 'Swim', startTime: '07:00', endTime: '' }],
  '2026-11-04': [{ id: 'b', dateKey: '2026-11-04', name: 'Gym @AZ', startTime: '', endTime: '' }],
};
const withLegacy = (extra: Record<string, string> = {}) => memoryStorage({ [LEGACY_KEYS.items]: JSON.stringify(saved), ...extra });

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

beforeEach(() => {
  n = 0;
});

describe('events from before accounts', () => {
  it('offers them to someone who has not been asked', async () => {
    expect(await legacyOffer(withLegacy(), 'user-1')).toEqual({ count: 2 });
  });

  it('offers nothing when there are none', async () => {
    expect(await legacyOffer(memoryStorage(), 'user-1')).toBeNull();
    expect(await legacyOffer(memoryStorage({ [LEGACY_KEYS.items]: '{}' }), 'user-1')).toBeNull();
  });

  it('skips a damaged day instead of losing the rest', async () => {
    const storage = memoryStorage({ [LEGACY_KEYS.items]: JSON.stringify({ ...saved, '2026-11-05': 'garbage' }) });
    expect(Object.keys(await readLegacyItems(storage))).toEqual(['2026-11-03', '2026-11-04']);
    expect(await readLegacyItems(memoryStorage({ [LEGACY_KEYS.items]: '{not json' }))).toEqual({});
  });

  it('turns them into personal events for the account that claims them, once', async () => {
    const storage = withLegacy();
    const records = await claimLegacy(storage, 'user-1', newId);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ name: 'Gym', people: ['AZ'], ownerId: 'user-1', visibility: 'personal' });
    expect(await legacyOffer(storage, 'user-1')).toBeNull();
    expect(await legacyOffer(storage, 'user-2')).toBeNull();
    expect(await claimLegacy(storage, 'user-2', newId)).toEqual([]);
  });

  it('asks the next account after one says no', async () => {
    const storage = withLegacy();
    await declineLegacy(storage, 'user-1');
    expect(await legacyOffer(storage, 'user-1')).toBeNull();
    expect(await legacyOffer(storage, 'user-2')).toEqual({ count: 2 });
  });

  it('deletes them only after the claim has synced', async () => {
    const storage = withLegacy();
    await claimLegacy(storage, 'user-1', newId);
    await finishLegacyClaim(storage, 'user-2');
    expect(storage.dump()[LEGACY_KEYS.items]).toBeDefined();
    await finishLegacyClaim(storage, 'user-1');
    expect(storage.dump()[LEGACY_KEYS.items]).toBeUndefined();
  });

  it('offers them again if the claimer signs out before they synced', async () => {
    const storage = withLegacy();
    await claimLegacy(storage, 'user-1', newId);
    await releaseLegacyClaim(storage, 'user-1');
    expect(await legacyOffer(storage, 'user-1')).toEqual({ count: 2 });
  });

  it("claim twice by the same user returns identical ids; the claim is written before the records are returned", async () => {
    const storage = withLegacy();
    const first = await claimLegacy(storage, 'user-1', newId);
    expect(first).toHaveLength(2);
    // Claim must be written to storage before returning the records
    const stored = JSON.parse(storage.dump()[LEGACY_KEYS.claim] ?? 'null') as { userId: string; records: EventRecord[] } | null;
    expect(stored?.userId).toBe('user-1');
    expect(stored?.records).toHaveLength(2);
    // Second call returns the identical ids
    const second = await claimLegacy(storage, 'user-1', newId);
    expect(second.map(r => r.id)).toEqual(first.map(r => r.id));
  });

  it("re-claim after release returns the same ids; another user after release gets new ids and their own ownerId", async () => {
    const storage = withLegacy();
    const first = await claimLegacy(storage, 'user-1', newId);
    await releaseLegacyClaim(storage, 'user-1');
    const reclaimed = await claimLegacy(storage, 'user-1', newId);
    expect(reclaimed.map(r => r.id)).toEqual(first.map(r => r.id));
    // Another user after release gets new ids
    await releaseLegacyClaim(storage, 'user-1');
    const otherClaim = await claimLegacy(storage, 'user-2', newId);
    expect(otherClaim.map(r => r.id)).not.toEqual(first.map(r => r.id));
    expect(otherClaim.every(r => r.ownerId === 'user-2')).toBe(true);
  });

  it("does not offer and returns [] when another user's claim is active", async () => {
    const storage = withLegacy();
    await claimLegacy(storage, 'user-1', newId);
    expect(await legacyOffer(storage, 'user-2')).toBeNull();
    expect(await claimLegacy(storage, 'user-2', newId)).toEqual([]);
  });

  it("offer count matches records actually imported even when a day key is invalid", async () => {
    const storage = memoryStorage({
      [LEGACY_KEYS.items]: JSON.stringify({
        ...saved,
        'not-a-date': [{ id: 'x', dateKey: 'not-a-date', name: 'Ghost', startTime: '', endTime: '' }],
      }),
    });
    // recordsFromLegacy skips non-date keys; offer count must match what is actually imported
    expect(await legacyOffer(storage, 'user-1')).toEqual({ count: 2 });
  });

  describe('readClaim', () => {
    it('returns null when nothing is stored', async () => {
      expect(await readClaim(memoryStorage())).toBeNull();
    });

    it('returns null for a damaged claim', async () => {
      const s = memoryStorage({ [LEGACY_KEYS.claim]: '{"wrong":true}' });
      expect(await readClaim(s)).toBeNull();
    });
  });

  describe('activeClaim', () => {
    it('returns null when no claim exists', async () => {
      expect(await activeClaim(memoryStorage(), 'user-1')).toBeNull();
    });

    it('returns null when the claim belongs to another user', async () => {
      const s = withLegacy();
      await claimLegacy(s, 'user-1', newId);
      expect(await activeClaim(s, 'user-2')).toBeNull();
    });

    it('returns null when the claim is released', async () => {
      const s = withLegacy();
      await claimLegacy(s, 'user-1', newId);
      await releaseLegacyClaim(s, 'user-1');
      expect(await activeClaim(s, 'user-1')).toBeNull();
    });
  });

  describe('claimSynced', () => {
    const uuid1 = '00000000-0000-4000-8000-000000000001';
    const uuid2 = '00000000-0000-4000-8000-000000000002';
    const claimedAt = '2026-11-01T00:00:00.000Z';
    const record1: EventRecord = {
      id: uuid1,
      dateKey: '2026-11-03',
      name: 'Swim',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    };
    const record2: EventRecord = {
      id: uuid2,
      dateKey: '2026-11-04',
      name: 'Gym',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    };
    const claim = { userId: 'user-1', records: [record1, record2], claimedAt };
    const serverRecords = { [uuid1]: record1, [uuid2]: record2 };
    const afterClaim = new Date(Date.parse(claimedAt) + 1000).toISOString();

    it('is false while pending > 0', () => {
      expect(claimSynced(claim, serverRecords, { state: 'syncing', pending: 1, lastSyncedAt: afterClaim })).toBe(false);
    });

    it('is false if lastSyncedAt is null', () => {
      expect(claimSynced(claim, serverRecords, { state: 'idle', pending: 0, lastSyncedAt: null })).toBe(false);
    });

    it('is false if lastSyncedAt is before claimedAt', () => {
      const before = new Date(Date.parse(claimedAt) - 1000).toISOString();
      expect(claimSynced(claim, serverRecords, { state: 'idle', pending: 0, lastSyncedAt: before })).toBe(false);
    });

    it('is false if any claimed id is missing from records', () => {
      expect(claimSynced(claim, { [uuid1]: record1 }, { state: 'idle', pending: 0, lastSyncedAt: afterClaim })).toBe(false);
    });

    it("is true when pending is 0, lastSyncedAt is after claimedAt, and all ids are present", () => {
      expect(claimSynced(claim, serverRecords, { state: 'idle', pending: 0, lastSyncedAt: afterClaim })).toBe(true);
    });

    it("is false when state is 'offline' even if all other conditions are met", () => {
      expect(claimSynced(claim, serverRecords, { state: 'offline', pending: 0, lastSyncedAt: afterClaim })).toBe(false);
    });
  });

  describe('markClaimQueued', () => {
    it('sets queued=true on the active claim', async () => {
      const storage = withLegacy();
      await claimLegacy(storage, 'user-1', newId);
      await markClaimQueued(storage, 'user-1');
      const claim = await readClaim(storage);
      expect(claim?.queued).toBe(true);
    });

    it('is a no-op when no active claim exists', async () => {
      const storage = memoryStorage();
      await expect(markClaimQueued(storage, 'user-1')).resolves.toBeUndefined();
    });
  });

  describe('dropFromClaim', () => {
    it('removes the given ids from the claim records', async () => {
      const storage = withLegacy();
      const records = await claimLegacy(storage, 'user-1', newId);
      expect(records).toHaveLength(2);
      await dropFromClaim(storage, 'user-1', [records[0].id]);
      const claim = await readClaim(storage);
      expect(claim?.records).toHaveLength(1);
      expect(claim?.records[0].id).toBe(records[1].id);
    });

    it('keeps the claim when all records are dropped', async () => {
      const storage = withLegacy();
      const records = await claimLegacy(storage, 'user-1', newId);
      await dropFromClaim(storage, 'user-1', records.map(r => r.id));
      const claim = await readClaim(storage);
      expect(claim).not.toBeNull();
      expect(claim?.records).toHaveLength(0);
    });

    it('is a no-op when no active claim exists', async () => {
      const storage = memoryStorage();
      await expect(dropFromClaim(storage, 'user-1', ['any-id'])).resolves.toBeUndefined();
    });
  });

  it("re-activating a released queued claim resets queued to undefined", async () => {
    const storage = withLegacy();
    await claimLegacy(storage, 'user-1', newId);
    await markClaimQueued(storage, 'user-1');
    const before = await readClaim(storage);
    expect(before?.queued).toBe(true);
    await releaseLegacyClaim(storage, 'user-1');
    await claimLegacy(storage, 'user-1', newId);
    const after = await readClaim(storage);
    expect(after?.queued).toBeUndefined();
  });

  describe('claim writes', () => {
    it('runs two quick drops one after the other, so neither is lost', async () => {
      const storage = withLegacy();
      const [first, second] = await claimLegacy(storage, 'user-1', newId);
      await Promise.all([dropFromClaim(storage, 'user-1', [first.id]), dropFromClaim(storage, 'user-1', [second.id])]);
      const claim = await activeClaim(storage, 'user-1');
      expect(claim?.records).toEqual([]);
    });

    it('keeps the queued flag when a drop runs at the same time', async () => {
      const storage = withLegacy();
      const [first, second] = await claimLegacy(storage, 'user-1', newId);
      await Promise.all([markClaimQueued(storage, 'user-1'), dropFromClaim(storage, 'user-1', [first.id])]);
      const claim = await activeClaim(storage, 'user-1');
      expect(claim?.queued).toBe(true);
      expect(claim?.records.map(r => r.id)).toEqual([second.id]);
    });

    it("doesn't rewrite the claim for an event it doesn't hold", async () => {
      const storage = withLegacy();
      await claimLegacy(storage, 'user-1', newId);
      const setItem = jest.spyOn(storage, 'setItem');
      await dropFromClaim(storage, 'user-1', ['not-claimed']);
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  it("re-activating a released claim sets a fresh claimedAt", async () => {
    const storage = withLegacy();
    const before = new Date('2026-11-01T00:00:00.000Z');
    const first = await claimLegacy(storage, 'user-1', newId, () => before);
    expect(first).toHaveLength(2);
    await releaseLegacyClaim(storage, 'user-1');
    const after = new Date('2026-11-02T00:00:00.000Z');
    await claimLegacy(storage, 'user-1', newId, () => after);
    const stored = JSON.parse(storage.dump()[LEGACY_KEYS.claim] ?? 'null') as { claimedAt: string } | null;
    expect(stored?.claimedAt).toBe(after.toISOString());
  });
});
