// Pure helpers for the route planner (unit-tested): where new stops go,
// hiding a ride's start for privacy, thinning saved routes, and when a
// suggested ride should start from the rider's location.

import { distanceMeters, pointInBBox } from './geo';
import { t } from './i18n';
import type { BikeType } from './rider';
import type { LatLon, RouteProfile, RouteResult } from './routing';

/**
 * Where a new stop goes in the stops list. Once there is a destination (and
 * the ride isn't a round trip), new stops go just before it, so adding a
 * coffee stop doesn't turn it into the destination.
 */
export function insertIndex(stopCount: number, roundTrip: boolean): number {
  if (stopCount >= 1 && !roundTrip) return stopCount - 1;
  return stopCount;
}

/** Keep only the points where `keep(i)` is true, remapping turn cues and way names. */
export function thinResult(result: RouteResult, keep: (i: number) => boolean): RouteResult {
  const newIndex: number[] = [];
  let n = 0;
  for (let i = 0; i < result.coords.length; i++) {
    newIndex.push(keep(i) ? n++ : -1);
  }
  // A dropped point maps to the next kept one.
  for (let i = newIndex.length - 2; i >= 0; i--) if (newIndex[i] < 0) newIndex[i] = newIndex[i + 1];
  const at = (i: number) => (i >= 0 && i < newIndex.length && newIndex[i] >= 0 ? newIndex[i] : -1);
  const cues = result.cues
    ?.map((c) => ({ ...c, index: at(c.index) }))
    .filter((c, i, all) => c.index > 0 && c.index < n - 1 && (i === 0 || all[i - 1].index !== c.index));
  const ways = result.ways
    ?.map((w) => ({ ...w, from: Math.max(0, at(w.from)) }))
    .filter((w, i, all) => i === all.length - 1 || all[i + 1].from !== w.from);
  return {
    ...result,
    coords: result.coords.filter((_, i) => keep(i)),
    elevations: result.elevations.filter((_, i) => keep(i)),
    ...(cues ? { cues } : {}),
    ...(ways ? { ways } : {}),
  };
}

/**
 * Drop roughly the first `meters` of a route so a saved or shared ride doesn't
 * show exactly where the rider lives. Always keeps at least two points.
 */
export function trimStart(result: RouteResult, meters = 200): RouteResult {
  const { coords } = result;
  if (coords.length < 3) return result;
  let d = 0;
  let cut = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    d += distanceMeters(coords[i - 1].latitude, coords[i - 1].longitude, coords[i].latitude, coords[i].longitude);
    cut = i;
    if (d >= meters - 1) break;
  }
  const trimmed = thinResult(result, (i) => i >= cut);
  return { ...trimmed, distanceM: Math.max(0, result.distanceM - d), timeS: result.distanceM ? result.timeS * (1 - d / result.distanceM) : result.timeS };
}

const gap = (a: LatLon, b: LatLon) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

/**
 * Drop roughly the last `meters` of a route (the home end of a loop).
 * Always keeps at least two points.
 */
export function trimEnd(result: RouteResult, meters = 200): RouteResult {
  const { coords } = result;
  if (coords.length < 3) return result;
  let d = 0;
  let cut = coords.length - 1;
  for (let i = coords.length - 2; i >= 1; i--) {
    d += gap(coords[i], coords[i + 1]);
    cut = i;
    if (d >= meters - 1) break;
  }
  // Street names that only start inside the hidden part go with it.
  const base = result.ways ? { ...result, ways: result.ways.filter((w) => w.from < cut) } : result;
  const trimmed = thinResult(base, (i) => i <= cut);
  return { ...trimmed, distanceM: Math.max(0, result.distanceM - d), timeS: result.distanceM ? result.timeS * (1 - d / result.distanceM) : result.timeS };
}

/** True when a route finishes within `meters` of where it began (loops, out-and-backs). */
export function endsNearStart(result: RouteResult, meters = 300): boolean {
  const { coords } = result;
  return coords.length >= 2 && gap(coords[0], coords[coords.length - 1]) <= meters;
}

/**
 * "Hide my start": drop about the first `meters`, and the last `meters` too
 * when the route comes back within `loopM` of its start, so a loop from home
 * doesn't end at the front door.
 */
export function trimEnds(result: RouteResult, meters = 200, loopM = 300): RouteResult {
  const loop = endsNearStart(result, loopM);
  const start = trimStart(result, meters);
  return loop ? trimEnd(start, meters) : start;
}

/**
 * Was this saved ride saved with its start hidden (so it should start from the
 * rider's location when reopened)? Older rides have no flag: a ride stored
 * with a single point can only have started at the rider.
 */
export function savedStartsAtMe(ride: { startHidden?: boolean; stops: unknown[] }): boolean {
  return ride.startHidden ?? ride.stops.length < 2;
}

/** About 15 mph: a typical pedal-assist cruising speed, used for e-bike times. */
export const EBIKE_MPS = (15 * 1609.344) / 3600;

/**
 * Ride time for the rider's bike. The router assumes a regular bike; e-bike
 * riders get ~15 mph instead (never slower than the router's own estimate).
 */
export function withBikeTime<T extends { distanceM: number; timeS: number }>(r: T, bike: BikeType | null | undefined): T {
  if (bike !== 'ebike' || !(r.distanceM > 0)) return r;
  const s = r.distanceM / EBIKE_MPS;
  return s < r.timeS ? { ...r, timeS: s } : r;
}

interface DockLike {
  lat: number;
  lon: number;
  docks: number;
  returning: boolean;
}

/**
 * BCycle stations to show near a destination: when the rider rides BCycle, or
 * the destination is within `nearM` of any station, every station within
 * `radiusM` that has open docks, nearest first (at most `max`).
 */
export function docksNear<S extends DockLike>(
  stations: S[],
  dest: LatLon | null,
  ridesBCycle: boolean,
  { nearM = 400, radiusM = 600, max = 6 } = {},
): (S & { distanceM: number })[] {
  if (!dest || !stations.length) return [];
  const withDist = stations.map((s) => ({ ...s, distanceM: distanceMeters(dest.latitude, dest.longitude, s.lat, s.lon) }));
  if (!ridesBCycle && !withDist.some((s) => s.distanceM <= nearM)) return [];
  return withDist
    .filter((s) => s.distanceM <= radiusM && s.returning && s.docks > 0)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, max);
}

/**
 * Should a suggested ride start from the rider? Yes when they are more than
 * ~200 m from its start and inside the area we cover.
 */
export function shouldStartFromMe(
  me: LatLon | null,
  rideStart: LatLon,
  coverage: [number, number, number, number],
  minM = 200,
): boolean {
  if (!me) return false;
  const [minLon, minLat, maxLon, maxLat] = coverage;
  if (!pointInBBox(me.latitude, me.longitude, { minLon, minLat, maxLon, maxLat })) return false;
  return distanceMeters(me.latitude, me.longitude, rideStart.latitude, rideStart.longitude) > minM;
}

const pointKey = (p: LatLon) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;

/**
 * Identifies a planned ride (its points and style) to avoid saving it twice.
 * With `hideStart`, the first point (the rider's location) is left out, and so
 * is a round trip's return to it, so the key never holds where the rider lives.
 */
export function planKey(points: LatLon[], profile: RouteProfile, hideStart = false): string {
  let pts = points.map(pointKey);
  if (hideStart && pts.length) {
    const first = pts[0];
    pts = pts.slice(1);
    if (pts.length && pts[pts.length - 1] === first) pts = pts.slice(0, -1);
    return `${profile}:me|${pts.join('|')}`;
  }
  return `${profile}:${pts.join('|')}`;
}

/** Spoken after a stop is reordered: "Colectivo is now stop 2 of 3". */
export function movedText(name: string, position: number, count: number): string {
  return t('route.moved', { name, position, count });
}
