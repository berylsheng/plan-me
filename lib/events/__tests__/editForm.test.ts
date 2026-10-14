import {
  type EventForm,
  formFromRecord,
  needsScope,
  planFormSave,
  ruleChanged,
  sameForm,
  seriesOf,
  validateForm,
  withDate,
} from '../editForm';
import { addDays, type RepeatRule } from '../repeat';
import type { EventRecord } from '../rows';

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: 'e1', dateKey: '2026-10-13', name: 'Swim', startTime: '07:00', endTime: '08:00',
  ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: '2026-10-12T00:00:00Z', ...overrides,
});
const WEEKLY: RepeatRule = { every: 1, unit: 'week', until: '2026-11-03' };
const DATES = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'];
const weekly = (repeat: RepeatRule | undefined = WEEKLY) =>
  DATES.map((dateKey, i) => event({ id: `s${i}`, dateKey, occurrenceId: 'series-1', repeat }));
/** Old-style series: occurrenceId set but no stored repeat rule (inferRule must supply it). */
const oldWeekly = () =>
  DATES.map((dateKey, i) => event({ id: `s${i}`, dateKey, occurrenceId: 'series-1' }));
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};
const open = (record: EventRecord, series: EventRecord[]) => {
  const initial = formFromRecord(record, series);
  return { initial, form: { ...initial } };
};

describe('formFromRecord', () => {
  it('fills in a single event', () => {
    expect(formFromRecord(event({ people: ['AZ'], memberIds: ['user-2'] }), [event()])).toEqual({
      name: 'Swim', dateKey: '2026-10-13', startTime: '07:00', endTime: '08:00',
      repeat: 'none', customEvery: '1', customUnit: 'week', until: '',
      memberIds: ['user-2'], legacyTags: ['AZ'], shared: false,
    });
  });

  it('fills in the rule of a series', () => {
    const series = weekly();
    expect(formFromRecord(series[1], series)).toMatchObject({ repeat: 'weekly', until: '2026-11-03' });
  });

  it('works out the rule of an old series with a deleted occurrence', () => {
    const series = oldWeekly().filter(r => r.id !== 's1');
    expect(formFromRecord(series[0], series)).toMatchObject({ repeat: 'weekly', until: '2026-11-03' });
  });

  it('finds the series of an event, sorted by date', () => {
    const [s0, s1, s2, s3] = weekly();
    const records = { s2, s0, s3, s1, other: event({ id: 'other' }) };
    expect(seriesOf(records, s1).map(r => r.id)).toEqual(['s0', 's1', 's2', 's3']);
    expect(seriesOf(records, records.other)).toEqual([records.other]);
  });
});

describe('validateForm', () => {
  const valid = formFromRecord(event(), [event()]);

  it('accepts a valid form', () => {
    expect(validateForm(valid)).toEqual({});
  });

  it.each<[string, Partial<EventForm>, Record<string, string>]>([
    ['no name', { name: '  ' }, { name: 'Enter a name.' }],
    ['a long name', { name: 'x'.repeat(201) }, { name: 'Use at most 200 characters.' }],
    ['an end without a start', { startTime: '', endTime: '08:00' }, { endTime: 'Add a start time first.' }],
    ['an end before the start', { startTime: '09:00', endTime: '08:00' }, { endTime: 'End after the start time.' }],
    ['custom every 0', { repeat: 'custom', customEvery: '0', until: '2026-11-03' }, { customEvery: 'Enter a number from 1 to 99.' }],
    ['custom every abc', { repeat: 'custom', customEvery: 'abc', until: '2026-11-03' }, { customEvery: 'Enter a number from 1 to 99.' }],
    ['no end date', { repeat: 'weekly', until: '' }, { until: 'Choose an end date.' }],
    ['an end before the date', { repeat: 'weekly', until: '2026-10-12' }, { until: "End on or after the event's date." }],
    ['an end more than a year on', { repeat: 'weekly', until: '2027-10-14' }, { until: 'End within a year of the event.' }],
  ])('rejects %s', (_label, change, errors) => {
    expect(validateForm({ ...valid, ...change })).toEqual(errors);
  });
});

describe('validateForm: an old series longer than a year', () => {
  // Made before the one-year limit: weekly for 18 months, with no stored rule.
  const dates = Array.from({ length: 78 }, (_, i) => addDays('2026-10-13', i * 7));
  const old = dates.map((dateKey, i) => event({ id: `o${i}`, dateKey, occurrenceId: 'series-old' }));

  it('can still be renamed, and saves in place', () => {
    const { initial, form } = open(old[0], old);
    expect(initial).toMatchObject({ repeat: 'weekly', until: dates[77] });
    const renamed = { ...form, name: 'Swim club' };
    expect(validateForm(renamed, initial)).toEqual({});
    const plan = planFormSave({ form: renamed, initial, record: old[0], series: old, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(78);
  });

  it('can be moved to another date with its end date', () => {
    const { initial, form } = open(old[0], old);
    expect(validateForm(withDate(form, '2026-10-14'), initial)).toEqual({});
  });

  it('still has to end within a year when its end date changes', () => {
    const { initial, form } = open(old[0], old);
    expect(validateForm({ ...form, until: addDays(dates[77], -7) }, initial)).toEqual({ until: 'End within a year of the event.' });
    expect(validateForm({ ...form, repeat: 'fortnightly' }, initial)).toEqual({ until: 'End within a year of the event.' });
  });
});

describe('form helpers', () => {
  it('moves the end date with the date', () => {
    const series = weekly();
    const { form } = open(series[1], series);
    expect(withDate(form, '2026-10-21')).toMatchObject({ dateKey: '2026-10-21', until: '2026-11-04' });
  });

  it('treats member order and hidden custom fields as no change', () => {
    const { initial } = open(event({ memberIds: ['a', 'b'] }), [event()]);
    expect(sameForm(initial, { ...initial, memberIds: ['b', 'a'], customEvery: '5' })).toBe(true);
    expect(sameForm(initial, { ...initial, name: 'Swim club' })).toBe(false);
  });

  it('only counts a new repeat or end date as a rule change', () => {
    const series = weekly();
    const { initial, form } = open(series[1], series);
    expect(ruleChanged(withDate(form, '2026-10-21'), initial)).toBe(false);
    expect(ruleChanged({ ...form, until: '2026-10-27' }, initial)).toBe(true);
    expect(ruleChanged({ ...form, repeat: 'fortnightly' }, initial)).toBe(true);
  });

  it('asks which events to change only when later ones exist and the rule stays', () => {
    const series = weekly();
    const { initial, form } = open(series[1], series);
    expect(needsScope(series[1], series, { ...form, name: 'Swim club' }, initial)).toBe(true);
    expect(needsScope(series[1], series, { ...form, repeat: 'fortnightly' }, initial)).toBe(false);
    expect(needsScope(series[3], series, { ...form, name: 'Swim club' }, initial)).toBe(false);
    expect(needsScope(event(), [event()], { ...form, name: 'Swim club' }, initial)).toBe(false);
  });
});

describe('planFormSave: a single event', () => {
  it('updates the event in place', () => {
    const { initial, form } = open(event(), [event()]);
    const plan = planFormSave({ form: { ...form, name: 'Swim club', shared: true }, initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: 'e1', name: 'Swim club', visibility: 'shared', occurrenceId: undefined, repeat: undefined });
  });

  it('moves it to another date in place, without making a series', () => {
    const { initial, form } = open(event(), [event()]);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    expect(plan).toEqual({ remove: [], update: [expect.objectContaining({ id: 'e1', dateKey: '2026-10-21', occurrenceId: undefined, repeat: undefined })], create: [] });
  });

  it("a repeat that ends on the event's own date is the same as not repeating", () => {
    const { initial, form } = open(event(), [event()]);
    const once = { ...form, repeat: 'weekly' as const, until: '2026-10-13' };
    expect(validateForm(once, initial)).toEqual({});
    const plan = planFormSave({ form: once, initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    expect(plan).toEqual({ remove: [], update: [expect.objectContaining({ id: 'e1', occurrenceId: undefined, repeat: undefined })], create: [] });
  });

  it('turns it into a series when a repeat is chosen', () => {
    const { initial, form } = open(event(), [event()]);
    const plan = planFormSave({ form: { ...form, repeat: 'weekly', until: '2026-10-27' }, initial, record: event(), series: [event()], scope: 'this', newId: ids() });
    const rule = { every: 1, unit: 'week', until: '2026-10-27' };
    expect(plan.update).toEqual([expect.objectContaining({ id: 'e1', dateKey: '2026-10-13', occurrenceId: 'new-1', repeat: rule })]);
    expect(plan.create.map(e => [e.id, e.dateKey, e.occurrenceId])).toEqual([
      ['new-2', '2026-10-20', 'new-1'],
      ['new-3', '2026-10-27', 'new-1'],
    ]);
    expect(plan.create[0]).toMatchObject({ name: 'Swim', startTime: '07:00', repeat: rule });
  });
});

describe('planFormSave: one occurrence of a series', () => {
  const series = weekly();
  const record = series[1];

  it('this event only: updates it and keeps it in the series', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record, series, scope: 'this', newId: ids() });
    expect(plan.update).toEqual([expect.objectContaining({ id: 's1', name: 'Swim club', occurrenceId: 'series-1', repeat: WEEKLY })]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('this event only, on a new date: it leaves the series', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record, series, scope: 'this', newId: ids() });
    expect(plan.update).toEqual([expect.objectContaining({ id: 's1', dateKey: '2026-10-21', occurrenceId: undefined, repeat: undefined })]);
  });

  it('this and all future: updates this and later ones in place, not earlier ones', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, name: 'Swim club', startTime: '06:30' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.update.map(e => [e.id, e.name, e.startTime])).toEqual([
      ['s1', 'Swim club', '06:30'],
      ['s2', 'Swim club', '06:30'],
      ['s3', 'Swim club', '06:30'],
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('this and all future, on a new date: moves them all and ends the earlier run the day before', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record, series, scope: 'future', newId: ids() });
    const moved = { every: 1, unit: 'week', until: '2026-11-04' };
    expect(plan.update.map(e => [e.id, e.dateKey, e.repeat, e.occurrenceId])).toEqual([
      ['s1', '2026-10-21', moved, 'new-1'],
      ['s2', '2026-10-28', moved, 'new-1'],
      ['s3', '2026-11-04', moved, 'new-1'],
      ['s0', '2026-10-13', { every: 1, unit: 'week', until: '2026-10-19' }, 'series-1'],
    ]);
  });

  it('after a date move, seriesOf sees the earlier and moved runs as separate', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: withDate(form, '2026-10-21'), initial, record, series, scope: 'future', newId: ids() });
    const updated: Record<string, EventRecord> = {};
    for (const r of series) updated[r.id] = r;
    for (const u of plan.update) updated[u.id] = { ...updated[u.id], ...u } as EventRecord;
    expect(seriesOf(updated, updated.s0).map(r => r.id)).toEqual(['s0']);
  });

  it('a new repeat replaces this and later occurrences', () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, repeat: 'fortnightly' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual(['s1', 's2', 's3']);
    expect(plan.update).toEqual([expect.objectContaining({ id: 's0', repeat: { every: 1, unit: 'week', until: '2026-10-19' } })]);
    expect(plan.create.map(e => [e.id, e.dateKey, e.occurrenceId])).toEqual([
      ['new-2', '2026-10-20', 'new-1'],
      ['new-3', '2026-11-03', 'new-1'],
    ]);
    expect(plan.create[0].repeat).toEqual({ every: 2, unit: 'week', until: '2026-11-03' });
  });

  it("doesn't repeat: removes later occurrences and takes this one out of the series", () => {
    const { initial, form } = open(record, series);
    const plan = planFormSave({ form: { ...form, repeat: 'none' }, initial, record, series, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual(['s2', 's3']);
    expect(plan.update).toEqual([
      expect.objectContaining({ id: 's1', occurrenceId: undefined, repeat: undefined }),
      expect.objectContaining({ id: 's0', repeat: { every: 1, unit: 'week', until: '2026-10-19' } }),
    ]);
    expect(plan.create).toEqual([]);
  });

  it("a repeat that ends on this event's date takes it out of the series, like not repeating", () => {
    const series = weekly();
    const { initial, form } = open(series[1], series);
    const once = planFormSave({ form: { ...form, until: '2026-10-20' }, initial, record: series[1], series, scope: 'future', newId: ids() });
    const none = planFormSave({ form: { ...form, repeat: 'none' }, initial, record: series[1], series, scope: 'future', newId: ids() });
    expect(once).toEqual(none);
    expect(once.remove).toEqual(['s2', 's3']);
    expect(once.update[0]).toMatchObject({ id: 's1', occurrenceId: undefined, repeat: undefined });
  });

  it('renaming an old series without a rule changes nothing else', () => {
    const old = oldWeekly();
    const { initial, form } = open(old[1], old);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record: old[1], series: old, scope: 'future', newId: ids() });
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update.map(e => e.id)).toEqual(['s1', 's2', 's3']);
    expect(plan.update.every(e => e.repeat === undefined)).toBe(true);
  });

  it("a rule change with scope 'this' still applies to this and all future", () => {
    const { initial, form } = open(record, series);
    const changed = { ...form, repeat: 'fortnightly' as const };
    const planFuture = planFormSave({ form: changed, initial, record, series, scope: 'future', newId: ids() });
    const planThis = planFormSave({ form: changed, initial, record, series, scope: 'this', newId: ids() });
    expect(planThis.remove).toEqual(planFuture.remove);
    expect(planThis.create.map(e => e.dateKey)).toEqual(planFuture.create.map(e => e.dateKey));
  });

  it("keeps the creator and anyone it can't show when a family member edits", () => {
    const shared = weekly().map(r => ({ ...r, ownerId: 'user-2', visibility: 'shared' as const, memberIds: ['former-member'] }));
    const { initial, form } = open(shared[1], shared);
    const plan = planFormSave({ form: { ...form, name: 'Swim club' }, initial, record: shared[1], series: shared, scope: 'future', newId: ids() });
    expect(plan.update.every(e => (e as EventRecord).ownerId === 'user-2' && e.memberIds?.includes('former-member'))).toBe(true);
  });
});
