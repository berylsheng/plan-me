import { draftToEvents, migrateStoredItems, sortItems } from '../items';
import type { LocalEvent } from '../types';

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const event = (overrides: Partial<LocalEvent>): LocalEvent => ({
  id: 'x', dateKey: '2026-10-12', name: 'dancing', startTime: '', endTime: '', ...overrides,
});

describe('sortItems', () => {
  it('orders dates, then events by start time and end time, untimed first', () => {
    const sorted = sortItems({
      '2026-10-07': [
        event({ id: 'b', startTime: '10:00' }),
        event({ id: 'a' }),
        event({ id: 'c', startTime: '09:00', endTime: '11:00' }),
        event({ id: 'd', startTime: '09:00', endTime: '10:00' }),
      ],
      '2026-10-06': [],
    });
    expect(Object.keys(sorted)).toEqual(['2026-10-06', '2026-10-07']);
    expect(sorted['2026-10-07'].map(e => e.id)).toEqual(['a', 'd', 'c', 'b']);
  });
});

describe('migrateStoredItems', () => {
  it('upgrades the oldest shape: no id, a single time field, tags inside the name', () => {
    expect(migrateStoredItems({ '2026-10-06': [{ time: '09:00-10:00', name: 'gym @AZ' }] }, counter())).toEqual({
      '2026-10-06': [{
        id: 'id-1', dateKey: '2026-10-06', name: 'gym', startTime: '09:00', endTime: '10:00', people: ['AZ'],
      }],
    });
  });

  it('leaves current events alone', () => {
    const current = event({ id: 'keep', dateKey: '2026-10-07', name: 'swim', startTime: '07:00', people: ['GS'], occurrenceId: '1_occ' });
    expect(migrateStoredItems({ '2026-10-07': [current] }, counter())).toEqual({ '2026-10-07': [current] });
  });

  it('copes with a missing name and adds no people when there are no tags', () => {
    const [migrated] = migrateStoredItems({ '2026-10-06': [{ id: 'y', startTime: '', endTime: '' }] }, counter())['2026-10-06'];
    expect(migrated).toEqual({ id: 'y', dateKey: '2026-10-06', name: '', startTime: '', endTime: '' });
    expect(migrated).not.toHaveProperty('people');
  });
});

describe('draftToEvents', () => {
  const draft = {
    name: 'swim', startTime: '07:00', endTime: '', people: [] as string[],
    dateKeys: ['2026-10-13', '2026-10-20'], isRecurring: true, repeat: null,
  };

  it('makes one event per date, all sharing the series id', () => {
    expect(draftToEvents(draft, counter(), 's1')).toEqual([
      { id: 'id-1', dateKey: '2026-10-13', name: 'swim', startTime: '07:00', endTime: '', occurrenceId: 's1' },
      { id: 'id-2', dateKey: '2026-10-20', name: 'swim', startTime: '07:00', endTime: '', occurrenceId: 's1' },
    ]);
  });

  it('adds people and leaves out occurrenceId for a one-off event', () => {
    const [one] = draftToEvents({ ...draft, people: ['AZ'], dateKeys: ['2026-10-13'], isRecurring: false }, counter(), null);
    expect(one.people).toEqual(['AZ']);
    expect(one).not.toHaveProperty('occurrenceId');
  });

  it('puts the rule on each occurrence of a series', () => {
    const rule = { every: 1, unit: 'week', until: '2026-10-20' } as const;
    const events = draftToEvents(
      { name: 'swim', startTime: '07:00', endTime: '', people: [], dateKeys: ['2026-10-13', '2026-10-20'], isRecurring: true, repeat: rule },
      counter(),
      's1',
    );
    expect(events.map(e => e.repeat)).toEqual([rule, rule]);
  });
});

