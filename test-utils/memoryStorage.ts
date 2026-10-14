/** An in-memory stand-in for AsyncStorage (same three methods). */
export function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: async (key: string): Promise<string | null> => map.get(key) ?? null,
    setItem: async (key: string, value: string): Promise<void> => {
      map.set(key, value);
    },
    removeItem: async (key: string): Promise<void> => {
      map.delete(key);
    },
    dump: (): Record<string, string> => Object.fromEntries(map),
  };
}
