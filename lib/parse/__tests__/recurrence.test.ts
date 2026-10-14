import { occurrenceDates } from '../../events/repeat';
import { parseRecurrence } from '../recurrence';

const datesFor = (text: string, start: string) => occurrenceDates(start, parseRecurrence(text)!.ruleFor(start));

describe('parseRecurrence', () => {
  it('returns null when there is no recurrence phrase', () => {
    expect(parseRecurrence('dinner tomorrow 6pm')).toBeNull();
  });

  it('removes the phrase (and its leading comma) from the text', () => {
    expect(parseRecurrence('swim, 13 October 7am, weekly for 4 weeks')?.cleanText).toBe('swim, 13 October 7am');
  });

  it('weekly for 4 weeks makes 4 events (BUG-004)', () => {
    expect(parseRecurrence('swim weekly for 4 weeks')!.ruleFor('2026-10-13')).toEqual({ every: 1, unit: 'week', until: '2026-11-09' });
    expect(datesFor('swim weekly for 4 weeks', '2026-10-13')).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
  });

  it('every 2 weeks for 2 months uses calendar months', () => {
    expect(datesFor('gym every 2 weeks for 2 months', '2026-10-15')).toEqual([
      '2026-10-15', '2026-10-29', '2026-11-12', '2026-11-26', '2026-12-10',
    ]);
  });

  it('monthly for 3 months makes 3 events', () => {
    expect(datesFor('rent, monthly for 3 months', '2026-11-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('daily for 2 weeks makes 14 events', () => {
    expect(datesFor('stretch daily for 2 weeks', '2026-10-13')).toHaveLength(14);
  });

  it('fortnightly is every 2 weeks', () => {
    expect(parseRecurrence('swim fortnightly for 2 months')!.ruleFor('2026-10-13')).toMatchObject({ every: 2, unit: 'week' });
  });

  it('stops a year after the first date', () => {
    expect(parseRecurrence('swim weekly for 18 months')!.ruleFor('2026-10-13').until).toBe('2027-10-13');
  });

  it('treats every 0 days as every day', () => {
    expect(parseRecurrence('pills every 0 days for 1 weeks')!.ruleFor('2026-10-13')).toMatchObject({ every: 1, unit: 'day' });
  });

  it('is case-insensitive', () => {
    expect(parseRecurrence('yoga Daily For 2 Weeks')?.cleanText).toBe('yoga');
  });
});
