import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyFailure } from '@/lib/events/failures';
import { FAMILY_MESSAGES } from '@/lib/family/messages';
import type { FamilyResult } from '@/lib/family/types';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_SIZE = 256;
const SIGNED_URL_SECONDS = 60 * 60;

export const avatarPath = (userId: string, fileId: string): string => `${userId}/${fileId}.jpg`;

/** Hermes and Node both have atob. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const failed = (message: string, offline = false): FamilyResult<never> => ({ ok: false, message, offline });

/** Storage reports HTTP problems with a status; anything without one never reached the server. */
function storageFailure(error: { status?: number | string; statusCode?: string; message?: string }): FamilyResult<never> {
  const status = Number(error.status ?? error.statusCode ?? 0);
  if (!status) return failed(FAMILY_MESSAGES.offline, true);
  if (status === 413) return failed('That photo is too big. Try another one.');
  return failed(FAMILY_MESSAGES.unknown);
}

function profileFailure(error: { code?: string; message?: string }, status: number): FamilyResult<never> {
  const kind = classifyFailure(error, status);
  if (kind === 'network') return failed(FAMILY_MESSAGES.offline, true);
  if (kind === 'auth') return failed(FAMILY_MESSAGES.signInAgain);
  return failed(FAMILY_MESSAGES.unknown);
}

async function removeFiles(client: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client.storage.from(AVATAR_BUCKET).remove(paths);
  } catch {
    // Best effort: an orphaned file costs storage, not privacy (the folder is still private).
  }
}

/** Upload a new photo, point the profile at it, then delete the old one. Returns the new path. */
export async function uploadAvatar(
  client: SupabaseClient,
  userId: string,
  fileId: string,
  base64: string,
  previousPath: string | null,
): Promise<FamilyResult<string>> {
  const path = avatarPath(userId, fileId);
  try {
    const { error: uploadError } = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: false });
    if (uploadError) return storageFailure(uploadError as { status?: number; statusCode?: string });

    const { error, status } = await client.from('profiles').update({ avatar_url: path }).eq('id', userId);
    if (error) {
      await removeFiles(client, [path]);
      return profileFailure(error, status);
    }
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
  // Only ever delete inside the user's own folder.
  if (previousPath && previousPath !== path && previousPath.startsWith(`${userId}/`)) {
    await removeFiles(client, [previousPath]);
  }
  return { ok: true, value: path };
}

/** Clear the profile photo, then delete the file. */
export async function removeAvatar(client: SupabaseClient, userId: string, path: string | null): Promise<FamilyResult> {
  try {
    const { error, status } = await client.from('profiles').update({ avatar_url: null }).eq('id', userId);
    if (error) return profileFailure(error, status);
  } catch {
    return failed(FAMILY_MESSAGES.offline, true);
  }
  if (path && path.startsWith(`${userId}/`)) await removeFiles(client, [path]);
  return { ok: true, value: undefined };
}

/** Signed URLs (one hour) for the photos this user may see, keyed by path. Failures give no URL. */
export async function avatarUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  try {
    const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    if (error || !data) return {};
    const urls: Record<string, string> = {};
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
    }
    return urls;
  } catch {
    return {};
  }
}

export type AvatarCleanup = { ok: true; removed: number } | { ok: false; reason: 'offline' | 'auth' | 'failed' };

function cleanupFailure(error: { status?: number | string; statusCode?: string }): AvatarCleanup {
  const status = Number(error.status ?? error.statusCode ?? 0);
  if (!status) return { ok: false, reason: 'offline' };
  if (status === 401 || status === 403) return { ok: false, reason: 'auth' };
  return { ok: false, reason: 'failed' };
}

/** Delete every photo in the user's folder (before deleting the account). Says how many went, or why it couldn't. */
export async function deleteAllAvatars(client: SupabaseClient, userId: string): Promise<AvatarCleanup> {
  try {
    const bucket = client.storage.from(AVATAR_BUCKET);
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) return cleanupFailure(error as { status?: number; statusCode?: string });
    const paths = (data ?? []).map(file => `${userId}/${file.name}`);
    if (paths.length === 0) return { ok: true, removed: 0 };
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) return cleanupFailure(removeError as { status?: number; statusCode?: string });
    return { ok: true, removed: paths.length };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}
