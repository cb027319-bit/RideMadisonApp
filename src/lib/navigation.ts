// Turn-by-turn navigation and ride preview geometry (pure, unit-tested).
// Turns come from the router's voice hints when it sends them, with street
// names from its way tags. Otherwise they are detected from the route's shape,
// which works for any route (including older saved rides); trail names are
// then added by the screen from our trail data.

import { distanceMeters, formatDistance } from './geo';
import { t } from './i18n';
import { wayNameAt, type LatLon, type RouteCue, type WaySpan } from './routing';

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
  /** A fork: say "Keep left/right" (also used for slight turns). */
  keep?: boolean;
  /** Roundabout, with the exit to take when known. */
  roundabout?: boolean;
  exit?: number;
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

export function classify(angle: number, minAngle = 35): ManeuverType | null {
  const a = Math.abs(angle);
  if (a < minAngle) return null;
  const side = angle < 0 ? 'left' : 'right';
  if (a >= 160) return 'uturn';
  if (a < 60) return `slight-${side}` as ManeuverType;
  if (a < 135) return side as ManeuverType;
  return `sharp-${side}` as ManeuverType;
}

/**
 * Turns along the route, from the change in direction around each point.
 * A bend only counts when it is a real corner (the direction changes within a
 * few meters, not gradually along a curvy road) or when it happens at a known
 * junction (`junctions`: coordinate indices where the way changes). At a
 * junction smaller angles (from 25°) count too, e.g. a fork.
 */
export function detectManeuvers(line: RouteLine, windowM = 20, mergeM = 30, junctions?: number[]): Maneuver[] {
  const { coords, cum, total } = line;
  const raw: (Maneuver & { strength: number })[] = [];
  const atJunction = (d: number) => !!junctions?.some((j) => j > 0 && j < cum.length && Math.abs(cum[j] - d) < 25);
  for (let i = 1; i < coords.length - 1; i++) {
    const d = cum[i];
    if (d < 15 || total - d < 15) continue;
    const before = bearing(pointAt(line, d - windowM), coords[i]);
    const after = bearing(coords[i], pointAt(line, d + windowM));
    const angle = turnAngle(before, after);
    const junction = atJunction(d);
    const type = classify(angle, junction ? 25 : 35);
    if (!type) continue;
    if (!junction) {
      // Curve test: over a wider window a curve keeps turning, a corner doesn't.
      const wide = turnAngle(bearing(pointAt(line, d - 60), coords[i]), bearing(coords[i], pointAt(line, d + 60)));
      if (Math.abs(angle) < 0.6 * Math.abs(wide)) continue;
    }
    raw.push({ type, at: d, index: i, point: coords[i], strength: Math.abs(angle) });
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
  const cleaned: Maneuver[] = out.map(({ type, at, index, point }) => ({
    type, at, index, point, ...(type === 'slight-left' || type === 'slight-right' ? { keep: true } : {}),
  }));
  if (coords.length) cleaned.push({ type: 'arrive', at: total, index: coords.length - 1, point: coords[coords.length - 1] });
  return cleaned;
}

const CUE_TYPE: Record<RouteCue['kind'], ManeuverType | null> = {
  continue: null,
  left: 'left',
  'slight-left': 'slight-left',
  'sharp-left': 'sharp-left',
  right: 'right',
  'slight-right': 'slight-right',
  'sharp-right': 'sharp-right',
  'keep-left': 'slight-left',
  'keep-right': 'slight-right',
  uturn: 'uturn',
  'roundabout-right': 'right',
  'roundabout-left': 'left',
};

/** Maneuvers from the router's voice hints (cue indices refer to line.coords). */
export function maneuversFromCues(line: RouteLine, cues: RouteCue[]): Maneuver[] {
  const { coords, cum, total } = line;
  const out: Maneuver[] = [];
  for (const c of cues) {
    const type = CUE_TYPE[c.kind];
    if (!type || c.index <= 0 || c.index >= coords.length - 1) continue;
    const m: Maneuver = { type, at: cum[c.index], index: c.index, point: coords[c.index] };
    if (c.kind.startsWith('keep') || c.kind.startsWith('slight')) m.keep = true;
    if (c.kind.startsWith('roundabout')) {
      m.roundabout = true;
      if (c.exit) m.exit = c.exit;
    }
    out.push(m);
  }
  if (coords.length) out.push({ type: 'arrive', at: total, index: coords.length - 1, point: coords[coords.length - 1] });
  return out;
}

/**
 * All maneuvers for a route: router cues when present, else geometry. Street
 * names come from the router's way names, then `nameAtPoint` (our trail data).
 */
export function buildManeuvers(
  line: RouteLine,
  route: { cues?: RouteCue[]; ways?: WaySpan[] },
  nameAtPoint?: (p: LatLon) => string | undefined,
): Maneuver[] {
  const fromCues = route.cues?.length && route.cues.every((c) => c.index < line.coords.length);
  const junctions = route.ways?.map((w) => w.from);
  const ms = fromCues ? maneuversFromCues(line, route.cues!) : detectManeuvers(line, 20, 30, junctions);
  return ms.map((m) => {
    if (m.type === 'arrive') return m;
    const onto = wayNameAt(route.ways, m.index) ?? nameAtPoint?.(pointAt(line, m.at + 30));
    return onto ? { ...m, onto } : m;
  });
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

const VERB_KEY: Record<ManeuverType, string> = {
  'slight-left': 'route.nav.slightLeft',
  left: 'route.nav.left',
  'sharp-left': 'route.nav.sharpLeft',
  'slight-right': 'route.nav.slightRight',
  right: 'route.nav.right',
  'sharp-right': 'route.nav.sharpRight',
  uturn: 'route.nav.uturn',
  arrive: 'route.nav.arrive',
};

/** Shown and spoken in the current language ("Turn left onto…" / "Gira a la izquierda en…"). */
export function instruction(m: Maneuver): string {
  if (m.type === 'arrive') return t(VERB_KEY.arrive);
  if (m.roundabout) {
    const ord = m.exit && m.exit >= 1 && m.exit <= 8 ? t(`route.nav.ord${m.exit}`) : null;
    if (ord) return t(m.onto ? 'route.nav.roundaboutExitOnto' : 'route.nav.roundaboutExit', { ord, name: m.onto });
    return t(m.onto ? 'route.nav.roundaboutAnyOnto' : 'route.nav.roundaboutAny', { name: m.onto });
  }
  const verb = t(VERB_KEY[m.type]);
  return m.onto ? t('route.nav.onto', { verb, name: m.onto }) : verb;
}

/** Lowercase the first letter for use mid-sentence ("In 700 feet, turn left"). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Every maneuver as a line of text, e.g. "In 0.3 mi turn left onto Capital City Trail". */
export function directionsList(maneuvers: Maneuver[]): { maneuver: Maneuver; text: string }[] {
  let prev = 0;
  return maneuvers.map((m) => {
    const gap = Math.max(0, m.at - prev);
    prev = m.at;
    return { maneuver: m, text: t('route.nav.inList', { dist: formatDistance(gap), instr: lowerFirst(instruction(m)) }) };
  });
}

/**
 * The first intermediate stop the rider has just reached, if any (index into
 * the planned points; the start and the final destination are never returned).
 */
export function reachedStop(stopsAlong: number[], along: number, total: number, reached: Set<number>): number | null {
  for (let i = 1; i < stopsAlong.length - 1; i++) {
    if (reached.has(i)) continue;
    if (stopsAlong[i] >= total - 30) continue; // that's the arrival
    if (along >= stopsAlong[i] - 20) {
      reached.add(i);
      return i;
    }
  }
  return null;
}

/** Rider-friendly distance: feet under 0.1 mi, rounded to sensible steps. */
export function speakDistance(meters: number): string {
  const ft = meters * 3.281;
  if (ft < 1000) {
    const step = ft < 300 ? 50 : 100;
    return t('route.nav.feetSpoken', { n: Math.max(step, Math.round(ft / step) * step) });
  }
  const mi = meters / 1609.344;
  if (mi < 0.3) return t('route.nav.quarterMile');
  if (mi < 0.6) return t('route.nav.halfMile');
  return t('route.nav.milesSpoken', { n: mi < 10 ? mi.toFixed(1) : Math.round(mi) });
}

export function shortDistance(meters: number): string {
  const ft = meters * 3.281;
  if (ft < 1000) return t('common.feet', { n: Math.max(10, Math.round(ft / 10) * 10) });
  return formatDistance(meters);
}

/** What to say, if anything, as the rider approaches a turn. */
export function voicePrompt(m: Maneuver, metersToTurn: number, spoken: Set<string>): string | null {
  const key = (tag: string) => `${m.index}:${tag}`;
  // Arrival is announced once by the navigation screen itself.
  if (m.type === 'arrive') return null;
  if (metersToTurn <= 35 && !spoken.has(key('now'))) {
    spoken.add(key('now'));
    spoken.add(key('soon'));
    return instruction(m);
  }
  if (metersToTurn <= 250 && metersToTurn > 60 && !spoken.has(key('soon'))) {
    spoken.add(key('soon'));
    return t('route.nav.inSpoken', { dist: speakDistance(metersToTurn), instr: lowerFirst(instruction(m)) });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Background navigation helpers (used by bg-location.ts and the Navigate screen).

/** 'background': updates keep coming with the phone locked; 'foreground': only while the app is on screen. */
export type NavUpdateMode = 'background' | 'foreground';

/**
 * Whether to try background location updates at all. Web has none, and Expo Go can't run the
 * background task, so those go straight to foreground-only updates. Everything else is tried and
 * falls back if the phone refuses (missing build config, location services off, ...).
 */
export function canTryBackgroundUpdates(env: { os: string; expoGo: boolean; taskManagerAvailable: boolean }): boolean {
  return (env.os === 'ios' || env.os === 'android') && !env.expoGo && env.taskManagerAvailable;
}

/**
 * Fixes to hand to the screen, oldest first, skipping any not newer than the last one delivered
 * (background updates can arrive in batches, and a batch can repeat a fix).
 */
export function freshFixes<T extends { timestamp: number }>(fixes: readonly T[], lastTimestamp: number): T[] {
  return fixes.filter((f) => f.timestamp > lastTimestamp).sort((a, b) => a.timestamp - b.timestamp);
}

/** A BCycle station as far as docking is concerned (BCycleStation fits). */
export interface DockStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  docks: number;
  returning: boolean;
}

/** Show a dock when the destination is this close to one, for any rider. */
export const DOCK_NEAR_M = 400;
/** BCycle riders need somewhere to return the bike, so look a bit farther for them. */
export const DOCK_BCYCLE_M = 1600;
/** Closer than this, the rider is already at the dock. */
export const DOCK_HERE_M = 40;

/**
 * The BCycle dock to suggest on arrival: the nearest station that takes returns and has an open
 * spot, within 400 m of the destination (1600 m for BCycle riders). `here` means the destination
 * is the dock itself, so there's nowhere to ride to.
 */
export function arrivalDock<S extends DockStation>(
  stations: readonly S[],
  dest: LatLon,
  bcycleRider: boolean,
): { station: S; distanceM: number; here: boolean } | null {
  const maxM = bcycleRider ? DOCK_BCYCLE_M : DOCK_NEAR_M;
  let best: { station: S; distanceM: number } | null = null;
  for (const s of stations) {
    if (!s.returning || s.docks <= 0) continue;
    const d = distanceMeters(dest.latitude, dest.longitude, s.lat, s.lon);
    if (d <= maxM && (!best || d < best.distanceM)) best = { station: s, distanceM: d };
  }
  return best ? { ...best, here: best.distanceM < DOCK_HERE_M } : null;
}
