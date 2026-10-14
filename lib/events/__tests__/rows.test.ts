import {
  type EventRecord,
  type EventRow,
  insertPayload,
  isEventRecord,
  isEventRow,
  newRecord,
  recordFromRow,
  recordsFromLegacy,
  recordsToItems,
  updatePayload,
} from '../rows';

const SERIES = '11111111-1111-4111-8111-111111111111';

const row = (overrides: Partial<EventRow> = {}): EventRow => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner_id: 'user-1',
  family_id: null,
  visibility: 'personal',
  title: 'Swim',
  date: '2026-11-03',
  start_time: '07:00:00',
  end_time: null,
  people: [],
  legacy_people: ['AZ'],
  series_id: SERIES,
  updated_at: '2026-10-09T01:02:03.456789+00:00',
  deleted_at: null,
  ...overrides,
});

const record = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '07:00',
  endTime: '',
  people: ['AZ'],
  occurrenceId: SERIES,
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds: [],
  updatedAt: '2026-10-09T01:02:03.456789+00:00',
  ...overrides,
});

describe('recordFromRow', () => {
  it('maps columns to planner fields', () => {
    expect(recordFromRow(row())).toEqual(record());
  });

  it('leaves out empty tags and series', () => {
    const mapped = recordFromRow(row({ legacy_people: [], series_id: null, end_time: '08:30:00' }));
    expect(mapped).not.toHaveProperty('people');
    expect(mapped).not.toHaveProperty('occurrenceId');
    expect(mapped.endTime).toBe('08:30');
  });
});

describe('payloads', () => {
  it('sends every column the client may set on insert', () => {
    expect(insertPayload(record())).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      owner_id: 'user-1',
      visibility: 'personal',
      title: 'Swim',
      date: '2026-11-03',
      start_time: '07:00:00',
      end_time: null,
      people: [],
      legacy_people: ['AZ'],
      series_id: SERIES,
      repeat: null,
    });
  });

  it('never changes id or owner on update', () => {
    const payload = updatePayload(record({ name: 'Swim lesson' }));
    expect(payload).toEqual({
      title: 'Swim lesson',
      date: '2026-11-03',
      start_time: '07:00:00',
      end_time: null,
      visibility: 'personal',
      people: [],
      legacy_people: ['AZ'],
      series_id: SERIES,
      repeat: null,
    });
  });

  it('gives an empty name a title and cuts long ones to 200 characters', () => {
    expect(insertPayload(record({ name: '   ' })).title).toBe('Busy');
    expect(insertPayload(record({ name: 'x'.repeat(250) })).title).toHaveLength(200);
  });

  it('drops a series id that is not a UUID (old app versions)', () => {
    expect(insertPayload(record({ occurrenceId: '1696500000000_occ' })).series_id).toBeNull();
  });

  it('handles emoji without splitting surrogates', () => {
    const payload = insertPayload(record({ name: 'x'.repeat(199) + '😀😀' }));
    expect(payload.title).toBe('x'.repeat(199) + '😀');
  });

  it('rejects invalid times like 99:59', () => {
    expect(insertPayload(record({ startTime: '99:59' })).start_time).toBeNull();
  });

  it('accepts valid times like 23:59', () => {
    expect(insertPayload(record({ startTime: '23:59' })).start_time).toBe('23:59:00');
  });
});

describe('guards', () => {
  it('accepts real rows and records', () => {
    expect(isEventRow(row())).toBe(true);
    expect(isEventRecord(record())).toBe(true);
  });

  it.each([null, 'x', {}, { ...row(), visibility: 'public' }, { ...row(), people: [1] }])('rejects bad row %#', value => {
    expect(isEventRow(value)).toBe(false);
  });

  it.each([
    { ...record(), dateKey: '3/11/2026' },
    { ...record(), memberIds: undefined },
    { ...record(), people: 'AZ' },
    { ...record(), id: '1696500000000abc' },
  ])("rejects bad record %#", value => {
    expect(isEventRecord(value)).toBe(false);
  });
});

describe('recordsToItems', () => {
  it('groups by date and sorts each day', () => {
    const early = record({ id: 'b', startTime: '06:00' });
    const late = record({ id: 'a', startTime: '09:00' });
    const other = record({ id: 'c', dateKey: '2026-11-01' });
    expect(recordsToItems({ a: late, b: early, c: other })).toEqual({ '2026-11-01': [other], '2026-11-03': [early, late] });
  });
});

describe('newRecord', () => {
  it('makes a personal, unsynced record owned by the user', () => {
    expect(newRecord({ id: 'x', dateKey: '2026-11-03', name: 'Gym', startTime: '', endTime: '' }, 'user-1')).toEqual({
      id: 'x',
      dateKey: '2026-11-03',
      name: 'Gym',
      startTime: '',
      endTime: '',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    });
  });
});

describe('recordsFromLegacy', () => {
  it('gives every event a new id and one new series id per old occurrence id', () => {
    let n = 0;
    const newId = () => `id-${++n}`;
    const out = recordsFromLegacy(
      {
        '2026-11-03': [
          { id: 'old1', dateKey: '2026-11-03', name: 'Swim', startTime: '07:00', endTime: '', occurrenceId: '169_occ', people: ['GS'] },
        ],
        '2026-11-10': [{ id: 'old2', dateKey: '2026-11-10', name: 'Swim', startTime: '07:00', endTime: '', occurrenceId: '169_occ' }],
        '2026-11-11': [{ id: 'old3', dateKey: '2026-11-11', name: '', startTime: '7am', endTime: '', occurrenceId: undefined }],
        'not-a-date': [{ id: 'old4', dateKey: 'not-a-date', name: 'Lost', startTime: '', endTime: '' }],
      },
      'user-1',
      newId,
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      id: 'id-2',
      dateKey: '2026-11-03',
      name: 'Swim',
      startTime: '07:00',
      endTime: '',
      people: ['GS'],
      occurrenceId: 'id-1',
      ownerId: 'user-1',
      visibility: 'personal',
      memberIds: [],
      updatedAt: null,
    });
    expect(out[1].occurrenceId).toBe('id-1');
    expect(out[2]).toMatchObject({ name: 'Busy', startTime: '' });
    expect(out[2]).not.toHaveProperty('occurrenceId');
  });

  it('converts invalid times like 25:00 to empty string', () => {
    let n = 0;
    const newId = () => `id-${++n}`;
    const out = recordsFromLegacy(
      {
        '2026-11-03': [{ id: 'old1', dateKey: '2026-11-03', name: 'Event', startTime: '25:00', endTime: '' }],
      },
      'user-1',
      newId,
    );
    expect(out[0].startTime).toBe('');
  });
});

describe('sharing', () => {
  const event = { id: '8f9a3c3e-1f0b-4c56-9f1e-2b8d3a4c5e6f', dateKey: '2026-11-03', name: 'Dinner', startTime: '18:00', endTime: '' };

  it('makes new events personal unless told otherwise', () => {
    expect(newRecord(event, 'user-1')).toMatchObject({ visibility: 'personal', memberIds: [] });
    expect(newRecord({ ...event, visibility: 'shared', memberIds: ['user-2'] }, 'user-1')).toMatchObject({
      visibility: 'shared',
      memberIds: ['user-2'],
      ownerId: 'user-1',
    });
  });

  it('sends visibility with an edit, so the creator can share or unshare', () => {
    const record = newRecord({ ...event, visibility: 'shared' }, 'user-1');
    expect(updatePayload(record)).toMatchObject({ visibility: 'shared' });
    expect(insertPayload(record)).toMatchObject({ id: event.id, owner_id: 'user-1', visibility: 'shared' });
  });
});

describe('repeat rules', () => {
  const rule = { every: 1, unit: 'week', until: '2026-11-24' } as const;
  const series = '11111111-2222-4333-8444-555555555555';

  it('reads the rule of a series', () => {
    expect(recordFromRow({ ...row(), series_id: series, repeat: rule }).repeat).toEqual(rule);
  });

  it('ignores a rule without a series', () => {
    expect(recordFromRow({ ...row(), series_id: null, repeat: rule }).repeat).toBeUndefined();
  });

  it('sends the rule with the series, and null without one', () => {
    expect(updatePayload({ ...record(), occurrenceId: series, repeat: rule }).repeat).toEqual(rule);
    expect(updatePayload({ ...record(), occurrenceId: undefined, repeat: rule }).repeat).toBeNull();
  });

  it('rejects a stored record with a broken rule', () => {
    expect(isEventRecord({ ...record(), repeat: { every: 0, unit: 'week', until: '2026-11-24' } })).toBe(false);
    expect(isEventRow({ ...row(), repeat: 'weekly' })).toBe(false);
    expect(isEventRow({ ...row(), repeat: null })).toBe(true);
  });
});
