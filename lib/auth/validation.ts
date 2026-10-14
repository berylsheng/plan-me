export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const MAX_DISPLAY_NAME_LENGTH = 50;

export type FieldErrors = Partial<Record<'displayName' | 'email' | 'password' | 'confirmPassword', string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const emailError = (email: string): string | undefined => {
  const value = normaliseEmail(email);
  if (value === '') return 'Enter your email address.';
  return EMAIL_PATTERN.test(value) ? undefined : 'Enter a valid email address.';
};

// Same rule the server enforces (supabase/config.toml: 8 characters, letters_digits).
const newPasswordError = (password: string): string | undefined => {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include at least one letter and one number.';
  return undefined;
};

const withoutEmpty = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined)) as FieldErrors;

export const validateSignIn = ({ email, password }: { email: string; password: string }): FieldErrors =>
  withoutEmpty({ email: emailError(email), password: password === '' ? 'Enter your password.' : undefined });

export const validateNewPassword = ({ password, confirmPassword }: { password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    password: newPasswordError(password),
    confirmPassword: confirmPassword === password ? undefined : "Passwords don't match.",
  });

export const validateSignUp = (form: { displayName: string; email: string; password: string; confirmPassword: string }): FieldErrors =>
  withoutEmpty({
    displayName:
      form.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH ? `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.` : undefined,
    email: emailError(form.email),
    ...validateNewPassword(form),
  });

export const validateEmailOnly = (email: string): FieldErrors => withoutEmpty({ email: emailError(email) });
