import {
  displayNameProblem,
  familyNameProblem,
  formatInviteCode,
  inviteCodeProblem,
  normaliseInviteCode,
  normaliseTag,
  tagProblem,
} from '../validation';

describe('invite codes', () => {
  it.each([
    ['k7qm-2xwp', 'K7QM2XWP'],
    [' K7QM 2XWP ', 'K7QM2XWP'],
  ])('normalises %j', (input, expected) => {
    expect(normaliseInviteCode(input)).toBe(expected);
  });

  it('asks for a code when there is none', () => {
    expect(inviteCodeProblem('')).toBe('Enter the invite code.');
  });

  it.each(['K7QM2XW', 'K7QM2XWP9', 'K7QM2XW0', 'K7QM2XWI'])('rejects %j', code => {
    expect(inviteCodeProblem(code)).toBe('Invite codes are 8 letters and numbers, like K7QM-2XWP.');
  });

  it('accepts a valid code', () => {
    expect(inviteCodeProblem('K7QM2XWP')).toBeNull();
  });

  it('shows a code in two groups of four', () => {
    expect(formatInviteCode('K7QM2XWP')).toBe('K7QM-2XWP');
  });
});

describe('tags', () => {
  it.each([
    ['@az', 'AZ'],
    [' gs ', 'GS'],
    ['', null],
    ['  ', null],
  ])('normalises %j', (input, expected) => {
    expect(normaliseTag(input)).toBe(expected);
  });

  it.each(['A', 'ABCDE', 'A1'])('rejects %j', tag => {
    expect(tagProblem(tag)).toBe('A tag is 2 to 4 letters, like AZ.');
  });

  it('allows no tag', () => {
    expect(tagProblem(null)).toBeNull();
  });
});

describe('names', () => {
  it('asks for a family name', () => {
    expect(familyNameProblem('   ')).toBe('Enter a name for your family.');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(familyNameProblem('😀'.repeat(50))).toBeNull();
    expect(familyNameProblem('a'.repeat(51))).toBe('Keep the name to 50 characters or fewer.');
  });

  it('limits a display name to 50 characters', () => {
    expect(displayNameProblem('a'.repeat(51))).toBe('Keep your name to 50 characters or fewer.');
    expect(displayNameProblem('')).toBeNull();
  });
});
