import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure } from './failures';
import { type EventRecord, insertPayload, isEventRecord, updatePayload } from './rows';
import { isUuid } from './uuid';

/** A change waiting to be sent. `attempted` means it may already have reached the server. */
export type OutboxOp =
  | { opId: string; kind: 'insert'; record: EventRecord; attempted?: boolean }
  | { opId: string; kind: 'update'; record: EventRecord; attempted?: boolean }
  | { opId: string; kind: 'delete'; id: string; deletedAt: string; attempted?: boolean };

export const newOpId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const opEventId = (op: OutboxOp): string => (op.kind === 'delete' ? op.id : op.record.id);

export const pendingIds = (outbox: OutboxOp[]): Set<string> => new Set(outbox.map(opEventId));

export function isOutboxOp(v: unknown): v is OutboxOp {
  if (typeof v !== 'object' || v === null) return false;
  const op = v as Record<string, unknown>;
  if (typeof op.opId !== 'string') return false;
  if (op.attempted !== undefined && typeof op.attempted !== 'boolean') return false;
  if (op.kind === 'delete') return typeof op.id === 'string' && isUuid(op.id) && typeof op.deletedAt === 'string';
  return (op.kind === 'insert' || op.kind === 'update') && isEventRecord(op.record);
}

/**
 * Add a change, folding it into the last queued change to the same event (unless that one is
 * being sent right now). Creates stay creates; a delete of a create the server never saw cancels
 * it; an edit after an attempted insert appends a separate UPDATE so the edit is not lost if the
 * create retry is treated as a duplicate.
 */
export function enqueue(outbox: OutboxOp[], op: OutboxOp, inFlight: ReadonlySet<string> = new Set()): OutboxOp[] {
  if (op.kind === 'insert') return [...outbox, op];

  const id = opEventId(op);

  // Find the LAST op for this event id (authoritative state of what is queued).
  let lastIndex = -1;
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (opEventId(outbox[i]) === id) { lastIndex = i; break; }
  }
  const last = lastIndex !== -1 ? outbox[lastIndex] : undefined;

  if (op.kind === 'update') {
    // No prior op for this event, or the last one is being sent → append as a new op.
    if (!last || inFlight.has(last.opId)) return [...outbox, op];
    // The event is being deleted → ignore the edit.
    if (last.kind === 'delete') return outbox;
    // The create may already be on the server (attempted=true). A retried create is silently
    // ignored as a duplicate (23505), so the edit must travel as its own UPDATE.
    if (last.kind === 'insert' && last.attempted) return [...outbox, op];
    // Otherwise fold into the last op: an unattempted insert or an earlier update.
    const next = [...outbox];
    next[lastIndex] = { ...last, record: op.record };
    return next;
  }

  // op.kind === 'delete'
  if (last?.kind === 'delete') return outbox;

  // An unattempted, non-in-flight insert means nothing has ever reached the server for this
  // event (any later ops would have been folded into it). Just cancel locally.
  const unsentOnly = outbox.some(
    o => opEventId(o) === id && o.kind === 'insert' && !o.attempted && !inFlight.has(o.opId),
  );

  // Remove every op for this event that is not currently being sent.
  const next = outbox.filter(o => opEventId(o) !== id || inFlight.has(o.opId));

  if (unsentOnly) return next;
  return [...next, op];
}

export type FlushOutcome = {
  /** opIds that are finished: sent, already applied, or given up on. */
  done: string[];
  /** Why sending stopped early, if it did. The rest stay queued. */
  stoppedBy: 'network' | 'auth' | null;
  /** How many changes the server refused (they are dropped; a re-fetch shows the server's version). */
  rejected: number;
  /** The change sending stopped at, when it stopped on a network or auth failure. */
  failed?: { opId: string; status: number };
  /** True when shouldContinue() returned false mid-flush; the remaining ops are untouched. */
  interrupted?: boolean;
};

const DUPLICATE_KEY = '23505';

async function send(client: SupabaseClient, op: OutboxOp): Promise<{ error: { code?: string } | null; status: number }> {
  const events = client.from('events');
  if (op.kind === 'insert') {
    const { error, status } = await events.insert(insertPayload(op.record));
    return { error, status };
  }
  if (op.kind === 'update') {
    const { error, status } = await events.update(updatePayload(op.record)).eq('id', op.record.id);
    return { error, status };
  }
  const { error, status } = await events.update({ deleted_at: op.deletedAt }).eq('id', op.id);
  return { error, status };
}

/** Send changes in order. Stops at the first network or session problem; drops changes the server refuses. */
export async function flushOutbox(
  client: SupabaseClient,
  ops: OutboxOp[],
  shouldContinue: () => boolean = () => true,
): Promise<FlushOutcome> {
  const done: string[] = [];
  let rejected = 0;
  for (const op of ops) {
    if (!shouldContinue()) return { done, stoppedBy: null, rejected, interrupted: true };
    const { error, status } = await send(client, op);
    // An edit or delete that matches no row (gone, or no longer ours to see) succeeds with no error.
    if (error && !(op.kind === 'insert' && error.code === DUPLICATE_KEY)) {
      const failure = classifyFailure(error, status);
      if (failure !== 'rejected') return { done, stoppedBy: failure, rejected, failed: { opId: op.opId, status } };
      rejected += 1;
    }
    done.push(op.opId);
  }
  return { done, stoppedBy: null, rejected };
}
