// OpenStreetMap data via the Overpass API: bike paths/lanes and rider places
// (bike shops, fix-it stations, bike parking, drinking water).
// Parsing is pure and unit-tested (see tests/osm.test.ts).

import { COVERAGE_BBOX, OVERPASS_URLS, USER_AGENT } from './config';
import { bboxOf, round5, simplify, type BBox, type LonLat } from './geo';

// ---------- types ----------

export type PathKind = 'path_paved' | 'path_unpaved' | 'lane';

export interface BikePath {
  id: string; // 'osm:way:<id>'
  kind: PathKind;
  name?: string;
  surface?: string;
  coords: LonLat[];
  bbox: BBox;
}

export type PlaceKind = 'shop' | 'repair' | 'parking' | 'water' | 'food' | 'drink';

export interface Place {
  id: string; // 'osm:node:<id>' / 'osm:way:<id>'
  kind: PlaceKind;
  name?: string;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  website?: string;
  hours?: string;
  /** Kind-specific details, e.g. parking capacity/covered, repair tools. */
  details: string[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

// ---------- queries ----------

function bboxClause([minLon, minLat, maxLon, maxLat]: [number, number, number, number]) {
  return `${minLat},${minLon},${maxLat},${maxLon}`;
}

export function pathsQuery(bounds = COVERAGE_BBOX): string {
  const b = bboxClause(bounds);
  return `[out:json][timeout:120];
(
  way["highway"="cycleway"](${b});
  way["highway"~"^(path|track|footway|bridleway)$"]["bicycle"~"^(designated|yes)$"](${b});
  way["highway"]["cycleway"~"^(lane|track|separate)$"](${b});
  way["highway"]["cycleway:both"~"^(lane|track)$"](${b});
  way["highway"]["cycleway:left"~"^(lane|track)$"](${b});
  way["highway"]["cycleway:right"~"^(lane|track)$"](${b});
);
out tags geom;`;
}

export function placesQuery(bounds = COVERAGE_BBOX): string {
  const b = bboxClause(bounds);
  return `[out:json][timeout:90];
(
  nwr["shop"="bicycle"](${b});
  nwr["amenity"="bicycle_repair_station"](${b});
  nwr["amenity"="bicycle_parking"](${b});
  node["amenity"="drinking_water"](${b});
);
out tags center;`;
}

/** Restaurants, cafés, bars and breweries (loaded separately; it's a bigger list). */
export type FoodKind = 'food' | 'drink';

/** Restaurants and cafés ('food') or bars, pubs and breweries ('drink'). Split in two so
 *  each request stays small enough for the public servers to answer reliably. */
export function foodQuery(kind: FoodKind, bounds = COVERAGE_BBOX): string {
  const b = bboxClause(bounds);
  const body =
    kind === 'food'
      ? `nw["amenity"~"^(restaurant|cafe|fast_food|ice_cream)$"]["name"](${b});`
      : `nw["amenity"~"^(bar|pub|biergarten)$"]["name"](${b});
  nw["craft"~"^(brewery|winery|distillery)$"]["name"](${b});`;
  return `[out:json][timeout:90];
(
  ${body}
);
out tags center;`;
}

// ---------- classification ----------

export const UNPAVED = new Set([
  'unpaved', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground',
  'grass', 'sand', 'mud', 'woodchips', 'pebblestone', 'rock',
]);

const LANE_RE = /^(lane|track)$/;

export function classifyWay(tags: Record<string, string>): PathKind | null {
  const hw = tags.highway;
  if (!hw) return null;
  if (tags.access === 'private' || tags.access === 'no' || tags.bicycle === 'no') return null;

  const offStreet =
    hw === 'cycleway' ||
    (['path', 'track', 'footway', 'bridleway'].includes(hw) &&
      (tags.bicycle === 'designated' || tags.bicycle === 'yes'));
  if (offStreet) {
    const surface = tags.surface;
    const unpaved = (surface && UNPAVED.has(surface)) || (hw === 'track' && !surface);
    return unpaved ? 'path_unpaved' : 'path_paved';
  }

  const hasLane = ['cycleway', 'cycleway:both', 'cycleway:left', 'cycleway:right'].some(
    (k) => tags[k] && LANE_RE.test(tags[k]),
  );
  return hasLane ? 'lane' : null;
}

// ---------- parsing ----------

/** ~3 m tolerance keeps shapes faithful while cutting points a lot. */
const SIMPLIFY_TOLERANCE_DEG = 0.00003;

export function parsePaths(json: { elements?: OverpassElement[] }): BikePath[] {
  const out: BikePath[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const kind = classifyWay(el.tags ?? {});
    if (!kind) continue;
    const raw: LonLat[] = el.geometry.map((g) => [round5(g.lon), round5(g.lat)]);
    const coords = simplify(raw, SIMPLIFY_TOLERANCE_DEG);
    out.push({
      id: `osm:way:${el.id}`,
      kind,
      name: el.tags?.name,
      surface: el.tags?.surface,
      coords,
      bbox: bboxOf(coords),
    });
  }
  return out;
}

function placeKind(tags: Record<string, string>): PlaceKind | null {
  if (tags.shop === 'bicycle') return 'shop';
  if (tags.amenity === 'bicycle_repair_station') return 'repair';
  if (tags.amenity === 'bicycle_parking') return 'parking';
  if (tags.amenity === 'drinking_water') return 'water';
  if (['bar', 'pub', 'biergarten'].includes(tags.amenity ?? '') || ['brewery', 'winery', 'distillery'].includes(tags.craft ?? '')) {
    return 'drink';
  }
  if (['restaurant', 'cafe', 'fast_food', 'ice_cream'].includes(tags.amenity ?? '')) return 'food';
  return null;
}

function address(tags: Record<string, string>): string | undefined {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [street, tags['addr:city']].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

const PARKING_TYPES: Record<string, string> = {
  stands: 'Bike racks',
  wall_loops: 'Wheel-bender racks',
  rack: 'Bike racks',
  shed: 'Bike shed',
  lockers: 'Bike lockers',
  building: 'Indoor parking',
  bollard: 'Bollards',
  two_tier: 'Two-tier racks',
  shelter: 'Sheltered racks',
};

function details(kind: PlaceKind, t: Record<string, string>): string[] {
  const d: string[] = [];
  if (kind === 'parking') {
    if (t.bicycle_parking) d.push(PARKING_TYPES[t.bicycle_parking] ?? t.bicycle_parking.replace(/_/g, ' '));
    if (t.capacity) d.push(`${t.capacity} spaces`);
    if (t.covered === 'yes') d.push('Covered');
    if (t.access === 'customers') d.push('Customers only');
    if (t.fee === 'yes') d.push('Fee');
  }
  if (kind === 'repair') {
    if (t['service:bicycle:pump'] === 'yes') d.push('Air pump');
    if (t['service:bicycle:tools'] === 'yes') d.push('Tools');
    if (t['service:bicycle:stand'] === 'yes') d.push('Repair stand');
    if (t['service:bicycle:chain_tool'] === 'yes') d.push('Chain tool');
  }
  if (kind === 'shop') {
    if (t['service:bicycle:repair'] === 'yes') d.push('Repairs');
    if (t['service:bicycle:rental'] === 'yes') d.push('Rentals');
    if (t['service:bicycle:second_hand'] === 'yes') d.push('Used bikes');
  }
  if (kind === 'water' && t.seasonal === 'yes') d.push('Seasonal');
  if (kind === 'food' || kind === 'drink') {
    const type: Record<string, string> = {
      restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Quick bite', ice_cream: 'Ice cream',
      bar: 'Bar', pub: 'Pub', biergarten: 'Beer garden',
    };
    const craft: Record<string, string> = { brewery: 'Brewery', winery: 'Winery', distillery: 'Distillery' };
    const label = (t.craft && craft[t.craft]) || (t.amenity && type[t.amenity]);
    if (label) d.push(label);
    if (t.cuisine) d.push(t.cuisine.split(';').slice(0, 2).map((c) => c.replace(/_/g, ' ')).join(', '));
    if (t.outdoor_seating === 'yes') d.push('Patio');
  }
  return d;
}

export function parsePlaces(json: { elements?: OverpassElement[] }): Place[] {
  const out: Place[] = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const kind = placeKind(tags);
    if (!kind) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    if (kind === 'parking' && tags.access === 'private') continue;
    out.push({
      id: `osm:${el.type}:${el.id}`,
      kind,
      name: tags.name ?? tags.brand,
      lat: round5(lat),
      lon: round5(lon),
      address: address(tags),
      phone: tags.phone ?? tags['contact:phone'],
      website: tags.website ?? tags['contact:website'],
      hours: tags.opening_hours,
      details: details(kind, tags),
    });
  }
  return out;
}

// ---------- fetching ----------

/** Run an Overpass query against the public mirrors (first one that answers wins). */
export async function overpassQuery(query: string): Promise<{ elements?: unknown[] }> {
  return overpass(query);
}

async function overpass(query: string, timeoutMs = 60000): Promise<{ elements?: OverpassElement[] }> {
  const errors: string[] = [];
  for (const url of OVERPASS_URLS) {
    const host = url.split('/')[2];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
      // A busy server can answer 200 with a partial list plus a warning: treat that as a
      // failure so a half-empty list is never shown or cached.
      if (json.remark && (!json.elements?.length || /runtime error|timed? ?out|out of memory/i.test(json.remark))) {
        throw new Error(json.remark.slice(0, 80));
      }
      return json;
    } catch (err) {
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err);
      errors.push(`${host}: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(errors.join(' | '));
}

export async function fetchPaths(): Promise<BikePath[]> {
  return parsePaths(await overpass(pathsQuery()));
}

export async function fetchPlaces(): Promise<Place[]> {
  return parsePlaces(await overpass(placesQuery()));
}

export async function fetchFood(kind: FoodKind): Promise<Place[]> {
  const list = parsePlaces(await overpass(foodQuery(kind), 30000)).filter((p) => p.kind === kind);
  // Greater Madison always has hundreds of each: an empty answer means something went wrong.
  if (!list.length) throw new Error('No places came back');
  return list;
}
