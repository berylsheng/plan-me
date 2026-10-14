import { type EventRecord, type EventRow, isEventRow, recordFromRow } from './rows';

/** After fetching everything visible: the server's rows, except events with changes still queued here. */
export function mergeFullFetch(
  local: Record<string, EventRecord>,
  server: EventRow[],
  pending: Set<string>,
): Record<string, EventRecord> {
  const merged: Record<string, EventRecord> = {};
  for (const row of server) {
    if (!pending.has(row.id)) merged[row.id] = recordFromRow(row);
  }
  for (const id of pending) {
    const mine = local[id];
    if (mine) merged[id] = mine;
  }
  return merged;
}

export type RealtimeChange = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

/** One live change from Supabase Realtime. Events with queued local changes are left alone. */
export function applyRealtimeChange(
  local: Record<string, EventRecord>,
  change: RealtimeChange,
  pending: Set<string>,
): Record<string, EventRecord> {
  const id = change.new.id ?? change.old.id;
  if (typeof id !== 'string' || pending.has(id)) return local;

  if (change.eventType === 'DELETE' || typeof change.new.deleted_at === 'string') {
    if (!(id in local)) return local;
    const next = { ...local };
    delete next[id];
    return next;
  }

  const row: unknown = change.new;
  if (!isEventRow(row)) return local;
  const current = local[id];
  if (current?.updatedAt && Date.parse(row.updated_at) <= Date.parse(current.updatedAt)) return local;
  return { ...local, [id]: recordFromRow(row) };
}
