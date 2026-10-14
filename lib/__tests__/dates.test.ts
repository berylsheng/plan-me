import { formatClock, formatDateKey, formatTime, getNZMonthYear, getWeekDays, getWeekRange, toNZDateKey } from '../dates';

it('runs in NZ time', () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
});

describe('toNZDateKey', () => {
  it('uses the NZ calendar date, not UTC', () => {
    // 11:30 UTC on 6 Oct is 00:30 on 7 Oct in NZ daylight time (UTC+13)
    expect(toNZDateKey(new Date('2026-10-06T11:30:00Z'))).toBe('2026-10-07');
    expect(toNZDateKey(new Date('2026-10-06T10:59:00Z'))).toBe('2026-10-06');
  });
});

describe('formatTime', () => {
  it('zero-pads hours and minutes', () => {
    expect(formatTime(new Date(2026, 9, 6, 7, 5))).toBe('07:05');
  });
});

describe('getNZMonthYear', () => {
  it('shows the full month and year', () => {
    expect(getNZMonthYear(new Date(2026, 9, 6))).toBe('October 2026');
  });
});

describe('getWeekRange', () => {
  it('runs Monday to Sunday', () => {
    expect(getWeekRange('2026-10-07')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('keeps a Sunday in the week that ends on it', () => {
    expect(getWeekRange('2026-10-11')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });
});

describe('getWeekDays', () => {
  it('lists the seven days, Monday first', () => {
    expect(getWeekDays('2026-10-07')).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });
});

describe('display formats', () => {
  it('shows dates as dd/mm/yyyy', () => {
    expect(formatDateKey('2026-10-03')).toBe('03/10/2026');
  });

  it.each([
    ['18:30', '6:30 pm'],
    ['00:05', '12:05 am'],
    ['12:00', '12:00 pm'],
    ['09:00', '9:00 am'],
  ])('shows %s as %s', (time, shown) => {
    expect(formatClock(time)).toBe(shown);
  });
});
