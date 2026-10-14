import { preprocessInput } from '../preprocess';

describe('preprocessInput', () => {
  it.each([
    ['2-5pm dancing', '2pm-5pm dancing'],
    ['11-4pm', '11am-4pm'],           // start > end with pm → start is am
    ['11-4 lunch', '11am-4pm lunch'], // no suffix, start > end → crosses noon
    ['12-2pm', '12pm-2pm'],
    ['5:15-6:15pm', '5:15pm-6:15pm'],
    ['11:30-2:45pm', '11:30am-2:45pm'],
    ['2-5', '2-5'],                   // no suffix, start < end → left alone
  ])('%s → %s', (input, expected) => {
    expect(preprocessInput(input)).toBe(expected);
  });

  // BUG-003: hyphenated dates are read as time ranges. Recorded as-is; fix separately.
  it.each([
    ['12-10 party', '12pm-10pm party'],
    ['10-06', '10am-06pm'],
  ])('BUG-003 current behaviour: %s → %s', (input, expected) => {
    expect(preprocessInput(input)).toBe(expected);
  });
});
