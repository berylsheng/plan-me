import type { EventRecord } from '@/lib/events/rows';

import { plannedSummaries } from '../schedule';

const event = (id: string, dateKey: string, name: string, startTime = ''): EventRecord => ({
  id, dateKey, name, startTime, endTime: '', ownerId: 'user-1', visibility: 'personal', memberIds: [], updatedAt: null,
});
const records = Object.fromEntries(
  [
    event('a', '2026-10-14', 'Swim', '07:30'),
    event('b', '2026-10-15', 'Gym', '06:00'),
    event('c', '2026-10-27', 'Last day in range'),
    event('d', '2026-10-28', 'Out of range'),
  ].map(r => [r.id, r]),
);

describe('plannedSummaries', () => {
  it('plans the days with events over the next 14 days, at the chosen time', () => {
    const planned = plannedSummaries(records, { time: '07:00', now: new Date(2026, 9, 14, 6, 0) });
    expect(planned.map(p => p.dateKey)).toEqual(['2026-10-14', '2026-10-15', '2026-10-27']);
    const first = planned[0].fireAt;
    expect([first.getFullYear(), first.getMonth(), first.getDate(), first.getHours(), first.getMinutes()]).toEqual([2026, 9, 14, 7, 0]);
    expect(planned[1]).toMatchObject({ title: 'Today: 1 event', body: '6:00 am Gym' });
  });

  it("skips today once today's time has passed", () => {
    const planned = plannedSummaries(records, { time: '07:00', now: new Date(2026, 9, 14, 7, 0) });
    expect(planned.map(p => p.dateKey)).toEqual(['2026-10-15', '2026-10-27']);
  });

  it('uses the chosen time', () => {
    const [first] = plannedSummaries(records, { time: '06:45', now: new Date(2026, 9, 14, 5, 0) });
    expect([first.fireAt.getHours(), first.fireAt.getMinutes()]).toEqual([6, 45]);
  });

  it('plans nothing without events', () => {
    expect(plannedSummaries({}, { time: '07:00', now: new Date(2026, 9, 14, 6, 0) })).toEqual([]);
  });
});
