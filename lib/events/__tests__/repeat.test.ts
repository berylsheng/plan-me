import {
  addDays,
  addMonths,
  daysBetween,
  inferRule,
  isRepeatRule,
  latestUntil,
  occurrenceDates,
  presetOf,
} from '../repeat';

describe('date key arithmetic', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('keeps the day of month, or the last day when the month is shorter', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2027-01-31', 2)).toBe('2027-03-31');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('counts days between two dates, ignoring daylight saving', () => {
    expect(daysBetween('2026-09-26', '2026-09-28')).toBe(2); // NZ daylight saving starts 27/09/2026
    expect(daysBetween('2026-10-20', '2026-10-13')).toBe(-7);
  });

  it('allows a series to run for at most a year', () => {
    expect(latestUntil('2026-10-13')).toBe('2027-10-13');
  });
});

describe('isRepeatRule', () => {
  it('accepts a rule', () => {
    expect(isRepeatRule({ every: 2, unit: 'week', until: '2026-12-01' })).toBe(true);
  });

  it.each([
    ['every 0', { every: 0, unit: 'week', until: '2026-12-01' }],
    ['every 100', { every: 100, unit: 'week', until: '2026-12-01' }],
    ['every 1.5', { every: 1.5, unit: 'week', until: '2026-12-01' }],
    ['unit year', { every: 1, unit: 'year', until: '2026-12-01' }],
    ['until 30 February', { every: 1, unit: 'week', until: '2026-02-30' }],
    ['no until', { every: 1, unit: 'week' }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isRepeatRule(value)).toBe(false);
  });
});

describe('occurrenceDates', () => {
  it('starts on the first date and includes the end date', () => {
    expect(occurrenceDates('2026-10-13', { every: 1, unit: 'week', until: '2026-11-03' })).toEqual([
      '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03',
    ]);
  });

  it('steps every N days', () => {
    expect(occurrenceDates('2026-10-13', { every: 3, unit: 'day', until: '2026-10-21' })).toEqual([
      '2026-10-13', '2026-10-16', '2026-10-19',
    ]);
  });

  it('keeps month-end dates on the last day of shorter months, without skipping one', () => {
    expect(occurrenceDates('2027-01-31', { every: 1, unit: 'month', until: '2027-04-30' })).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    ]);
  });

  it('stops a year after the first date', () => {
    const dates = occurrenceDates('2026-10-13', { every: 1, unit: 'day', until: '2028-10-13' });
    expect(dates).toHaveLength(366);
    expect(dates[dates.length - 1]).toBe('2027-10-13');
  });

  it('gives nothing when the end is before the start', () => {
    expect(occurrenceDates('2026-10-13', { every: 1, unit: 'week', until: '2026-10-12' })).toEqual([]);
  });
});

describe('presetOf', () => {
  it.each([
    [null, 'none'],
    [{ every: 1, unit: 'day' }, 'daily'],
    [{ every: 1, unit: 'week' }, 'weekly'],
    [{ every: 2, unit: 'week' }, 'fortnightly'],
    [{ every: 1, unit: 'month' }, 'monthly'],
    [{ every: 3, unit: 'week' }, 'custom'],
    [{ every: 2, unit: 'day' }, 'custom'],
  ] as const)('%j is %s', (rule, preset) => {
    expect(presetOf(rule)).toBe(preset);
  });
});

describe('inferRule', () => {
  it('reads a weekly series', () => {
    expect(inferRule(['2026-10-13', '2026-10-20', '2026-10-27'])).toEqual({ every: 1, unit: 'week', until: '2026-10-27' });
  });

  it('uses the smallest gap when an occurrence was deleted', () => {
    expect(inferRule(['2026-10-13', '2026-10-27', '2026-11-03'])).toEqual({ every: 1, unit: 'week', until: '2026-11-03' });
  });

  it('reads months, including month-end dates', () => {
    expect(inferRule(['2027-01-31', '2027-02-28', '2027-03-31'])).toEqual({ every: 1, unit: 'month', until: '2027-03-31' });
  });

  it('reads every N days', () => {
    expect(inferRule(['2026-10-13', '2026-10-16', '2026-10-19'])).toEqual({ every: 3, unit: 'day', until: '2026-10-19' });
  });

  it('gives no rule for a single date', () => {
    expect(inferRule(['2026-10-13'])).toBeNull();
  });
});
