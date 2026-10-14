/** Messages shown for family and profile actions. Kept apart so lib/profile can use them without importing api.ts. */
export const FAMILY_MESSAGES = {
  offline: "You're offline. Try again when you're connected.",
  signInAgain: 'Sign in again to do this.',
  unknown: 'Something went wrong. Try again.',
  alreadyInFamily: "You're already in a family. Leave it first.",
  notOwner: 'Only the family owner can do that.',
  codeNotFound: 'Code not found. Check it with the person who sent it.',
  rateLimited: 'Too many tries. Try again in an hour.',
} as const;
