// Where distances are measured from: the rider when they're in the Madison area,
// otherwise the Capitol (so a visitor still at home sees sensible numbers).

import { COVERAGE_BBOX, MADISON_CENTER } from './config';
import { t } from './i18n';

export type LatLng = { latitude: number; longitude: number };

/** English copy of the note (kept for tests); screens call outsideNote(). */
export const OUTSIDE_NOTE = "You're outside Madison: distances from the Capitol";

/** "You're outside Madison: distances from the Capitol", in the rider's language. */
export function outsideNote(): string {
  return t('map.outsideNote');
}

export function insideCoverage(p: LatLng): boolean {
  const [minLon, minLat, maxLon, maxLat] = COVERAGE_BBOX;
  return p.longitude >= minLon && p.longitude <= maxLon && p.latitude >= minLat && p.latitude <= maxLat;
}

/** `fromMe` is true when distances are from the rider; `outside` when they're beyond the coverage area. */
export function distanceOrigin(location: LatLng | null | undefined): { origin: LatLng; fromMe: boolean; outside: boolean } {
  if (!location) return { origin: MADISON_CENTER, fromMe: false, outside: false };
  if (!insideCoverage(location)) return { origin: MADISON_CENTER, fromMe: false, outside: true };
  return { origin: location, fromMe: true, outside: false };
}
