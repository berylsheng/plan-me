/** A person in the user's family (the user included), as their profile row says. */
export type Member = {
  id: string;
  displayName: string | null;
  tag: string | null;
  joinedAt: string | null;
  /** Storage path of the profile photo, if any. */
  avatarPath?: string | null;
};

export type Family = { id: string; name: string; ownerId: string; inviteCode: string };

/** What the phone knows about the user's family. `me` is always among `members`. */
export type FamilySnapshot = { me: Member; family: Family | null; members: Member[] };

/** The outcome of a family action: a value, or a message to show (and whether we were offline). */
export type FamilyResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string; offline: boolean };
