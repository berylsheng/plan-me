import { applyRealtimeChange, mergeFullFetch } from '../merge';
import { type EventRecord, type EventRow, recordFromRow } from '../rows';

const row = (id: string, overrides: Partial<EventRow> = {}): EventRow => ({
  id,
  owner_id: 'user-1',
  family_id: null,
  visibility: 'personal',
  title: 'Server',
  date: '2026-11-03',
  start_time: null,
  end_time: null,
  people: [],
  legacy_people: [],
  series_id: null,
  updated_at: '2026-10-09T01:00:00.000000+00:00',
  deleted_at: null,
  ...overrides,
});
const local = (id: string, name: string, updatedAt: string | null = null): EventRecord => ({
  ...recordFromRow(row(id)),
  name,
  updatedAt,
});

describe('mergeFullFetch', () => {
  it("takes the server's rows and drops ones the server no longer returns", () => {
    const merged = mergeFullFetch({ gone: local('gone', 'Old') }, [row('a')], new Set());
    expect(Object.keys(merged)).toEqual(['a']);
    expect(merged.a.name).toBe('Server');
  });

  it("keeps your unsent version of an event over the server's", () => {
    const merged = mergeFullFetch({ a: local('a', 'Mine') }, [row('a')], new Set(['a']));
    expect(merged.a.name).toBe('Mine');
  });

  it('keeps unsent new events the server has not seen yet', () => {
    expect(mergeFullFetch({ n: local('n', 'New') }, [], new Set(['n'])).n.name).toBe('New');
  });

  it('does not bring back an event you deleted that is still queued', () => {
    expect(mergeFullFetch({}, [row('d')], new Set(['d']))).toEqual({});
  });
});

describe('applyRealtimeChange', () => {
  const t1 = '2026-10-09T01:00:00.000000+00:00';
  const t2 = '2026-10-09T02:00:00.000000+00:00';

  it('adds a new event from another device', () => {
    const next = applyRealtimeChange({}, { eventType: 'INSERT', new: row('a'), old: {} }, new Set());
    expect(next.a.name).toBe('Server');
  });

  it('applies a newer save and ignores an older one', () => {
    const current = { a: local('a', 'Current', t1) };
    expect(applyRealtimeChange(current, { eventType: 'UPDATE', new: row('a', { title: 'Newer', updated_at: t2 }), old: {} }, new Set()).a.name).toBe('Newer');
    const newer = { a: local('a', 'Current', t2) };
    expect(applyRealtimeChange(newer, { eventType: 'UPDATE', new: row('a', { title: 'Older', updated_at: t1 }), old: {} }, new Set())).toBe(newer);
  });

  it('removes an event that was deleted', () => {
    const current = { a: local('a', 'Current', t1) };
    expect(applyRealtimeChange(current, { eventType: 'UPDATE', new: row('a', { deleted_at: t2, updated_at: t2 }), old: {} }, new Set())).toEqual({});
    expect(applyRealtimeChange(current, { eventType: 'DELETE', new: {}, old: { id: 'a' } }, new Set())).toEqual({});
  });

  it('leaves events with unsent changes alone', () => {
    const current = { a: local('a', 'Mine', t1) };
    expect(applyRealtimeChange(current, { eventType: 'UPDATE', new: row('a', { title: 'Theirs', updated_at: t2 }), old: {} }, new Set(['a']))).toBe(current);
  });

  it('ignores a malformed message', () => {
    const current = { a: local('a', 'Mine', t1) };
    expect(applyRealtimeChange(current, { eventType: 'INSERT', new: { id: 'b', title: 5 }, old: {} }, new Set())).toBe(current);
  });
});
