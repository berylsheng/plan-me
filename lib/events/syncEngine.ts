import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js';

import { applyRealtimeChange, mergeFullFetch } from './merge';
import { enqueue, flushOutbox, newOpId, opEventId, type OutboxOp, pendingIds } from './outbox';
import { fetchVisibleEvents } from './pull';
import type { EventRecord } from './rows';
import { clearUserData, emptyUserData, type KeyValueStorage, loadUserData, saveUserData, type UserData } from './store';

export type SyncState = 'loading' | 'idle' | 'syncing' | 'offline' | 'needs-sign-in';
export type SyncStatus = {
  state: SyncState;
  pending: number;
  lastSyncedAt: string | null;
  /** Changes the server refused since this engine started (absent means none). The planner shows a notice. */
  refused?: number;
};
export const INITIAL_STATUS: SyncStatus = { state: 'loading', pending: 0, lastSyncedAt: null };

export type SyncEngineOptions = {
  client: SupabaseClient;
  userId: string;
  storage: KeyValueStorage;
  /** False while there is no session (offline sign-in): changes queue but nothing is sent. */
  canSync: boolean;
  onChange: (records: Record<string, EventRecord>, status: SyncStatus) => void;
  realtime?: boolean;
  now?: () => Date;
};

export type EventChanges = { remove: string[]; update: EventRecord[]; create: EventRecord[] };

export interface SyncEngineLike {
  start(): Promise<void>;
  stop(): void;
  sync(refresh?: boolean): Promise<void>;
  setCanSync(canSync: boolean): void;
  /** True once the records and their queued changes are saved on the phone. */
  create(records: EventRecord[]): Promise<boolean>;
  update(record: EventRecord): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** One edit touching several events (deletes, then updates, then creates), stored in one save. True once stored. */
  apply(changes: EventChanges): Promise<boolean>;
  clearLocalData(): Promise<void>;
  readonly pending: number;
}

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;
const REFRESH_AFTER_MS = 60_000;
/** A change that gets this many server errors (5xx) in a row is dropped, so it can't block the queue. */
const MAX_SERVER_ERRORS = 5;

/** One signed-in user's events: changes apply locally first, then go to Supabase when possible. */
export class SyncEngine implements SyncEngineLike {
  private data: UserData = emptyUserData();
  private state: SyncState = 'loading';
  private canSync: boolean;
  private loaded: Promise<void> = Promise.resolve();
  private stopped = false;
  private cleared = false;
  private loadFailed = false;
  private running: Promise<void> | null = null;
  private again = false;
  private wantRefresh = false;
  private inFlight = new Set<string>();
  private retryMs = RETRY_MIN_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private channel: RealtimeChannel | null = null;
  private saving: Promise<boolean> = Promise.resolve(true);
  private refused = 0;
  private serverErrors = new Map<string, number>();

  constructor(private readonly options: SyncEngineOptions) {
    this.canSync = options.canSync;
  }

  get pending(): number {
    return this.data.outbox.length;
  }

  start(): Promise<void> {
    this.loaded = (async () => {
      try {
        this.data = await loadUserData(this.options.storage, this.options.userId);
      } catch {
        // Storage is unavailable: keep an empty snapshot in memory and never overwrite what's on disk.
        this.loadFailed = true;
        this.data = emptyUserData();
      }
      if (this.stopped) return;
      this.state = 'idle';
      this.emit();
      if (this.options.realtime !== false) {
        try {
          this.subscribe();
        } catch {
          // Realtime unavailable; carry on without it.
        }
      }
    })();
    return this.loaded.then(() => this.sync(true));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.channel) void this.options.client.removeChannel(this.channel);
    this.channel = null;
  }

  setCanSync(canSync: boolean): void {
    this.canSync = canSync;
    if (canSync) void this.sync(true);
  }

  async create(records: EventRecord[]): Promise<boolean> {
    await this.loaded;
    if (this.stopped) return false;
    for (const record of records) {
      this.data.records = { ...this.data.records, [record.id]: record };
      this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'insert', record }, this.inFlight);
    }
    return this.changed();
  }

  async update(record: EventRecord): Promise<void> {
    await this.loaded;
    if (this.stopped) return;
    this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'update', record }, this.inFlight);
    // Don't resurface a record that has any queued delete — even if a later op was appended while
    // the delete was in-flight, showing the record would contradict the user's own remove action.
    const anyDeleteForId = this.data.outbox.some(op => opEventId(op) === record.id && op.kind === 'delete');
    if (!anyDeleteForId) {
      this.data.records = { ...this.data.records, [record.id]: record };
    }
    await this.changed();
  }

  async remove(ids: string[]): Promise<void> {
    await this.loaded;
    if (this.stopped) return;
    const deletedAt = this.now().toISOString();
    const records = { ...this.data.records };
    for (const id of ids) {
      delete records[id];
      this.data.outbox = enqueue(this.data.outbox, { opId: newOpId(), kind: 'delete', id, deletedAt }, this.inFlight);
    }
    this.data.records = records;
    await this.changed();
  }

  async apply(changes: EventChanges): Promise<boolean> {
    await this.loaded;
    if (this.stopped) return false;
    const deletedAt = this.now().toISOString();
    // Store first, show after: an edit that can't be stored must leave nothing behind (no half-made
    // series in memory or the queue for the next Save to add to).
    const before = this.data;
    const { records: beforeRecords, outbox: beforeOutbox } = before;
    const next = this.withChanges(before, changes, deletedAt);
    const saved = await this.save({ ...next, lastFullSync: before.lastFullSync });
    if (!saved) {
      // A save can fail part-way through; put back what is in memory (best effort).
      void this.persist();
      return false;
    }
    if (this.stopped) return true;
    if (this.data === before && before.records === beforeRecords && before.outbox === beforeOutbox) {
      this.data = { ...next, lastFullSync: before.lastFullSync };
    } else {
      // A sync or Realtime change landed while saving: make the edit again on top of it and store that.
      this.data = { ...this.withChanges(this.data, changes, deletedAt), lastFullSync: this.data.lastFullSync };
      void this.persist();
    }
    this.emit();
    void this.sync();
    return true;
  }

  /** The records and queue after an edit: deletes, then updates, then creates. */
  private withChanges(data: UserData, changes: EventChanges, deletedAt: string): Pick<UserData, 'records' | 'outbox'> {
    const records = { ...data.records };
    let outbox = data.outbox;
    for (const id of changes.remove) {
      delete records[id];
      outbox = enqueue(outbox, { opId: newOpId(), kind: 'delete', id, deletedAt }, this.inFlight);
    }
    for (const record of changes.update) {
      outbox = enqueue(outbox, { opId: newOpId(), kind: 'update', record }, this.inFlight);
      // As in update(): never resurface a record with a queued delete.
      if (!outbox.some(op => opEventId(op) === record.id && op.kind === 'delete')) records[record.id] = record;
    }
    for (const record of changes.create) {
      records[record.id] = record;
      outbox = enqueue(outbox, { opId: newOpId(), kind: 'insert', record }, this.inFlight);
    }
    return { records, outbox };
  }

  /** Stop and delete this user's events and queued changes from the phone. */
  async clearLocalData(): Promise<void> {
    this.stop();
    this.cleared = true;
    await this.saving;
    await clearUserData(this.options.storage, this.options.userId);
  }

  /** Send queued changes, then (when due or asked) re-fetch. Calls while one runs are folded into it. */
  sync(refresh = false): Promise<void> {
    if (this.stopped || this.state === 'loading') return Promise.resolve();
    this.wantRefresh = this.wantRefresh || refresh;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = async () => {
      do {
        this.again = false;
        const doRefresh = this.wantRefresh;
        this.wantRefresh = false;
        await this.runSync(doRefresh);
      } while (this.again && !this.stopped);
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSync(refresh: boolean): Promise<void> {
    if (this.loadFailed) await this.retryLoad();
    if (!this.canSync || this.loadFailed) {
      if (refresh) this.wantRefresh = true;
      this.setState('offline');
      return;
    }
    const { client } = this.options;
    this.setState('syncing');

    if (this.data.outbox.length > 0) {
      // Mark everything as possibly sent before sending: a later delete must then reach the server.
      this.data.outbox = this.data.outbox.map(op => (op.attempted ? op : { ...op, attempted: true }));
      const batch: OutboxOp[] = this.data.outbox;
      for (const op of batch) this.inFlight.add(op.opId);
      await this.persist();

      let outcome: Awaited<ReturnType<typeof flushOutbox>>;
      try {
        outcome = await flushOutbox(client, batch, () => !this.stopped);
      } catch {
        for (const op of batch) this.inFlight.delete(op.opId);
        this.fail('network');
        return;
      }
      for (const op of batch) this.inFlight.delete(op.opId);

      // Engine was stopped while sending: the ops may or may not have reached the server.
      // Leave the outbox intact (a later restart will re-send; inserts become 23505 → done).
      if (this.stopped) return;

      const done = new Set(outcome.done);
      this.data.outbox = this.data.outbox.filter(op => !done.has(op.opId));
      // Clear the 5xx counter for every op that succeeded this flush ("in a row" resets).
      for (const opId of outcome.done) this.serverErrors.delete(opId);
      await this.persist();
      // Count refused ops before checking stoppedBy: both can be set in the same batch.
      if (outcome.rejected > 0) this.refused += outcome.rejected;
      if (outcome.stoppedBy) {
        const failed = outcome.failed;
        if (outcome.stoppedBy === 'network' && failed && failed.status >= 500) {
          // Only count a strike when the server is otherwise healthy.
          // Probe with a full fetch; if the probe fails the server may be down — do not count.
          let probeOk = false;
          try {
            const probe = await fetchVisibleEvents(client);
            if (this.stopped) return;
            if (probe.ok) {
              this.data.records = mergeFullFetch(this.data.records, probe.rows, pendingIds(this.data.outbox));
              this.data.lastFullSync = this.now().toISOString();
              await this.persist();
              probeOk = true;
            }
          } catch {
            // probe failed: server may be completely down; do not count a strike
          }
          if (probeOk) {
            const count = (this.serverErrors.get(failed.opId) ?? 0) + 1;
            this.serverErrors.set(failed.opId, count);
            if (count >= MAX_SERVER_ERRORS) {
              this.serverErrors.delete(failed.opId);
              this.data.outbox = this.data.outbox.filter(op => op.opId !== failed.opId);
              this.refused += 1;
              this.wantRefresh = true;
              await this.persist();
              // The blocking op is gone; schedule an immediate retry rather than the doubled backoff.
              this.retryMs = RETRY_MIN_MS;
            }
          }
        } else if (failed) {
          // Non-5xx failure (network error without status, or auth): reset this op's 5xx streak.
          this.serverErrors.delete(failed.opId);
        }
        if (outcome.rejected > 0) this.wantRefresh = true;
        this.fail(outcome.stoppedBy);
        return;
      }
      // A refused change was dropped: show the server's version instead.
      if (outcome.rejected > 0) refresh = true;
    }

    if (refresh || this.refreshDue()) {
      let pulled: Awaited<ReturnType<typeof fetchVisibleEvents>>;
      try {
        pulled = await fetchVisibleEvents(client);
      } catch {
        this.wantRefresh = true;
        this.fail('network');
        return;
      }
      if (this.stopped) return;
      if (!pulled.ok) {
        this.wantRefresh = true;
        this.fail(pulled.reason === 'auth' ? 'auth' : 'network');
        return;
      }
      this.data.records = mergeFullFetch(this.data.records, pulled.rows, pendingIds(this.data.outbox));
      this.data.lastFullSync = this.now().toISOString();
      await this.persist();
    }

    this.retryMs = RETRY_MIN_MS;
    this.setState('idle');
    if (this.data.outbox.length > 0) this.schedule(RETRY_MIN_MS);
  }

  /** Storage failed at start: try again, then put the changes made since on top of what's stored. */
  private async retryLoad(): Promise<void> {
    let stored: UserData;
    try {
      stored = await loadUserData(this.options.storage, this.options.userId);
    } catch {
      return;
    }
    if (this.stopped) return;
    // Merge in-memory records on top of stored (in-memory wins: it may have Realtime updates).
    const records = { ...stored.records, ...this.data.records };
    // Rebuild the outbox by replaying each in-memory op onto the stored outbox so that normal
    // enqueue folding applies: an edit after a stored delete is ignored; an edit to a stored
    // unattempted insert folds into it; etc.
    let outbox = stored.outbox;
    for (const op of this.data.outbox) {
      outbox = enqueue(outbox, op, new Set());
    }
    // Hide any event that has a delete op anywhere in the merged outbox.
    for (const op of outbox) {
      if (op.kind === 'delete') delete records[op.id];
    }
    this.data = { records, outbox, lastFullSync: stored.lastFullSync };
    this.loadFailed = false;
    await this.persist();
    this.emit();
  }

  private refreshDue(): boolean {
    const last = this.data.lastFullSync;
    return !last || this.now().getTime() - Date.parse(last) > REFRESH_AFTER_MS;
  }

  private fail(reason: 'network' | 'auth'): void {
    if (reason === 'auth') {
      // Wait for a fresh session: the provider calls setCanSync / sync when one arrives.
      this.setState('needs-sign-in');
      return;
    }
    this.setState('offline');
    this.schedule(this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, ms);
  }

  private subscribe(): void {
    this.channel = this.options.client
      .channel(`events-${this.options.userId}`)
      .on<Record<string, unknown>>('postgres_changes', { event: '*', schema: 'public', table: 'events' }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (this.stopped) return;
        this.data.records = applyRealtimeChange(
          this.data.records,
          { eventType: payload.eventType, new: payload.new, old: payload.old },
          pendingIds(this.data.outbox),
        );
        void this.persist();
        this.emit();
      })
      .subscribe(status => {
        // (Re)connected: catch up on anything missed while disconnected.
        if (status === 'SUBSCRIBED') void this.sync(true);
      });
  }

  private async changed(): Promise<boolean> {
    this.emit();
    const saved = await this.persist();
    void this.sync();
    return saved;
  }

  /** Save a snapshot. Resolves true when it reached storage. */
  private persist(): Promise<boolean> {
    return this.save({ records: { ...this.data.records }, outbox: [...this.data.outbox], lastFullSync: this.data.lastFullSync });
  }

  /** Save the given snapshot after any save already under way. Resolves true when it reached storage. */
  private save(snapshot: UserData): Promise<boolean> {
    if (this.cleared || this.stopped || this.loadFailed) return this.saving.then(() => false);
    this.saving = this.saving.then(() =>
      this.cleared
        ? false
        : saveUserData(this.options.storage, this.options.userId, snapshot).then(
            () => true,
            () => false,
          ),
    );
    return this.saving;
  }

  private setState(state: SyncState): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    if (this.stopped) return;
    const status: SyncStatus = { state: this.state, pending: this.data.outbox.length, lastSyncedAt: this.data.lastFullSync };
    if (this.refused > 0) status.refused = this.refused;
    this.options.onChange({ ...this.data.records }, status);
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date();
  }
}
