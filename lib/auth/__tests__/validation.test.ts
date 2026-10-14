import { normaliseEmail, validateEmailOnly, validateNewPassword, validateSignIn, validateSignUp } from '../validation';

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Alice@Test.NZ ')).toBe('alice@test.nz');
  });
});

describe('validateSignIn', () => {
  it('accepts a normal email and any non-empty password', () => {
    expect(validateSignIn({ email: 'alice@test.nz', password: 'x' })).toEqual({});
  });

  it('asks for missing fields', () => {
    expect(validateSignIn({ email: '  ', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });

  it('rejects an address without a domain', () => {
    expect(validateSignIn({ email: 'alice@test', password: 'x' }).email).toBe('Enter a valid email address.');
  });
});

describe('validateNewPassword', () => {
  it.each([
    ['family26', undefined],
    ['family2', 'Use at least 8 characters.'],
    ['familyplan', 'Include at least one letter and one number.'],
    ['12345678', 'Include at least one letter and one number.'],
    [`a1${'x'.repeat(71)}`, 'Use at most 72 characters.'],
  ])('%s → %s', (password, expected) => {
    expect(validateNewPassword({ password, confirmPassword: password }).password).toBe(expected);
  });

  it('requires the two passwords to match', () => {
    expect(validateNewPassword({ password: 'family26', confirmPassword: 'family27' })).toEqual({
      confirmPassword: "Passwords don't match.",
    });
  });
});

describe('validateSignUp', () => {
  const valid = { displayName: 'Alice', email: 'alice@test.nz', password: 'family26', confirmPassword: 'family26' };

  it('accepts a complete form, and an empty display name', () => {
    expect(validateSignUp(valid)).toEqual({});
    expect(validateSignUp({ ...valid, displayName: '' })).toEqual({});
  });

  it('limits the display name to 50 characters after trimming', () => {
    expect(validateSignUp({ ...valid, displayName: ` ${'a'.repeat(50)} ` })).toEqual({});
    expect(validateSignUp({ ...valid, displayName: 'a'.repeat(51) }).displayName).toBe('Use at most 50 characters.');
  });
});

describe('validateEmailOnly', () => {
  it('checks just the email', () => {
    expect(validateEmailOnly('')).toEqual({ email: 'Enter your email address.' });
    expect(validateEmailOnly('alice@test.nz')).toEqual({});
  });
});
