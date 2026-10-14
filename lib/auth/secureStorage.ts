import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';

/**
 * Session storage for Supabase, from Supabase's Expo guide. SecureStore can reject
 * values over about 2 KB and a session is bigger, so the session is AES-256
 * encrypted into AsyncStorage and only its 32-byte key is kept in SecureStore.
 *
 * All operations for a given key are serialised through a per-key Promise chain so
 * that concurrent calls cannot interleave a write from one call with the reads of
 * another (which would leave SecureStore and AsyncStorage out of sync).
 */
export class LargeSecureStore {
  private queues = new Map<string, Promise<unknown>>();

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    // Run fn after the previous operation, regardless of whether it succeeded.
    const next: Promise<T> = prev.then(() => fn(), () => fn());
    // Track a void-typed version so the map stays Promise<unknown>-compatible
    // and errors from fn don't propagate to the next operation.
    const queued: Promise<void> = next.then(() => undefined, () => undefined);
    this.queues.set(key, queued);
    // Clean up when this is still the tail of the chain to avoid unbounded growth.
    queued.then(() => {
      if (this.queues.get(key) === queued) this.queues.delete(key);
    });
    return next;
  }

  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    let encryptionKeyHex: string | null;
    try {
      encryptionKeyHex = await SecureStore.getItemAsync(key);
    } catch {
      // Android Keystore key invalidated (e.g. biometrics re-enrolled). Clear
      // both halves so the next login can write a fresh pair.
      await AsyncStorage.removeItem(key);
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
      return null;
    }
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  getItem(key: string): Promise<string | null> {
    return this.enqueue(key, async () => {
      const encrypted = await AsyncStorage.getItem(key);
      if (!encrypted) return null;
      return this.decrypt(key, encrypted);
    });
  }

  removeItem(key: string): Promise<void> {
    return this.enqueue(key, async () => {
      await AsyncStorage.removeItem(key);
      await SecureStore.deleteItemAsync(key);
    });
  }

  setItem(key: string, value: string): Promise<void> {
    return this.enqueue(key, async () => {
      const encrypted = await this.encrypt(key, value);
      await AsyncStorage.setItem(key, encrypted);
    });
  }
}
