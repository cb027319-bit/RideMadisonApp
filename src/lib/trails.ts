// Trails: OSM splits a trail into many short ways. Riders think in whole
// trails ("Capital City State Trail"), so we group segments by name, measure
// them, attach local rules, and find which trail a map tap was aimed at.

import { distanceMeters, type BBox, type LonLat } from './geo';
import type { BikePath, PathKind } from './osm';

export interface Trail {
  id: string;
  name?: string;
  kind: PathKind;
  pathIds: string[];
  lengthM: number;
  /** Share of length that is unpaved (0..1). */
  unpavedShare: number;
  /** Most common surface tag, if mapped. */
  surface?: string;
  bbox: BBox;
  rules?: TrailRules;
}

export interface TrailRules {
  /** Short badge, e.g. "State trail pass". */
  badge: string;
  pass: string;
  ebikes: string;
  manager: string;
  url: string;
}

// ---------- local rules (verified Oct 2026 against dnr.wisconsin.gov) ----------

const DNR_PASS = 'State trail pass required to bike, age 16+ ($5/day, $25/year).';
const DNR_EBIKES = 'Class 1 and 3 e-bikes generally allowed at up to 15 mph; Class 2 not allowed under motor power.';

const RULES: { match: RegExp; rules: TrailRules }[] = [
  {
    match: /capital city/i,
    rules: {
      badge: 'Pass on part',
      pass: 'State trail pass required (age 16+, $5/day or $25/year) only on the 9 miles between Verona Rd and Nob Hill Rd. Free inside the City of Madison.',
      ebikes: DNR_EBIKES,
      manager: 'Dane County Parks / WI DNR',
      url: 'https://dnr.wisconsin.gov/topic/parks/capcity/recreation',
    },
  },
  {
    match: /military ridge/i,
    rules: { badge: 'State trail pass', pass: DNR_PASS, ebikes: DNR_EBIKES, manager: 'WI DNR', url: 'https://dnr.wisconsin.gov/topic/parks/militaryridge' },
  },
  {
    match: /badger state/i,
    rules: { badge: 'State trail pass', pass: DNR_PASS, ebikes: DNR_EBIKES, manager: 'WI DNR', url: 'https://dnr.wisconsin.gov/topic/parks/badger' },
  },
  {
    match: /glacial drumlin/i,
    rules: { badge: 'State trail pass', pass: DNR_PASS, ebikes: DNR_EBIKES, manager: 'WI DNR', url: 'https://dnr.wisconsin.gov/topic/parks/glacialdrumlin' },
  },
];

export const TRAIL_PASS_URL = 'https://dnr.wisconsin.gov/topic/parks/trailpass';

export function rulesFor(name?: string): TrailRules | undefined {
  if (!name) return undefined;
  return RULES.find((r) => r.match.test(name))?.rules;
}

// ---------- grouping ----------

export function lineLengthM(coords: LonLat[]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    m += distanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return m;
}

/** Off-street paths group by name; lanes group by street name; unnamed stay single. */
function groupKey(p: BikePath): string {
  if (!p.name) return p.id;
  return p.kind === 'lane' ? `lane:${p.name.toLowerCase()}` : `trail:${p.name.toLowerCase()}`;
}

export function groupTrails(paths: BikePath[]): { trails: Trail[]; trailOfPath: Map<string, string> } {
  const groups = new Map<string, BikePath[]>();
  for (const p of paths) {
    const k = groupKey(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const trails: Trail[] = [];
  const trailOfPath = new Map<string, string>();
  for (const [id, members] of groups) {
    let length = 0;
    let unpaved = 0;
    const surfaceLen = new Map<string, number>();
    const kindLen = new Map<PathKind, number>();
    const bbox = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
    for (const m of members) {
      const l = lineLengthM(m.coords);
      length += l;
      if (m.kind === 'path_unpaved') unpaved += l;
      if (m.surface) surfaceLen.set(m.surface, (surfaceLen.get(m.surface) ?? 0) + l);
      kindLen.set(m.kind, (kindLen.get(m.kind) ?? 0) + l);
      bbox.minLon = Math.min(bbox.minLon, m.bbox.minLon);
      bbox.minLat = Math.min(bbox.minLat, m.bbox.minLat);
      bbox.maxLon = Math.max(bbox.maxLon, m.bbox.maxLon);
      bbox.maxLat = Math.max(bbox.maxLat, m.bbox.maxLat);
      trailOfPath.set(m.id, id);
    }
    const top = <K,>(map: Map<K, number>) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    trails.push({
      id,
      name: members[0].name,
      kind: top(kindLen) ?? members[0].kind,
      pathIds: members.map((m) => m.id),
      lengthM: length,
      unpavedShare: length ? unpaved / length : 0,
      surface: top(surfaceLen),
      bbox,
      rules: members[0].kind === 'lane' ? undefined : rulesFor(members[0].name),
    });
  }
  return { trails, trailOfPath };
}

// ---------- tap hit-testing ----------

/** Squared distance from p to segment ab in a local planar projection. */
function sqDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  let dx = bx - ax;
  let dy = by - ay;
  let t = 0;
  if (dx !== 0 || dy !== 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  dx = px - (ax + t * dx);
  dy = py - (ay + t * dy);
  return dx * dx + dy * dy;
}

/**
 * The path nearest to a tap, within `toleranceDeg` (latitude degrees).
 * Off-street trails win ties against on-street lanes.
 */
export function nearestPath(
  paths: BikePath[],
  tap: { latitude: number; longitude: number },
  toleranceDeg: number,
  includeLanes = true,
): BikePath | null {
  const k = Math.cos((tap.latitude * Math.PI) / 180);
  const tx = tap.longitude * k;
  const ty = tap.latitude;
  const tolLon = toleranceDeg / k;
  let best: BikePath | null = null;
  let bestD = Infinity;
  for (const p of paths) {
    if (!includeLanes && p.kind === 'lane') continue;
    const b = p.bbox;
    if (tap.longitude < b.minLon - tolLon || tap.longitude > b.maxLon + tolLon) continue;
    if (tap.latitude < b.minLat - toleranceDeg || tap.latitude > b.maxLat + toleranceDeg) continue;
    const penalty = p.kind === 'lane' ? 4 : 1; // squared weight: lanes must be 2x closer to win
    for (let i = 1; i < p.coords.length; i++) {
      const a = p.coords[i - 1];
      const c = p.coords[i];
      const d = sqDist(tx, ty, a[0] * k, a[1], c[0] * k, c[1]) * penalty;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return bestD <= toleranceDeg * toleranceDeg ? best : null;
}

/** Point on the trail closest to `from` (for "route to this trail"). */
export function closestPointOnTrail(
  paths: BikePath[],
  from: { latitude: number; longitude: number },
): { latitude: number; longitude: number } | null {
  let best: LonLat | null = null;
  let bestD = Infinity;
  for (const p of paths) {
    for (const c of p.coords) {
      const d = (c[0] - from.longitude) ** 2 + (c[1] - from.latitude) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best ? { latitude: best[1], longitude: best[0] } : null;
}
