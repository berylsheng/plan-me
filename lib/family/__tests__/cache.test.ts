import { memoryStorage } from '@/test-utils/memoryStorage';

import { clearFamilyData, familyKeys, readFamilyCache, writeFamilyCache } from '../cache';
import type { FamilySnapshot } from '../types';

const me = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: null };
const snapshot: FamilySnapshot = {
  me,
  family: { id: 'fam-1', name: 'Smiths', ownerId: 'user-1', inviteCode: 'K7QM2XWP' },
  members: [me],
};

describe('family cache', () => {
  it('reads back what it wrote, per user', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, 'user-1', snapshot);
    expect(await readFamilyCache(storage, 'user-1')).toEqual(snapshot);
    expect(await readFamilyCache(storage, 'user-2')).toBeNull();
  });

  it('ignores damaged or mismatched data', async () => {
    const storage = memoryStorage();
    await storage.setItem(familyKeys('user-1').family, '{not json');
    expect(await readFamilyCache(storage, 'user-1')).toBeNull();
    await storage.setItem(familyKeys('user-2').family, JSON.stringify(snapshot)); // someone else's snapshot
    expect(await readFamilyCache(storage, 'user-2')).toBeNull();
  });

  it('forgets the family and the tag answers', async () => {
    const storage = memoryStorage();
    await writeFamilyCache(storage, 'user-1', snapshot);
    await storage.setItem(familyKeys('user-1').tagAnswers, '{"AZ":null}');
    await clearFamilyData(storage, 'user-1');
    expect(await storage.getItem(familyKeys('user-1').family)).toBeNull();
    expect(await storage.getItem(familyKeys('user-1').tagAnswers)).toBeNull();
  });

  it('reads an older cache without photo paths', async () => {
    const storage = memoryStorage();
    await storage.setItem(familyKeys('user-1').family, JSON.stringify(snapshot)); // members have no avatarPath
    expect((await readFamilyCache(storage, 'user-1'))?.me.avatarPath ?? null).toBeNull();
  });
});
