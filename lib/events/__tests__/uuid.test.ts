import { isUuid, uuidFromBytes } from '../uuid';

describe('uuidFromBytes', () => {
  it('formats 16 bytes as a version 4 UUID', () => {
    const id = uuidFromBytes(new Uint8Array(16).fill(0xff));
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(isUuid(id)).toBe(true);
  });

  it('sets the version and variant bits whatever the input', () => {
    expect(uuidFromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
  });
});

describe('isUuid', () => {
  it.each(['1696500000000_occ', '', 'not-a-uuid', '12345678-1234-1234-1234-1234567890ab-extra'])('rejects %p', value => {
    expect(isUuid(value)).toBe(false);
  });
});
