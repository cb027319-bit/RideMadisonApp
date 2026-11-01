// Rider setup options and helpers (pure: no React, no storage), shared by
// onboarding, the More tab and trail rules. Unit-tested in tests/rider.test.ts.

import type { RouteProfile } from './routing';

export type BikeType = 'bike' | 'ebike' | 'bcycle' | 'road' | 'gravel' | 'tandem';
export type Comfort = 'paths' | 'some' | 'confident';
/** Wisconsin e-bike class, or 'unsure'. */
export type EbikeClass = '1' | '2' | '3' | 'unsure';

export interface Prefs {
  bike: BikeType;
  comfort: Comfort;
  /** Only set when bike is 'ebike'. */
  ebikeClass?: EbikeClass;
}

export const BIKE_OPTIONS: { id: BikeType; label: string; icon: string }[] = [
  { id: 'bike', label: 'Everyday bike', icon: 'bicycle' },
  { id: 'ebike', label: 'E-bike', icon: 'flash' },
  { id: 'bcycle', label: 'BCycle (renting)', icon: 'key' },
  { id: 'road', label: 'Road bike', icon: 'speedometer' },
  { id: 'gravel', label: 'Gravel / mountain', icon: 'trail-sign' },
  { id: 'tandem', label: 'Tandem / adaptive', icon: 'people' },
];

export const EBIKE_CLASS_OPTIONS: { id: EbikeClass; label: string; detail: string }[] = [
  { id: '1', label: 'Class 1', detail: 'Pedal assist, up to 20 mph' },
  { id: '2', label: 'Class 2', detail: 'Has a throttle, up to 20 mph' },
  { id: '3', label: 'Class 3', detail: 'Pedal assist, up to 28 mph' },
  { id: 'unsure', label: 'Not sure', detail: 'We’ll show the rules for every class' },
];

export const COMFORT_OPTIONS: { id: Comfort; label: string; detail: string; profile: RouteProfile }[] = [
  { id: 'paths', label: 'Paths and quiet streets', detail: 'Keep me away from traffic', profile: 'quiet' },
  { id: 'some', label: 'Some traffic is OK', detail: 'Bike lanes on busier streets are fine', profile: 'balanced' },
  { id: 'confident', label: 'Confident in traffic', detail: 'Take the most direct way', profile: 'fast' },
];

export const profileFor = (c: Comfort): RouteProfile => COMFORT_OPTIONS.find((o) => o.id === c)?.profile ?? 'quiet';

/** BCycle bikes in Madison are electric-assist, so they get e-bike trail rules too. */
export function isEbikeRider(p: Pick<Prefs, 'bike'> | null | undefined): boolean {
  return p?.bike === 'ebike' || p?.bike === 'bcycle';
}

/** Answers are complete enough to save. E-bike riders also pick a class. */
export function prefsComplete(bike: BikeType | null, comfort: Comfort | null, ebikeClass: EbikeClass | null): boolean {
  if (!bike || !comfort) return false;
  return bike !== 'ebike' || ebikeClass != null;
}

export function buildPrefs(bike: BikeType, comfort: Comfort, ebikeClass: EbikeClass | null): Prefs {
  return bike === 'ebike' && ebikeClass ? { bike, comfort, ebikeClass } : { bike, comfort };
}

/** One-line summary for the More tab, e.g. "E-bike (Class 1) · Some traffic is OK". */
export function prefsSummary(p: Prefs | null): string {
  if (!p) return 'Not set yet';
  const bike = BIKE_OPTIONS.find((b) => b.id === p.bike)?.label ?? 'Bike';
  const cls = p.bike === 'ebike' && p.ebikeClass && p.ebikeClass !== 'unsure' ? ` (Class ${p.ebikeClass})` : '';
  const comfort = COMFORT_OPTIONS.find((c) => c.id === p.comfort)?.label ?? '';
  return comfort ? `${bike}${cls} · ${comfort}` : `${bike}${cls}`;
}
