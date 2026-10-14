import { parseEventInput } from '../parseEventInput';

// Tuesday 6 October 2026, 9am NZ. The calendar has Thursday 8 October selected.
const now = new Date(2026, 9, 6, 9, 0);
const opts = { selectedDateKey: '2026-10-08', now };

const draftOf = (input: string) => {
  const result = parseEventInput(input, opts);
  if (!result.ok) throw new Error(`expected "${input}" to parse`);
  return result.draft;
};

describe('parseEventInput', () => {
  it('reads date, time range, name and people', () => {
    expect(draftOf('12 October, 6-8pm, dancing @AZ')).toEqual({
      name: 'dancing', startTime: '18:00', endTime: '20:00', people: ['AZ'],
      dateKeys: ['2026-10-12'], isRecurring: false, repeat: null,
    });
  });

  it('puts a time with no date on the selected day, not today', () => {
    expect(draftOf('dentist 9am')).toEqual({
      name: 'dentist', startTime: '09:00', endTime: '', people: [],
      dateKeys: ['2026-10-08'], isRecurring: false, repeat: null,
    });
  });

  it('expands shorthand ranges that cross noon', () => {
    expect(draftOf('11-4 lunch')).toMatchObject({ name: 'lunch', startTime: '11:00', endTime: '16:00' });
  });

  it('accepts lower-case tags', () => {
    expect(draftOf('lunch 14 October @gs')).toEqual({
      name: 'lunch', startTime: '', endTime: '', people: ['GS'],
      dateKeys: ['2026-10-14'], isRecurring: false, repeat: null,
    });
  });

  it('names an event with only a date and time "Busy"', () => {
    expect(draftOf('12 October 6pm').name).toBe('Busy');
  });

  it('expands recurrence into date keys, starting with the first date', () => {
    expect(draftOf('swim, 13 October 7am, weekly for 4 weeks')).toEqual({
      name: 'swim', startTime: '07:00', endTime: '', people: [],
      dateKeys: ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'],
      isRecurring: true,
      repeat: { every: 1, unit: 'week', until: '2026-11-09' },
    });
  });

  it('uses the tag list it is given', () => {
    const result = parseEventInput('lunch 14 October @ZQ', { ...opts, knownTags: ['ZQ'] });
    expect(result.ok && result.draft.people).toEqual(['ZQ']);
  });

  it('rejects a sentence with no date or time', () => {
    expect(parseEventInput('hello', opts)).toEqual({ ok: false, error: 'no-date-or-time' });
  });
});
