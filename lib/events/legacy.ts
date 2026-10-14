import { migrateStoredItems, type StoredEvent } from './items';
import { isEventRecord, type EventRecord, recordsFromLegacy } from './rows';
import type { KeyValueStorage } from './store';
import type { SyncStatus } from './syncEngine';
import type { ItemsByDate } from './types';

// Claim changes read the claim, then write it back. Run them one at a time per storage so that two
// quick deletes (or a delete and markClaimQueued) can't overwrite each other's change.
const queues = new WeakMap<KeyValueStorage, Promise<unknown>>();
function inOrder<T>(storage: KeyValueStorage, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(storage) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(storage, next.catch(() => undefined));
  return next;
}

export const LEGACY_KEYS = {
  items: 'planMeTasks',
  claim: 'planMeTasks:claim',
  declinedBy: 'planMeTasks:declinedBy',
};

export type LegacyClaim = {
  userId: string;
  records: EventRecord[];
  claimedAt: string;
  released?: boolean;
  queued?: boolean;
};

const parse = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** The events saved before accounts existed. A damaged day is skipped, not fatal. */
export async function readLegacyItems(storage: KeyValueStorage): Promise<ItemsByDate> {
  const parsed = parse(await storage.getItem(LEGACY_KEYS.items));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const items: ItemsByDate = {};
  for (const [dateKey, day] of Object.entries(parsed)) {
    if (!Array.isArray(day)) continue;
    try {
      const events = day.filter((e): e is StoredEvent => typeof e === 'object' && e !== null);
      Object.assign(items, migrateStoredItems({ [dateKey]: events }));
    } catch {
      // skip this day
    }
  }
  return items;
}

async function declinedBy(storage: KeyValueStorage): Promise<string[]> {
  const parsed = parse(await storage.getItem(LEGACY_KEYS.declinedBy));
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
}

/** Read and validate the stored claim; records filtered through isEventRecord; damaged shape → null. */
export async function readClaim(storage: KeyValueStorage): Promise<LegacyClaim | null> {
  const parsed = parse(await storage.getItem(LEGACY_KEYS.claim));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.userId !== 'string' || !Array.isArray(obj.records) || typeof obj.claimedAt !== 'string') return null;
  const records = (obj.records as unknown[]).filter(isEventRecord);
  const claim: LegacyClaim = { userId: obj.userId, records, claimedAt: obj.claimedAt };
  if (typeof obj.released === 'boolean') claim.released = obj.released;
  if (typeof obj.queued === 'boolean') claim.queued = obj.queued;
  return claim;
}

/** The claim if it belongs to this user and has not been released. */
export async function activeClaim(storage: KeyValueStorage, userId: string): Promise<LegacyClaim | null> {
  const claim = await readClaim(storage);
  if (!claim || claim.userId !== userId || claim.released) return null;
  return claim;
}

/** Pure: true only after a full server fetch has returned every claimed record. */
export function claimSynced(
  claim: LegacyClaim,
  records: Record<string, EventRecord>,
  status: SyncStatus,
): boolean {
  return (
    status.state === 'idle' &&
    status.pending === 0 &&
    status.lastSyncedAt !== null &&
    Date.parse(status.lastSyncedAt) > Date.parse(claim.claimedAt) &&
    claim.records.every(r => r.id in records)
  );
}

/** Whether to ask this user about the events on the phone. */
export async function legacyOffer(storage: KeyValueStorage, userId: string): Promise<{ count: number } | null> {
  const claim = await readClaim(storage);
  if (claim && !claim.released) return null;
  if ((await declinedBy(storage)).includes(userId)) return null;
  const items = await readLegacyItems(storage);
  let i = 0;
  const count = recordsFromLegacy(items, 'dummy', () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`).length;
  return count > 0 ? { count } : null;
}

/**
 * Give the events to this user.
 *
 * - Unreleased claim for this user → return existing records unchanged (idempotent; same ids).
 * - Unreleased claim for another user → return [].
 * - Released claim for this user → re-activate with the same ids and return them.
 * - Otherwise → build new records, write the claim first, then return the records.
 */
export function claimLegacy(
  storage: KeyValueStorage,
  userId: string,
  newId: () => string,
  now: () => Date = () => new Date(),
): Promise<EventRecord[]> {
  return inOrder(storage, async () => {
    const claim = await readClaim(storage);
    if (claim && !claim.released) {
      if (claim.userId === userId) return claim.records;
      return [];
    }
    if (claim && claim.released && claim.userId === userId) {
      // Re-activate with the same records so anything already uploaded gets 23505 → done.
      // Use a fresh claimedAt so claimSynced's lastSyncedAt comparison is correct.
      const reactivated: LegacyClaim = { userId: claim.userId, records: claim.records, claimedAt: now().toISOString() };
      await storage.setItem(LEGACY_KEYS.claim, JSON.stringify(reactivated));
      return claim.records;
    }
    // No claim, or a released claim of another user: create fresh records
    const items = await readLegacyItems(storage);
    const records = recordsFromLegacy(items, userId, newId);
    const newClaim: LegacyClaim = { userId, records, claimedAt: now().toISOString() };
    await storage.setItem(LEGACY_KEYS.claim, JSON.stringify(newClaim));
    return records;
  });
}

export async function declineLegacy(storage: KeyValueStorage, userId: string): Promise<void> {
  const ids = await declinedBy(storage);
  if (!ids.includes(userId)) await storage.setItem(LEGACY_KEYS.declinedBy, JSON.stringify([...ids, userId]));
}

/** Called once the server has confirmed every claimed record: removes the old copy. */
export function finishLegacyClaim(storage: KeyValueStorage, userId: string): Promise<void> {
  return inOrder(storage, async () => {
    const claim = await activeClaim(storage, userId);
    if (claim) {
      await storage.removeItem(LEGACY_KEYS.items);
      await storage.removeItem(LEGACY_KEYS.claim);
    }
  });
}

/** Mark the active claim as queued (the outbox insert has been persisted). */
export function markClaimQueued(storage: KeyValueStorage, userId: string): Promise<void> {
  return inOrder(storage, async () => {
    const claim = await activeClaim(storage, userId);
    if (!claim) return;
    await storage.setItem(LEGACY_KEYS.claim, JSON.stringify({ ...claim, queued: true }));
  });
}

/** Remove ids from the active claim's records. An emptied claim is kept so claimSynced finishes vacuously. */
export function dropFromClaim(storage: KeyValueStorage, userId: string, ids: string[]): Promise<void> {
  return inOrder(storage, async () => {
    const claim = await activeClaim(storage, userId);
    if (!claim) return;
    const idSet = new Set(ids);
    const records = claim.records.filter(r => !idSet.has(r.id));
    if (records.length === claim.records.length) return;
    const updated: LegacyClaim = { ...claim, records };
    await storage.setItem(LEGACY_KEYS.claim, JSON.stringify(updated));
  });
}

/** The claimer signed out before upload finished: keep the records but allow another offer. */
export function releaseLegacyClaim(storage: KeyValueStorage, userId: string): Promise<void> {
  return inOrder(storage, async () => {
    const claim = await activeClaim(storage, userId);
    if (claim) {
      await storage.setItem(LEGACY_KEYS.claim, JSON.stringify({ ...claim, released: true }));
    }
  });
}
