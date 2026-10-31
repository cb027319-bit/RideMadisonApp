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
    out.push({
      id: s.station_id,
      name: s.name.trim(),
      lat: s.lat,
      lon: s.lon,
      address: s.address,
      capacity: s.capacity,
      bikes: st?.num_bikes_available ?? 0,
      ebikes: st?.num_bikes_available_types?.electric,
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
