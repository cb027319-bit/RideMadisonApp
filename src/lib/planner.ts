// Pure helpers for the route planner (unit-tested): where new stops go,
// hiding a ride's start for privacy, thinning saved routes, and when a
// suggested ride should start from the rider's location.

import { distanceMeters, pointInBBox } from './geo';
import { t } from './i18n';
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

/** Identifies a planned ride (its points and style) to avoid saving it twice. */
export function planKey(points: LatLon[], profile: RouteProfile): string {
  return `${profile}:${points.map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join('|')}`;
}

/** Spoken after a stop is reordered: "Colectivo is now stop 2 of 3". */
export function movedText(name: string, position: number, count: number): string {
  return t('route.moved', { name, position, count });
}
