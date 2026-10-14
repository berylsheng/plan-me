import type { EventRecord } from '@/lib/events/rows';

import { summaryFor } from '../summary';

let n = 0;
const event = (overrides: Partial<EventRecord>): EventRecord => ({
  id: `e${++n}`, dateKey: '2026-10-15', name: 'Busy', startTime: '', endTime: '',
  ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null, ...overrides,
});

describe('summaryFor', () => {
  it('lists the day in time order, with untimed events last', () => {
    const records = [
      event({ name: 'Dinner' }),
      event({ name: 'Lunch with Bob', startTime: '12:30' }),
      event({ name: 'Swim', startTime: '07:00', endTime: '08:00' }),
      event({ name: 'Other day', dateKey: '2026-10-16', startTime: '09:00' }),
    ];
    expect(summaryFor('2026-10-15', records)).toEqual({
      title: 'Today: 3 events',
      body: '7:00 am Swim · 12:30 pm Lunch with Bob · Dinner',
    });
  });

  it('says 1 event for one', () => {
    expect(summaryFor('2026-10-15', [event({ name: 'Dentist', startTime: '09:15' })])).toEqual({
      title: 'Today: 1 event',
      body: '9:15 am Dentist',
    });
  });

  it('lists at most 6 and counts the rest', () => {
    const records = Array.from({ length: 8 }, (_, i) => event({ name: `Thing ${i + 1}`, startTime: `0${i + 1}:00` }));
    const summary = summaryFor('2026-10-15', records);
    expect(summary?.title).toBe('Today: 8 events');
    expect(summary?.body.split(' · ')).toHaveLength(7);
    expect(summary?.body.endsWith(' · +2 more')).toBe(true);
  });

  it('gives nothing for an empty day', () => {
    expect(summaryFor('2026-10-15', [event({ dateKey: '2026-10-16' })])).toBeNull();
  });
});
