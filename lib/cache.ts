// Tiny time-to-live cache on AsyncStorage. Serves fresh data when the network
// works and falls back to the last saved copy (even if stale) when it doesn't,
// so the map still shows paths and places with a weak signal on the trail.

import AsyncStorage from '@react-native-async-storage/async-storage';

interface Entry<T> {
  savedAt: number;
  value: T;
}

export interface CachedResult<T> {
  value: T;
  savedAt: number;
  stale: boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  { force = false } = {},
): Promise<CachedResult<T>> {
  let entry: Entry<T> | null = null;
  try {
    const raw = await AsyncStorage.getItem(key);
    entry = raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    entry = null;
  }

  if (!force && entry && Date.now() - entry.savedAt < ttlMs) {
    return { value: entry.value, savedAt: entry.savedAt, stale: false };
  }

  try {
    const value = await load();
    const fresh: Entry<T> = { savedAt: Date.now(), value };
    AsyncStorage.setItem(key, JSON.stringify(fresh)).catch(() => {
      // Storage full or unavailable: keep working without a saved copy.
    });
    return { value, savedAt: fresh.savedAt, stale: false };
  } catch (err) {
    if (entry) return { value: entry.value, savedAt: entry.savedAt, stale: true };
    throw err;
  }
}
