// Bike routing (BRouter), place search (Photon / OpenStreetMap), GPX export
// and Google Maps hand-off. Parsing and builders are pure and unit-tested.
//
// Both public servers are free and keyless but meant for light use. Before
// launch, routing moves to our own BRouter instance (same API) — see README.

import { COVERAGE_BBOX, MADISON_CENTER, USER_AGENT } from './config';
import { lang, t } from './i18n';
import { UNPAVED } from './osm';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export type RouteProfile = 'quiet' | 'balanced' | 'fast';

/** Labels are getters so they always read the current language. */
function profileMeta(id: RouteProfile, brouter: string) {
  return {
    brouter,
    get label() {
      return t(`route.profile.${id}.label`);
    },
    get hint() {
      return t(`route.profile.${id}.hint`);
    },
    get surface() {
      return t(`route.profile.${id}.surface`);
    },
  };
}

export const PROFILE_META: Record<RouteProfile, { readonly label: string; brouter: string; readonly hint: string; readonly surface: string }> = {
  quiet: profileMeta('quiet', 'safety'),
  balanced: profileMeta('balanced', 'trekking'),
  fast: profileMeta('fast', 'fastbike'),
};

export interface RouteBreakdown {
  /** Shares of distance, 0..1. path + lane + quiet + road = 1 */
  path: number;
  lane: number;
  quiet: number;
  road: number;
  unpaved: number;
}

/** A turn cue from BRouter's voice hints, tied to a coordinate index. */
export interface RouteCue {
  /** Index into `coords` where the maneuver happens. */
  index: number;
  kind: CueKind;
  /** Roundabout exit number, when given. */
  exit?: number;
}

export type CueKind =
  | 'continue' | 'left' | 'slight-left' | 'sharp-left' | 'right' | 'slight-right' | 'sharp-right'
  | 'keep-left' | 'keep-right' | 'uturn' | 'roundabout-right' | 'roundabout-left';

/** The way the route follows from coordinate `from` on (until the next entry). */
export interface WaySpan {
  from: number;
  name?: string;
}

export interface RouteResult {
  coords: LatLon[];
  elevations: (number | null)[];
  distanceM: number;
  climbM: number;
  timeS: number;
  breakdown?: RouteBreakdown;
  /** Turn cues from the router (absent on older saved rides). */
  cues?: RouteCue[];
  /** Street and trail names along the route (absent on older saved rides). */
  ways?: WaySpan[];
}

// ---------- BRouter ----------

const BROUTER_URL = 'https://brouter.de/brouter';

export function brouterUrl(points: LatLon[], profile: RouteProfile): string {
  const lonlats = points.map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join('|');
  return `${BROUTER_URL}?lonlats=${lonlats}&profile=${PROFILE_META[profile].brouter}&alternativeidx=0&format=geojson&timode=2`;
}

interface BRouterGeoJSON {
  features?: {
    properties?: Record<string, unknown>;
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
  // Values may contain spaces ("name=Capital City State Trail"): a token without
  // "=" belongs to the previous value.
  let last: string | null = null;
  for (const kv of s.split(' ')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    if (i <= 0) {
      if (last) out[last] += ` ${kv}`;
      continue;
    }
    last = kv.slice(0, i);
    out[last] = kv.slice(i + 1);
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

/** BRouter voice hint command codes (timode=2) -> our cue kinds. */
const CUE_CODES: Record<number, CueKind> = {
  1: 'continue',
  2: 'left',
  3: 'slight-left',
  4: 'sharp-left',
  5: 'right',
  6: 'slight-right',
  7: 'sharp-right',
  8: 'keep-left',
  9: 'keep-right',
  10: 'uturn',
  11: 'uturn',
  12: 'uturn',
  13: 'roundabout-right',
  14: 'roundabout-left',
  // 15 beeline and 16 off-road segments have no turn to announce.
};

/**
 * Turn cues from BRouter's `voicehints`: rows of [index, command, exitNumber,
 * distance, angle]. Anything malformed is skipped, never thrown.
 */
export function parseVoiceHints(raw: unknown, coordCount: number): RouteCue[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteCue[] = [];
  for (const h of raw) {
    if (!Array.isArray(h) || h.length < 2) continue;
    const index = Number(h[0]);
    const kind = CUE_CODES[Number(h[1])];
    if (!kind || !Number.isInteger(index) || index <= 0 || index >= coordCount) continue;
    const exit = Number(h[2]);
    const cue: RouteCue = { index, kind };
    if (kind.startsWith('roundabout') && Number.isInteger(exit) && exit > 0) cue.exit = exit;
    if (out.length && out[out.length - 1].index >= index) continue; // keep them in route order
    out.push(cue);
  }
  return out;
}

/** BRouter writes message coordinates as micro-degrees; accept plain degrees too. */
const deg = (v: unknown) => {
  const n = Number(v);
  return Math.abs(n) > 1000 ? n / 1e6 : n;
};

/**
 * Street and trail names along the route, from the `name=` way tags in
 * BRouter's messages table. Each message row ends a stretch with the same
 * tags, so a row's name applies from the previous row's point to its own.
 */
export function parseWays(messages: unknown, coords: LatLon[]): WaySpan[] {
  if (!Array.isArray(messages) || messages.length < 2 || coords.length < 2) return [];
  const header = messages[0];
  if (!Array.isArray(header)) return [];
  const iLon = header.indexOf('Longitude');
  const iLat = header.indexOf('Latitude');
  const iTags = header.indexOf('WayTags');
  if (iLon < 0 || iLat < 0 || iTags < 0) return [];
  const k = Math.cos((coords[0].latitude * Math.PI) / 180);
  const d2 = (a: LatLon, lat: number, lon: number) => ((a.latitude - lat) * 110540) ** 2 + ((a.longitude - lon) * 111320 * k) ** 2;
  const spans: WaySpan[] = [];
  let ptr = 0;
  let from = 0;
  for (const row of messages.slice(1)) {
    if (!Array.isArray(row)) continue;
    const lat = deg(row[iLat]);
    const lon = deg(row[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Nearest route point at or after the last match (rows follow the route).
    let best = -1;
    let bestD = Infinity;
    for (let j = ptr; j < coords.length; j++) {
      const d = d2(coords[j], lat, lon);
      if (d < bestD) {
        bestD = d;
        best = j;
        if (d < 1) break;
      }
    }
    if (best < 0 || bestD > 30 * 30) continue;
    const name = parseTags(String(row[iTags] ?? '')).name?.trim() || undefined;
    const prev = spans[spans.length - 1];
    if (best > from) {
      if (prev && prev.name === name) {
        // same way continues
      } else {
        spans.push(name ? { from, name } : { from });
      }
      from = best;
    }
    ptr = best;
  }
  return spans;
}

/** Name of the way the route follows just after coordinate `index`. */
export function wayNameAt(ways: WaySpan[] | undefined, index: number): string | undefined {
  if (!ways?.length) return undefined;
  let name: string | undefined;
  for (const w of ways) {
    if (w.from > index) break;
    name = w.name;
  }
  return name;
}

export function parseBRouter(json: BRouterGeoJSON): RouteResult {
  const f = json.features?.[0];
  if (!f?.geometry || f.geometry.type !== 'LineString' || f.geometry.coordinates.length < 2) {
    throw new Error(t('route.err.noRoute'));
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
    cues: parseVoiceHints(p.voicehints, coords.length),
    ways: parseWays(p.messages, coords),
  };
}

export async function fetchRoute(points: LatLon[], profile: RouteProfile, signal?: AbortSignal): Promise<RouteResult> {
  const res = await fetch(brouterUrl(points, profile), { headers: { 'User-Agent': USER_AGENT }, signal });
  const text = await res.text();
  if (!res.ok) {
    // BRouter explains failures in plain text, e.g. a point far from any road.
    const reason = text.includes('not mapped') || text.includes('no match')
      ? t('route.err.tooFar')
      : t('route.err.routingFailedStatus', { status: res.status });
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
    const title = String(p.name ?? (street || p.city || t('route.unnamedPlace')));
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
/** Photon has no Spanish: 'default' gives local (English) names for Madison. */
const photonLang = () => (lang() === 'es' ? 'default' : 'en');

export async function searchPlaces(query: string, near?: LatLon | null, signal?: AbortSignal): Promise<PlaceResult[]> {
  const center = near ?? MADISON_CENTER;
  const [minLon, minLat, maxLon, maxLat] = COVERAGE_BBOX;
  // Bias toward the rider, limited to a generous box around greater Madison.
  const url =
    `${PHOTON}/api/?q=${encodeURIComponent(query)}&limit=8&lang=${photonLang()}` +
    `&lat=${center.latitude}&lon=${center.longitude}` +
    `&bbox=${minLon - 0.35},${minLat - 0.25},${maxLon + 0.35},${maxLat + 0.25}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!res.ok) throw new Error(t('route.err.searchFailed', { status: res.status }));
  return parsePhoton((await res.json()) as PhotonGeoJSON);
}

export async function reverseLabel(p: LatLon): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${p.latitude}&lon=${p.longitude}&limit=1&lang=${photonLang()}`, {
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

export function buildGpx(
  name: string,
  route: Pick<RouteResult, 'coords' | 'elevations'>,
  waypoints: (LatLon & { label: string })[] = [],
): string {
  const wpts = waypoints
    .map((w) => `<wpt lat="${w.latitude.toFixed(6)}" lon="${w.longitude.toFixed(6)}"><name>${xml(w.label)}</name></wpt>`)
    .join('\n  ');
  const pts = route.coords
    .map((c, i) => {
      const ele = route.elevations[i];
      const eleTag = ele == null ? '' : `<ele>${ele.toFixed(1)}</ele>`;
      return `<trkpt lat="${c.latitude.toFixed(6)}" lon="${c.longitude.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ride Madison" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name></metadata>${wpts ? `\n  ${wpts}` : ''}
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
  if (m < 60) return t('route.dur.min', { m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? t('route.dur.hrMin', { h, m: rem }) : t('route.dur.hr', { h });
}

export const metersToFeet = (m: number) => Math.round(m * 3.281);
