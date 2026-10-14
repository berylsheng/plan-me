import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';

/** Enough about a user to open their planner without the server. */
export type KnownUser = { id: string; email: string | null };

const KEY = 'planme:lastUser';

export async function readLastUser(): Promise<KnownUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string') return null;
    const email = 'email' in value && typeof value.email === 'string' ? value.email : null;
    return { id: value.id, email };
  } catch {
    return null;
  }
}

export async function writeLastUser(user: User): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ id: user.id, email: user.email ?? null }));
  } catch {
    // Not fatal: the planner just won't open offline next time.
  }
}

export async function clearLastUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Not fatal.
  }
}
