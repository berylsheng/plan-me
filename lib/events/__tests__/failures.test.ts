import { classifyFailure } from '../failures';

describe('classifyFailure', () => {
  it.each([
    [{ code: '' }, 0, 'network'],
    [{ code: '' }, 503, 'network'],
    [{ code: '' }, 429, 'network'],
    [{ code: 'PGRST301' }, 401, 'auth'],
    [{ code: '42501' }, 401, 'auth'],
    [{ code: 'PGRST303' }, 401, 'auth'],
    [{ code: '' }, 408, 'network'],
    [{ code: '' }, 500, 'network'],
    [{ code: 'PGRST205' }, 404, 'network'],
    // The app is newer than the database (a column not added yet): keep and retry, never drop.
    [{ code: 'PGRST204' }, 400, 'network'],
    [{ code: '42703' }, 400, 'network'],
    [{ code: '42501' }, 403, 'rejected'],
    [{ code: '23514' }, 400, 'rejected'],
    [{ code: 'P0001' }, 400, 'rejected'],
  ])('%p with HTTP %p → %p', (error, status, expected) => {
    expect(classifyFailure(error, status)).toBe(expected);
  });
});
