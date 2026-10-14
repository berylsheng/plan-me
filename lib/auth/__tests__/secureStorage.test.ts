import AsyncStorage from '@react-native-async-storage/async-storage';

import { LargeSecureStore } from '../secureStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-get-random-values', () => ({}));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const secureStore = (): Map<string, string> => jest.requireMock('expo-secure-store').__store;

beforeEach(async () => {
  await AsyncStorage.clear();
  secureStore().clear();
  // Restore default mock implementations so per-test overrides don't bleed across.
  jest.requireMock('expo-secure-store').setItemAsync.mockImplementation(
    async (key: string, value: string) => { secureStore().set(key, value); },
  );
  jest.requireMock('expo-secure-store').getItemAsync.mockImplementation(
    async (key: string) => secureStore().get(key) ?? null,
  );
});

describe('LargeSecureStore', () => {
  it('returns what was stored', async () => {
    const store = new LargeSecureStore();
    await store.setItem('sb-test-auth-token', '{"access_token":"abc"}');
    expect(await store.getItem('sb-test-auth-token')).toBe('{"access_token":"abc"}');
  });

  it('keeps only ciphertext in AsyncStorage and only a 256-bit key in SecureStore', async () => {
    await new LargeSecureStore().setItem('k', 'secret session');
    const stored = await AsyncStorage.getItem('k');
    expect(stored).not.toContain('secret');
    expect(stored).toMatch(/^[0-9a-f]+$/);
    expect(secureStore().get('k')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles sessions far larger than SecureStore accepts', async () => {
    const big = 'x'.repeat(5000);
    const store = new LargeSecureStore();
    await store.setItem('k', big);
    expect(await store.getItem('k')).toBe(big);
    expect(secureStore().get('k')).toHaveLength(64);
  });

  it('uses a fresh key each time a value is saved', async () => {
    const store = new LargeSecureStore();
    await store.setItem('k', 'same');
    const firstKey = secureStore().get('k');
    await store.setItem('k', 'same');
    expect(secureStore().get('k')).not.toBe(firstKey);
  });

  it('returns null for a missing value or a missing key', async () => {
    const store = new LargeSecureStore();
    expect(await store.getItem('nothing')).toBeNull();
    await store.setItem('k', 'v');
    secureStore().delete('k'); // e.g. keychain cleared but app data kept
    expect(await store.getItem('k')).toBeNull();
  });

  it('removes both halves', async () => {
    const store = new LargeSecureStore();
    await store.setItem('k', 'v');
    await store.removeItem('k');
    expect(await AsyncStorage.getItem('k')).toBeNull();
    expect(secureStore().has('k')).toBe(false);
  });

  it('serialises concurrent writes to the same key', async () => {
    // Use deferred promises so we can control resolution order and manufacture
    // the real interleaving: second's setItemAsync resolves before first's.
    // Without serialisation: K2→AsyncStorage(C2), then K1 overwrites K2 and C1
    // overwrites C2 → SecureStore=K1, AsyncStorage=C1 → getItem returns 'first'.
    // With the per-key queue the second write can't start until the first finishes.
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstSettled = new Promise<void>(r => { resolveFirst = r; });
    const secondSettled = new Promise<void>(r => { resolveSecond = r; });
    let callCount = 0;

    jest.requireMock('expo-secure-store').setItemAsync.mockImplementation(
      async (key: string, value: string) => {
        callCount++;
        if (callCount === 1) {
          await firstSettled;
        } else {
          await secondSettled;
        }
        secureStore().set(key, value);
      },
    );

    const store = new LargeSecureStore();
    const p1 = store.setItem('k', 'first');
    const p2 = store.setItem('k', 'second');

    // Yield to let calls reach their await points inside setItemAsync.
    await new Promise<void>(r => setTimeout(r, 0));

    // Release second before first to trigger the mismatch (without queue).
    resolveSecond();
    await new Promise<void>(r => setTimeout(r, 0));
    resolveFirst();

    await Promise.all([p1, p2]);
    expect(await store.getItem('k')).toBe('second');
  });

  it('returns null and clears AsyncStorage when SecureStore getItemAsync throws', async () => {
    const store = new LargeSecureStore();
    await store.setItem('k', 'sensitive');
    jest.requireMock('expo-secure-store').getItemAsync.mockRejectedValueOnce(
      new Error('Keystore error'),
    );
    expect(await store.getItem('k')).toBeNull();
    expect(await AsyncStorage.getItem('k')).toBeNull();
  });
});
