import { enqueue, isOutboxOp, type OutboxOp, pendingIds } from '../outbox';
import type { EventRecord } from '../rows';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const record = (id: string, name = 'Swim'): EventRecord => ({
  id,
  dateKey: '2026-11-03',
  name,
  startTime: '',
  endTime: '',
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: null,
});
const insert = (id: string, opId = `i-${id}`, attempted?: boolean): OutboxOp => ({ opId, kind: 'insert', record: record(id), attempted });
const update = (id: string, name: string, opId = `u-${id}`): OutboxOp => ({ opId, kind: 'update', record: record(id, name) });
const remove = (id: string, opId = `d-${id}`): OutboxOp => ({ opId, kind: 'delete', id, deletedAt: '2026-10-09T00:00:00.000Z' });

describe('enqueue', () => {
  it('appends changes to different events', () => {
    expect(enqueue([insert(A)], insert(B))).toEqual([insert(A), insert(B)]);
  });

  it('folds an edit into the queued create, which stays a create', () => {
    expect(enqueue([insert(A)], update(A, 'Swim lesson'))).toEqual([{ ...insert(A), record: record(A, 'Swim lesson') }]);
  });

  it('keeps only the latest edit', () => {
    expect(enqueue([update(A, 'one')], update(A, 'two', 'u2'))).toEqual([update(A, 'two')]);
  });

  it('drops a create that never reached the server when the event is deleted', () => {
    expect(enqueue([insert(A), insert(B)], remove(A))).toEqual([insert(B)]);
  });

  it('keeps the delete when the create was already attempted', () => {
    expect(enqueue([insert(A, 'i-a', true)], remove(A))).toEqual([remove(A)]);
  });

  it('turns a queued edit into the delete', () => {
    expect(enqueue([update(A, 'one')], remove(A))).toEqual([remove(A)]);
  });

  it('ignores edits and repeat deletes after a delete', () => {
    expect(enqueue([remove(A)], update(A, 'late'))).toEqual([remove(A)]);
    expect(enqueue([remove(A)], remove(A, 'd2'))).toEqual([remove(A)]);
  });

  it('never folds into a change that is being sent right now', () => {
    expect(enqueue([insert(A)], update(A, 'later'), new Set([`i-${A}`]))).toEqual([insert(A), update(A, 'later')]);
    expect(enqueue([insert(A)], remove(A), new Set([`i-${A}`]))).toEqual([insert(A), remove(A)]);
  });

  it('edit after an attempted insert appends an update', () => {
    expect(enqueue([insert(A, 'i-A', true)], update(A, 'v2'))).toEqual([insert(A, 'i-A', true), update(A, 'v2')]);
  });

  it('latest op wins when there are multiple ops for the same event', () => {
    expect(enqueue([insert(A), update(A, 'v2')], update(A, 'v3'))).toEqual([insert(A), update(A, 'v3')]);
  });

  it('delete cleans up all queued ops for the event', () => {
    expect(enqueue([insert(A, 'i-A', true), update(A, 'v2')], remove(A))).toEqual([remove(A)]);
    expect(enqueue([insert(A), update(A, 'v2')], remove(A))).toEqual([]);
  });

  it('delete keeps in-flight ops for the event', () => {
    expect(enqueue([insert(A, 'i-A'), update(A, 'v2')], remove(A), new Set(['i-A']))).toEqual([insert(A, 'i-A'), remove(A)]);
  });
});

describe('pendingIds and isOutboxOp', () => {
  it('lists the events with queued changes', () => {
    expect(pendingIds([insert(A), remove(B)])).toEqual(new Set([A, B]));
  });

  it('accepts real ops and rejects damaged ones', () => {
    expect(isOutboxOp(insert(A))).toBe(true);
    expect(isOutboxOp(remove(A))).toBe(true);
    expect(isOutboxOp({ opId: 'x', kind: 'insert', record: { id: 'a' } })).toBe(false);
    expect(isOutboxOp({ opId: 'x', kind: 'wipe' })).toBe(false);
    expect(isOutboxOp(null)).toBe(false);
    expect(isOutboxOp({ opId: 'x', kind: 'delete', id: 'not-a-uuid', deletedAt: '2026-10-09T00:00:00.000Z' })).toBe(false);
  });
});
