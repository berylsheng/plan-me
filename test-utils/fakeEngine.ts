import type { EventRecord } from '@/lib/events/rows';
import type { EventChanges, SyncEngineLike, SyncEngineOptions } from '@/lib/events/syncEngine';

/** Records every call; tests drive what the app sees through `options.onChange`. */
export class FakeEngine implements SyncEngineLike {
  static instances: FakeEngine[] = [];
  static reset() {
    FakeEngine.instances = [];
  }
  stopped = false;
  canSync: boolean;
  created: EventRecord[][] = [];
  updated: EventRecord[] = [];
  removed: string[][] = [];
  syncs: boolean[] = [];
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
  async sync(refresh = false) {
    this.syncs.push(refresh);
  }
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
  /** Set to control what apply does (emit records, wait, throw); otherwise it returns applyResult. */
  applyImpl: ((changes: EventChanges) => Promise<boolean>) | null = null;
  async apply(changes: EventChanges) {
    this.applied.push(changes);
    return this.applyImpl ? this.applyImpl(changes) : this.applyResult;
  }
}

export const createFakeEngine = (options: SyncEngineOptions) => new FakeEngine(options);
