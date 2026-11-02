// Ride Madison's own copy of the map data (trails, places, parks, Eat, Drink), refreshed
// daily by the map-data Edge Function into the public Supabase Storage bucket "map-data".
// The app loads this first: one fast download instead of heavy queries to the volunteer-run
// OpenStreetMap (Overpass) servers. If it isn't there, the app falls back to Overpass.

export type SnapshotName = 'paths' | 'places' | 'parks' | 'food' | 'drink';

const BASE = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
export const SNAPSHOT_BUCKET = 'map-data';

export function snapshotUrl(name: SnapshotName): string | null {
  return /^https:\/\//.test(BASE) ? `${BASE}/storage/v1/object/public/${SNAPSHOT_BUCKET}/${name}.json` : null;
}

export interface Snapshot<T> {
  savedAt: string;
  data: T[];
}

/** Download one snapshot file. Throws if missing, empty or slow (so callers can fall back). */
export async function fetchSnapshot<T>(name: SnapshotName, timeoutMs = 15000): Promise<T[]> {
  const url = snapshotUrl(name);
  if (!url) throw new Error('No snapshot URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Cache-buster per hour so a fresh daily snapshot isn't hidden behind a CDN copy for long.
    const res = await fetch(`${url}?h=${Math.floor(Date.now() / 3600000)}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Snapshot ${name}: HTTP ${res.status}`);
    const json = (await res.json()) as Snapshot<T>;
    if (!Array.isArray(json.data) || json.data.length === 0) throw new Error(`Snapshot ${name}: empty`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

/** Snapshot first, then the live source. */
export function snapshotFirst<T>(name: SnapshotName, live: () => Promise<T[]>): () => Promise<T[]> {
  return () => fetchSnapshot<T>(name).catch(() => live());
}
