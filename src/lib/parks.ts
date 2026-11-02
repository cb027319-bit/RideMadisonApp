// Wisconsin state parks and recreation areas around Madison, with the trails
// inside each park (loaded when a park is opened). Data: OpenStreetMap.

import { LINE_STYLE, type LineStyle } from './labels';
import { overpassQuery, UNPAVED, type OverpassOpts } from './osm';
import { bboxOf, round5, simplify, type BBox, type LonLat } from './geo';
import { lineLengthM } from './trails';

/** Wider than the city coverage: a day trip from Madison (Devil's Lake, Blue Mound, Aztalan…). */
export const PARKS_BBOX: [number, number, number, number] = [-90.05, 42.7, -88.8, 43.5];

export interface Park {
  id: string; // 'osm:way:123' | 'osm:relation:456'
  name: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  lat: number;
  lon: number;
  bbox?: BBox;
  website?: string;
  operator?: string;
}

export type TrailAccess = 'bike' | 'no_bike' | 'unknown';

export interface ParkTrail {
  name: string;
  lengthM: number;
  access: TrailAccess;
  surface?: string;
  mtb: boolean;
  lines: LonLat[][];
}

interface El {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export function parksQuery(b = PARKS_BBOX): string {
  const box = `${b[1]},${b[0]},${b[3]},${b[2]}`;
  return `[out:json][timeout:90];
(
  nwr["boundary"="protected_area"]["name"~"State (Park|Recreation Area)"](${box});
  nwr["leisure"="park"]["name"~"State (Park|Recreation Area)"](${box});
  nwr["leisure"="nature_reserve"]["name"~"State (Park|Recreation Area)"](${box});
);
out tags center bb;`;
}

const normName = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();

export function parseParks(json: { elements?: El[] }): Park[] {
  const byName = new Map<string, Park>();
  for (const el of json.elements ?? []) {
    const name = el.tags?.name;
    if (!name || !/state (park|recreation area)/i.test(name)) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const park: Park = {
      id: `osm:${el.type}:${el.id}`,
      name: name.trim(),
      osmType: el.type,
      osmId: el.id,
      lat: round5(lat),
      lon: round5(lon),
      bbox: el.bounds
        ? { minLon: el.bounds.minlon, minLat: el.bounds.minlat, maxLon: el.bounds.maxlon, maxLat: el.bounds.maxlat }
        : undefined,
      website: el.tags?.website ?? el.tags?.['contact:website'],
      operator: el.tags?.operator,
    };
    // The same park is often mapped twice (boundary + park). Keep the larger outline.
    const key = normName(name);
    const prev = byName.get(key);
    const area = (p: Park) => (p.bbox ? (p.bbox.maxLon - p.bbox.minLon) * (p.bbox.maxLat - p.bbox.minLat) : 0);
    if (!prev || area(park) > area(prev)) byName.set(key, park);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Overpass area id for a closed way or relation (nodes have no area). */
export function areaId(p: Pick<Park, 'osmType' | 'osmId'>): number | null {
  if (p.osmType === 'way') return 2400000000 + p.osmId;
  if (p.osmType === 'relation') return 3600000000 + p.osmId;
  return null;
}

export function parkTrailsQuery(p: Park): string {
  const id = areaId(p);
  const scope = id ? `(area.a)` : `(around:2000,${p.lat},${p.lon})`;
  return `[out:json][timeout:60];
${id ? `area(id:${id})->.a;` : ''}
way["highway"~"^(path|footway|track|cycleway|bridleway)$"]["name"]${scope};
out tags geom;`;
}

function accessOf(t: Record<string, string>): TrailAccess {
  if (t.bicycle === 'no' || t.bicycle === 'dismount') return 'no_bike';
  if (t.highway === 'cycleway' || ['yes', 'designated', 'permissive'].includes(t.bicycle ?? '') || t['mtb:scale']) {
    return 'bike';
  }
  return 'unknown';
}

/** Group a park's ways into named trails with total length and bike access. */
export function parseParkTrails(json: { elements?: El[] }): ParkTrail[] {
  const groups = new Map<string, ParkTrail & { accessVotes: Record<TrailAccess, number>; surfaces: Map<string, number> }>();
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    const name = t.name?.trim();
    if (!name) continue;
    const line = simplify(el.geometry.map((g) => [round5(g.lon), round5(g.lat)] as LonLat), 0.00003);
    const len = lineLengthM(line);
    const key = normName(name);
    let g = groups.get(key);
    if (!g) {
      g = { name, lengthM: 0, access: 'unknown', mtb: false, lines: [], accessVotes: { bike: 0, no_bike: 0, unknown: 0 }, surfaces: new Map() };
      groups.set(key, g);
    }
    g.lengthM += len;
    g.lines.push(line);
    g.accessVotes[accessOf(t)] += len;
    if (t['mtb:scale'] || t.mtb === 'yes') g.mtb = true;
    if (t.surface) g.surfaces.set(t.surface, (g.surfaces.get(t.surface) ?? 0) + len);
  }
  const out: ParkTrail[] = [];
  for (const g of groups.values()) {
    const v = g.accessVotes;
    const access: TrailAccess = v.no_bike > v.bike ? 'no_bike' : v.bike > 0 ? 'bike' : 'unknown';
    const surface = [...g.surfaces.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    out.push({ name: g.name, lengthM: g.lengthM, access, surface, mtb: g.mtb, lines: g.lines });
  }
  // Bike-legal first, then longest.
  const rank: Record<TrailAccess, number> = { bike: 0, unknown: 1, no_bike: 2 };
  return out.filter((t) => t.lengthM >= 100).sort((a, b) => rank[a.access] - rank[b.access] || b.lengthM - a.lengthM);
}

export async function fetchParks(opts: OverpassOpts = {}): Promise<Park[]> {
  return parseParks((await overpassQuery(parksQuery(), opts)) as { elements?: El[] });
}

export async function fetchParkTrails(p: Park): Promise<ParkTrail[]> {
  return parseParkTrails((await overpassQuery(parkTrailsQuery(p))) as { elements?: El[] });
}

export function parkBBoxOf(p: Park, trails: ParkTrail[]): BBox | undefined {
  if (p.bbox) return p.bbox;
  const pts = trails.flatMap((t) => t.lines.flat());
  return pts.length ? bboxOf(pts) : undefined;
}

/** How a park trail is drawn: bike trails like the main network (paved solid / unpaved dashed),
 *  hiking-only paths as thin grey dots, unknown access as thin grey dashes. */
export function parkTrailStyle(t: Pick<ParkTrail, 'access' | 'surface'>): LineStyle {
  if (t.access === 'no_bike') return LINE_STYLE.hiking;
  if (t.access === 'unknown') return LINE_STYLE.parkUnknown;
  return t.surface && UNPAVED.has(t.surface) ? LINE_STYLE.path_unpaved : LINE_STYLE.path_paved;
}
