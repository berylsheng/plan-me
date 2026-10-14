import type { EventRecord } from '@/lib/events/rows';
import { memoryStorage } from '@/test-utils/memoryStorage';

import { legacyTagsIn, nextTagToAsk, readTagAnswers, remapTags, saveTagAnswer } from '../tagMapping';

const record = (id: string, people: string[] | undefined, memberIds: string[] = []): EventRecord => ({
  id,
  dateKey: '2026-11-03',
  name: 'Swim',
  startTime: '',
  endTime: '',
  people,
  ownerId: 'user-1',
  visibility: 'personal',
  memberIds,
  updatedAt: null,
});

const records = {
  a: record('a', ['GS', 'AZ']),
  b: record('b', ['AZ'], ['user-2']),
  c: record('c', undefined),
};

describe('tag mapping', () => {
  it('lists the old tags in order', () => {
    expect(legacyTagsIn(records)).toEqual(['AZ', 'GS']);
  });

  it('asks about each tag once', () => {
    expect(nextTagToAsk(records, {})).toBe('AZ');
    expect(nextTagToAsk(records, { AZ: 'user-2' })).toBe('GS');
    expect(nextTagToAsk(records, { AZ: 'user-2', GS: null })).toBeNull();
  });

  it('moves answered tags to members, once per member', () => {
    expect(remapTags(records, { AZ: 'user-2', GS: null }, new Set(['user-1', 'user-2']))).toEqual([
      { ...records.a, people: ['GS'], memberIds: ['user-2'] },
      { ...records.b, people: undefined, memberIds: ['user-2'] },
    ]);
  });

  it('ignores an answer for someone no longer in the family', () => {
    expect(remapTags(records, { AZ: 'gone' }, new Set(['user-1']))).toEqual([]);
  });

  it('saves answers per user', async () => {
    const storage = memoryStorage();
    expect(await saveTagAnswer(storage, 'user-1', 'AZ', 'user-2')).toEqual({ AZ: 'user-2' });
    expect(await saveTagAnswer(storage, 'user-1', 'GS', null)).toEqual({ AZ: 'user-2', GS: null });
    expect(await readTagAnswers(storage, 'user-1')).toEqual({ AZ: 'user-2', GS: null });
    expect(await readTagAnswers(storage, 'user-2')).toEqual({});
  });

  it('treats damaged answers as none', async () => {
    const storage = memoryStorage();
    await storage.setItem('planme:tagMap:user-1', '[1,2]');
    expect(await readTagAnswers(storage, 'user-1')).toEqual({});
  });
});
