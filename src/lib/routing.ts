// Bike routing (BRouter), place search (Photon / OpenStreetMap), GPX export
// and Google Maps hand-off. Parsing and builders are pure and unit-tested.
//
// Both public servers are free and keyless but meant for light use. Before
// launch, routing moves to our own BRouter instance (same API) — see README.

import { COVERAGE_BBOX, MADISON_CENTER, USER_AGENT } from './config';
import { UNPAVED } from './osm';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export type RouteProfile = 'quiet' | 'balanced' | 'fast';

export const PROFILE_META: Record<RouteProfile, { label: string; brouter: string; hint: string }> = {
  quiet: { label: 'Quietest', brouter: 'safety', hint: 'Bike paths and calm streets, even if longer' },
  balanced: { label: 'Balanced', brouter: 'trekking', hint: 'Mostly bike-friendly, reasonably direct' },
  fast: { label: 'Fastest', brouter: 'fastbike', hint: 'Most direct, may use busier roads' },
};

export interface RouteBreakdown {
  /** Shares of distance, 0..1. path + lane + quiet + road = 1 */
  path: number;
  lane: number;
  quiet: number;
  road: number;
  unpaved: number;
}

export interface RouteResult {
  coords: LatLon[];
  elevations: (number | null)[];
  distanceM: number;
  climbM: number;
  timeS: number;
  breakdown?: RouteBreakdown;
}

// ---------- BRouter ----------

const BROUTER_URL = 'https://brouter.de/brouter';

export function brouterUrl(points: LatLon[], profile: RouteProfile): string {
  const lonlats = points.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join('|');
  return `${BROUTER_URL}?lonlats=${lonlats}&profile=${PROFILE_META[profile].brouter}&alternativeidx=0&format=geojson`;
}

interface BRouterGeoJSON {
  features?: {
    properties?: Record<string, string | number | string[][] | undefined>;
    geometry?: { type: string; coordinates: number[][] };
  }[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

const QUIET = new Set(['residential', 'living_street', 'service', 'unclassified', 'pedestrian']);

/** What kind of way a BRouter segment uses, from its OSM tags. */
export function classifyWayTags(tags: Record<string, string>): 'path' | 'lane' | 'quiet' | 'road' {
  const hw = tags.highway ?? '';
  if (hw === 'cycleway') return 'path';
  if (['path', 'footway', 'track', 'bridleway'].includes(hw)) return 'path';
  const lane = ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right'].some((k) => /^(lane|track)$/.test(tags[k] ?? ''));
  if (lane) return 'lane';
  if (QUIET.has(hw)) return 'quiet';
  return 'road';
}

function parseTags(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.split(' ')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

/** Shares of the route on trails, bike lanes, quiet streets and busier roads. */
export function parseBreakdown(messages: unknown): RouteBreakdown | undefined {
  if (!Array.isArray(messages) || messages.length < 2) return undefined;
  const header = messages[0] as string[];
  const iDist = header.indexOf('Distance');
  const iTags = header.indexOf('WayTags');
  if (iDist < 0 || iTags < 0) return undefined;
  const totals = { path: 0, lane: 0, quiet: 0, road: 0, unpaved: 0 };
  let all = 0;
  for (const row of messages.slice(1) as string[][]) {
    const d = Number(row[iDist]) || 0;
    const tags = parseTags(row[iTags] ?? '');
    totals[classifyWayTags(tags)] += d;
    const surface = tags.surface;
    if ((surface && UNPAVED.has(surface)) || (tags.highway === 'track' && !surface)) totals.unpaved += d;
    all += d;
  }
  if (!all) return undefined;
  return {
    path: totals.path / all,
    lane: totals.lane / all,
    quiet: totals.quiet / all,
    road: totals.road / all,
    unpaved: totals.unpaved / all,
  };
}

export function parseBRouter(json: BRouterGeoJSON): RouteResult {
  const f = json.features?.[0];
  if (!f?.geometry || f.geometry.type !== 'LineString' || f.geometry.coordinates.length < 2) {
    throw new Error('No route found');
  }
  const coords: LatLon[] = [];
  const elevations: (number | null)[] = [];
  for (const c of f.geometry.coordinates) {
    coords.push({ latitude: c[1], longitude: c[0] });
    elevations.push(c.length > 2 && Number.isFinite(c[2]) ? c[2] : null);
  }
  const p = f.properties ?? {};
  return {
    coords,
    elevations,
    distanceM: num(p['track-length']),
    climbM: num(p['filtered ascend']),
    timeS: num(p['total-time']),
    breakdown: parseBreakdown(p.messages),
  };
}

export async function fetchRoute(points: LatLon[], profile: RouteProfile, signal?: AbortSignal): Promise<RouteResult> {
  const res = await fetch(brouterUrl(points, profile), { headers: { 'User-Agent': USER_AGENT }, signal });
  const text = await res.text();
  if (!res.ok) {
    // BRouter explains failures in plain text, e.g. a point far from any road.
    const reason = text.includes('not mapped') || text.includes('no match')
      ? 'A stop is too far from a bike-legal road or path'
      : `Routing failed (${res.status})`;
    throw new Error(reason);
  }
  return parseBRouter(JSON.parse(text) as BRouterGeoJSON);
}

// ---------- Photon place search ----------

export interface PlaceResult {
  id: string;
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
}

interface PhotonGeoJSON {
  features?: {
    geometry?: { coordinates: [number, number] };
    properties?: Record<string, string | number | undefined>;
  }[];
}

export function parsePhoton(json: PhotonGeoJSON): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const f of json.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c) continue;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const title = String(p.name ?? (street || p.city || 'Unnamed place'));
    const subtitleParts = [p.name && street ? street : null, p.city ?? p.district, p.state === 'Wisconsin' ? null : p.state]
      .filter(Boolean)
      .map(String);
    const id = `${p.osm_type ?? ''}${p.osm_id ?? `${c[0]},${c[1]}`}`;
    if (out.some((r) => r.id === id)) continue;
    out.push({
      id,
      title,
      subtitle: subtitleParts.length ? subtitleParts.join(', ') : undefined,
      latitude: c[1],
      longitude: c[0],
    });
  }
  return out;
}

/** One short line for a reverse-geocoded point, e.g. "1200 Williamson St". */
export function shortLabel(json: PhotonGeoJSON): string | null {
  const p = json.features?.[0]?.properties;
  if (!p) return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  return (p.name ? String(p.name) : null) ?? (street || null);
}

const PHOTON = 'https://photon.komoot.io';

export async function searchPlaces(query: string, near?: LatLon | null, signal?: AbortSignal): Promise<PlaceResult[]> {
  const center = near ?? MADISON_CENTER;
  const [minLon, minLat, maxLon, maxLat] = COVERAGE_BBOX;
  // Bias toward the rider, limited to a generous box around greater Madison.
  const url =
    `${PHOTON}/api/?q=${encodeURIComponent(query)}&limit=8&lang=en` +
    `&lat=${center.latitude}&lon=${center.longitude}` +
    `&bbox=${minLon - 0.35},${minLat - 0.25},${maxLon + 0.35},${maxLat + 0.25}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return parsePhoton((await res.json()) as PhotonGeoJSON);
}

export async function reverseLabel(p: LatLon): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${p.latitude}&lon=${p.longitude}&limit=1&lang=en`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return shortLabel((await res.json()) as PhotonGeoJSON);
  } catch {
    return null;
  }
}

// ---------- GPX + hand-offs ----------

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildGpx(name: string, route: Pick<RouteResult, 'coords' | 'elevations'>): string {
  const pts = route.coords
    .map((c, i) => {
      const ele = route.elevations[i];
      const eleTag = ele == null ? '' : `<ele>${ele.toFixed(1)}</ele>`;
      return `<trkpt lat="${c.latitude.toFixed(6)}" lon="${c.longitude.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ride Madison" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name></metadata>
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Google Maps bike directions through our stops (it allows up to 9 in between). */
export function googleMapsUrl(points: LatLon[]): string {
  const fmt = (p: LatLon) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
  const origin = points[0];
  const destination = points[points.length - 1];
  const middle = points.slice(1, -1).slice(0, 9);
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${fmt(origin)}&destination=${fmt(destination)}`;
  if (middle.length) url += `&waypoints=${encodeURIComponent(middle.map(fmt).join('|'))}`;
  return url;
}

/**
 * Apple Maps bike directions through our stops. Uses Apple's directions link
 * (cycling mode on iOS 18.4+; older iOS opens Maps with your default mode).
 */
export function appleMapsUrl(points: LatLon[]): string {
  const fmt = (p: LatLon) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
  const origin = points[0];
  const destination = points[points.length - 1];
  const middle = points.slice(1, -1).slice(0, 13);
  let url = `https://maps.apple.com/directions?source=${fmt(origin)}&destination=${fmt(destination)}&mode=cycling`;
  for (const m of middle) url += `&waypoint=${fmt(m)}`;
  return url;
}

export function formatDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

export const metersToFeet = (m: number) => Math.round(m * 3.281);
