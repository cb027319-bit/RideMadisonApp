// Turn-by-turn navigation and ride preview geometry (pure, unit-tested).
// Turns are detected from the route's shape, which works for any route the
// planner produces; trail names are added by the screen from our trail data.

import { distanceMeters } from './geo';
import type { LatLon } from './routing';

export type ManeuverType =
  | 'slight-left' | 'left' | 'sharp-left'
  | 'slight-right' | 'right' | 'sharp-right'
  | 'uturn' | 'arrive';

export interface Maneuver {
  type: ManeuverType;
  /** Meters from the start of the route. */
  at: number;
  index: number;
  point: LatLon;
  /** Name of the trail or street after the turn, if known. */
  onto?: string;
}

export interface RouteLine {
  coords: LatLon[];
  /** Cumulative meters at each coordinate. */
  cum: number[];
  total: number;
}

export function buildLine(coords: LatLon[]): RouteLine {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + distanceMeters(coords[i - 1].latitude, coords[i - 1].longitude, coords[i].latitude, coords[i].longitude));
  }
  return { coords, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Compass bearing in degrees (0 = north) from a to b. */
export function bearing(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δλ = toRad(b.longitude - a.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed smallest difference b - a in degrees (-180..180]; negative = left. */
export function turnAngle(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}

function segmentIndexAt(line: RouteLine, along: number): number {
  const { cum } = line;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point at a distance along the route (clamped to the ends). */
export function pointAt(line: RouteLine, along: number): LatLon {
  const { coords, cum, total } = line;
  if (coords.length === 0) return { latitude: 0, longitude: 0 };
  if (along <= 0) return coords[0];
  if (along >= total) return coords[coords.length - 1];
  const i = segmentIndexAt(line, along);
  const seg = cum[i + 1] - cum[i] || 1;
  const t = (along - cum[i]) / seg;
  return {
    latitude: coords[i].latitude + (coords[i + 1].latitude - coords[i].latitude) * t,
    longitude: coords[i].longitude + (coords[i + 1].longitude - coords[i].longitude) * t,
  };
}

/** Direction of travel at a distance along the route, smoothed over ~lookM meters. */
export function bearingAt(line: RouteLine, along: number, lookM = 15): number {
  const a = pointAt(line, Math.max(0, along - lookM / 3));
  const b = pointAt(line, Math.min(line.total, along + lookM));
  return bearing(a, b);
}

export function classify(angle: number): ManeuverType | null {
  const a = Math.abs(angle);
  if (a < 35) return null;
  const side = angle < 0 ? 'left' : 'right';
  if (a >= 160) return 'uturn';
  if (a < 60) return `slight-${side}` as ManeuverType;
  if (a < 135) return side as ManeuverType;
  return `sharp-${side}` as ManeuverType;
}

/** Turns along the route, from the change in direction around each point. */
export function detectManeuvers(line: RouteLine, windowM = 20, mergeM = 30): Maneuver[] {
  const { coords, cum, total } = line;
  const raw: (Maneuver & { strength: number })[] = [];
  for (let i = 1; i < coords.length - 1; i++) {
    const d = cum[i];
    if (d < 15 || total - d < 15) continue;
    const before = bearing(pointAt(line, d - windowM), coords[i]);
    const after = bearing(coords[i], pointAt(line, d + windowM));
    const angle = turnAngle(before, after);
    const type = classify(angle);
    if (type) raw.push({ type, at: d, index: i, point: coords[i], strength: Math.abs(angle) });
  }
  // Several points of one corner: keep the strongest within mergeM.
  const out: Maneuver[] = [];
  for (const m of raw) {
    const last = out[out.length - 1] as (Maneuver & { strength: number }) | undefined;
    if (last && m.at - last.at < mergeM) {
      if (m.strength > last.strength) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  const cleaned = out.map(({ type, at, index, point }) => ({ type, at, index, point }));
  if (coords.length) cleaned.push({ type: 'arrive', at: total, index: coords.length - 1, point: coords[coords.length - 1] });
  return cleaned;
}

export interface Progress {
  /** Meters from the start of the route to the rider's snapped position. */
  along: number;
  /** Meters between the rider and the route. */
  offRoute: number;
  snapped: LatLon;
  segment: number;
}

/**
 * Where the rider is along the route. Searches near the previous position
 * first so loops and out-and-backs don't jump to the wrong direction.
 */
export function project(line: RouteLine, pos: LatLon, prevAlong = 0, searchM = 600): Progress {
  const { coords, cum } = line;
  const k = Math.cos((pos.latitude * Math.PI) / 180);
  const toXY = (c: LatLon) => [c.longitude * k * 111320, c.latitude * 110540] as const;
  const [px, py] = toXY(pos);
  let best = { along: 0, d2: Infinity, seg: 0, x: px, y: py };
  const scan = (lo: number, hi: number) => {
    for (let i = Math.max(0, lo); i < Math.min(coords.length - 1, hi); i++) {
      const [ax, ay] = toXY(coords[i]);
      const [bx, by] = toXY(coords[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const x = ax + t * dx;
      const y = ay + t * dy;
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 < best.d2) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), d2, seg: i, x, y };
    }
  };
  const from = segmentIndexAt(line, Math.max(0, prevAlong - 50));
  const to = segmentIndexAt(line, prevAlong + searchM) + 2;
  scan(from, to);
  if (best.d2 > 60 * 60) scan(0, coords.length); // lost: search everywhere
  return {
    along: best.along,
    offRoute: Math.sqrt(best.d2),
    snapped: { latitude: best.y / 110540, longitude: best.x / (k * 111320) },
    segment: best.seg,
  };
}

export function nextManeuver(maneuvers: Maneuver[], along: number): { current?: Maneuver; then?: Maneuver } {
  const i = maneuvers.findIndex((m) => m.at > along + 3);
  return { current: maneuvers[i], then: i >= 0 ? maneuvers[i + 1] : undefined };
}

const VERB: Record<ManeuverType, string> = {
  'slight-left': 'Bear left',
  left: 'Turn left',
  'sharp-left': 'Sharp left',
  'slight-right': 'Bear right',
  right: 'Turn right',
  'sharp-right': 'Sharp right',
  uturn: 'Make a U-turn',
  arrive: 'Arrive at your destination',
};

export function instruction(m: Maneuver): string {
  if (m.type === 'arrive') return VERB.arrive;
  return m.onto ? `${VERB[m.type]} onto ${m.onto}` : VERB[m.type];
}

/** Rider-friendly distance: feet under 0.1 mi, rounded to sensible steps. */
export function speakDistance(meters: number): string {
  const ft = meters * 3.281;
  if (ft < 1000) {
    const step = ft < 300 ? 50 : 100;
    return `${Math.max(step, Math.round(ft / step) * step)} feet`;
  }
  const mi = meters / 1609.344;
  if (mi < 0.3) return 'a quarter mile';
  if (mi < 0.6) return 'half a mile';
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} miles`;
}

export function shortDistance(meters: number): string {
  const ft = meters * 3.281;
  if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
  const mi = meters / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** What to say, if anything, as the rider approaches a turn. */
export function voicePrompt(m: Maneuver, metersToTurn: number, spoken: Set<string>): string | null {
  const key = (tag: string) => `${m.index}:${tag}`;
  if (m.type === 'arrive') {
    if (metersToTurn < 30 && !spoken.has(key('now'))) {
      spoken.add(key('now'));
      return 'You have arrived. Nice ride!';
    }
    return null;
  }
  if (metersToTurn <= 35 && !spoken.has(key('now'))) {
    spoken.add(key('now'));
    spoken.add(key('soon'));
    return instruction(m);
  }
  if (metersToTurn <= 250 && metersToTurn > 60 && !spoken.has(key('soon'))) {
    spoken.add(key('soon'));
    return `In ${speakDistance(metersToTurn)}, ${instruction(m).toLowerCase()}`;
  }
  return null;
}
