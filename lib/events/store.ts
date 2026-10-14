import { isOutboxOp, type OutboxOp } from './outbox';
import { type EventRecord, isEventRecord } from './rows';

/** The three AsyncStorage methods the engine needs (AsyncStorage itself fits). */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type UserData = { records: Record<string, EventRecord>; outbox: OutboxOp[]; lastFullSync: string | null };

export const emptyUserData = (): UserData => ({ records: {}, outbox: [], lastFullSync: null });

export const userKeys = (userId: string) => ({
  records: `planme:events:${userId}`,
  outbox: `planme:outbox:${userId}`,
  sync: `planme:sync:${userId}`,
});

const parse = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** One user's events and queued changes. Damaged entries are skipped, not fatal. */
export async function loadUserData(storage: KeyValueStorage, userId: string): Promise<UserData> {
  const keys = userKeys(userId);
  const [rawRecords, rawOutbox, rawSync] = await Promise.all([
    storage.getItem(keys.records),
    storage.getItem(keys.outbox),
    storage.getItem(keys.sync),
  ]);

  const records: Record<string, EventRecord> = {};
  const parsedRecords = parse(rawRecords);
  if (parsedRecords && typeof parsedRecords === 'object' && !Array.isArray(parsedRecords)) {
    for (const value of Object.values(parsedRecords)) {
      if (isEventRecord(value)) records[value.id] = value;
    }
  }

  const parsedOutbox = parse(rawOutbox);
  const outbox = Array.isArray(parsedOutbox) ? parsedOutbox.filter(isOutboxOp) : [];

  const sync = parse(rawSync);
  const lastFullSync =
    sync && typeof sync === 'object' && 'lastFullSync' in sync && typeof sync.lastFullSync === 'string' ? sync.lastFullSync : null;

  return { records, outbox, lastFullSync };
}

export async function saveUserData(storage: KeyValueStorage, userId: string, data: UserData): Promise<void> {
  const keys = userKeys(userId);
  // Write outbox first: an op without its record is harmless (it is sent and the next fetch
  // brings the record back); a record without its op would be silently lost on the next full fetch.
  await storage.setItem(keys.outbox, JSON.stringify(data.outbox));
  await storage.setItem(keys.records, JSON.stringify(data.records));
  await storage.setItem(keys.sync, JSON.stringify({ lastFullSync: data.lastFullSync }));
}

export async function clearUserData(storage: KeyValueStorage, userId: string): Promise<void> {
  const keys = userKeys(userId);
  await Promise.all([storage.removeItem(keys.records), storage.removeItem(keys.outbox), storage.removeItem(keys.sync)]);
}
