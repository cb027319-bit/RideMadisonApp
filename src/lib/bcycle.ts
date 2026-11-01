// Madison BCycle live station data from its public GBFS feed (no API key).
// Station locations change rarely; bike/dock counts update every minute or so.

import { BCYCLE_GBFS_URL, USER_AGENT } from './config';

export interface BCycleStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  capacity?: number;
  bikes: number;
  /** Breakdown when the feed provides it (BCycle Madison is mostly e-bikes). */
  ebikes?: number;
  /** Classic (non-electric) bikes, when the feed says. */
  classic?: number;
  /** Open docks: spots to return a bike. */
  docks: number;
  renting: boolean;
  returning: boolean;
  lastReported?: number; // epoch seconds
}

interface GbfsIndex {
  data: Record<string, { feeds: { name: string; url: string }[] }> | { feeds: { name: string; url: string }[] };
}

export function feedUrls(index: GbfsIndex): { info?: string; status?: string } {
  const data = index.data as Record<string, unknown>;
  const feeds: { name: string; url: string }[] =
    (data.feeds as { name: string; url: string }[] | undefined) ??
    ((data.en as { feeds?: { name: string; url: string }[] } | undefined)?.feeds ??
      (Object.values(data)[0] as { feeds?: { name: string; url: string }[] } | undefined)?.feeds ??
      []);
  const find = (n: string) => feeds.find((f) => f.name === n)?.url;
  return { info: find('station_information'), status: find('station_status') };
}

interface InfoStation {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  capacity?: number;
}

interface StatusStation {
  station_id: string;
  num_bikes_available?: number;
  num_docks_available?: number;
  num_bikes_available_types?: { electric?: number; classic?: number; smart?: number };
  /** Older GBFS extension used by some systems. */
  num_ebikes_available?: number;
  is_renting?: boolean | number;
  is_returning?: boolean | number;
  is_installed?: boolean | number;
  last_reported?: number;
}

const truthy = (v: boolean | number | undefined, fallback = true) => (v == null ? fallback : Boolean(v));

export function mergeStations(
  info: { data: { stations: InfoStation[] } },
  status: { data: { stations: StatusStation[] } },
): BCycleStation[] {
  const byId = new Map(status.data.stations.map((s) => [s.station_id, s]));
  const out: BCycleStation[] = [];
  for (const s of info.data.stations) {
    const st = byId.get(s.station_id);
    if (st && !truthy(st.is_installed)) continue;
    const bikes = st?.num_bikes_available ?? 0;
    const types = st?.num_bikes_available_types;
    const ebikes = types?.electric ?? st?.num_ebikes_available;
    const classic = types?.classic ?? (ebikes != null && types?.smart == null ? Math.max(0, bikes - ebikes) : undefined);
    out.push({
      id: s.station_id,
      name: s.name.trim(),
      lat: s.lat,
      lon: s.lon,
      address: s.address,
      capacity: s.capacity,
      bikes,
      ebikes,
      classic,
      docks: st?.num_docks_available ?? 0,
      renting: truthy(st?.is_renting, false),
      returning: truthy(st?.is_returning, false),
      lastReported: st?.last_reported,
    });
  }
  return out;
}

let cachedUrls: { info?: string; status?: string } | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`BCycle feed ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchBCycle(): Promise<BCycleStation[]> {
  if (!cachedUrls?.info || !cachedUrls?.status) {
    cachedUrls = feedUrls(await getJson<GbfsIndex>(BCYCLE_GBFS_URL));
  }
  if (!cachedUrls.info || !cachedUrls.status) throw new Error('BCycle feed missing station data');
  const [info, status] = await Promise.all([
    getJson<{ data: { stations: InfoStation[] } }>(cachedUrls.info),
    getJson<{ data: { stations: StatusStation[] } }>(cachedUrls.status),
  ]);
  return mergeStations(info, status);
}

/** "3 e-bikes · 2 classic", "4 bikes" or "1 e-bike": what's ready to rent. */
export function bikeSummary(s: Pick<BCycleStation, 'bikes' | 'ebikes' | 'classic'>): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (s.ebikes != null && s.classic != null && s.ebikes + s.classic === s.bikes && s.bikes > 0) {
    if (s.classic === 0) return plural(s.ebikes, 'e-bike', 'e-bikes');
    if (s.ebikes === 0) return plural(s.classic, 'classic bike', 'classic bikes');
    return `${plural(s.ebikes, 'e-bike', 'e-bikes')} · ${s.classic} classic`;
  }
  return plural(s.bikes, 'bike', 'bikes');
}

export const BCYCLE_PRICING_URL = 'https://madison.bcycle.com/pricing';
export const BCYCLE_APP_IOS = 'https://apps.apple.com/us/app/bcycle/id1475587580';
export const BCYCLE_APP_ANDROID = 'market://details?id=com.bcycle.bcycle';
export const BCYCLE_APP_ANDROID_WEB = 'https://play.google.com/store/apps/details?id=com.bcycle.bcycle';
