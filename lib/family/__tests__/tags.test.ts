import { knownTagsFor, memberLabel, resolvePeople, withPeople } from '../tags';
import type { Member } from '../types';

const alice: Member = { id: 'user-1', displayName: 'Alice', tag: 'AL', joinedAt: null };
const bob: Member = { id: 'user-2', displayName: 'Bob', tag: 'BE', joinedAt: null };
const noTag: Member = { id: 'user-3', displayName: 'Nan', tag: null, joinedAt: null };
const byTag = new Map([
  ['AL', alice],
  ['BE', bob],
]);
const event = { id: 'e1', dateKey: '2026-11-03', name: 'Dinner', startTime: '18:00', endTime: '' };

describe('knownTagsFor', () => {
  it('knows the family tags and the two old ones', () => {
    expect(knownTagsFor([alice, bob, noTag])).toEqual(['AL', 'BE', 'AZ', 'GS']);
  });
});

describe('resolvePeople', () => {
  it('turns member tags into member ids', () => {
    expect(resolvePeople(['BE', 'AL', 'BE'], byTag)).toEqual({ memberIds: ['user-2', 'user-1'], legacy: [] });
  });

  it('keeps a tag no member has', () => {
    expect(resolvePeople(['AZ', 'BE'], byTag)).toEqual({ memberIds: ['user-2'], legacy: ['AZ'] });
  });
});

describe('withPeople', () => {
  it('saves members and leftover tags with the chosen visibility', () => {
    expect(withPeople({ ...event, people: ['BE', 'AZ'] }, byTag, 'shared')).toEqual({
      ...event,
      people: ['AZ'],
      memberIds: ['user-2'],
      visibility: 'shared',
    });
  });
});

describe('memberLabel', () => {
  it.each([
    [alice, 'user-1', 'You'],
    [bob, 'user-1', 'Bob'],
    [{ ...bob, displayName: '  ' }, 'user-1', '@BE'],
    [{ ...noTag, displayName: null }, 'user-1', 'Member'],
    [undefined, 'user-1', 'Former member'],
  ])('labels %j', (member, myId, label) => {
    expect(memberLabel(member, myId)).toBe(label);
  });
});
