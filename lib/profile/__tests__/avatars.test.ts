import { avatarPath, base64ToBytes } from '../avatars';

describe('avatars', () => {
  it('builds the path in the owner folder', () => {
    expect(avatarPath('user-1', 'abc')).toBe('user-1/abc.jpg');
  });

  it('decodes base64 to bytes', () => {
    expect(Array.from(base64ToBytes('aGk='))).toEqual([104, 105]);
    expect(base64ToBytes('').length).toBe(0);
  });
});
