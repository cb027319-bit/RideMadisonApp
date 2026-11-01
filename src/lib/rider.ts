// Rider setup options and helpers (pure: no React, no storage), shared by
// onboarding, the More tab and trail rules. Unit-tested in tests/rider.test.ts.

import { EN, type Key } from '../locales';
import type { RouteProfile } from './routing';

/**
 * Translator passed in by UI code (`useT().t` or i18n `t`). This file stays
 * free of React/Expo imports so it runs in node tests, which use English.
 */
export type Tr = (key: Key, vars?: Record<string, string | number>) => string;

/** English translator for tests and defaults (no _one plurals needed here). */
export const englishT: Tr = (key, vars) =>
  EN[key].replace(/\{(\w+)\}/g, (_, k: string) => (vars?.[k] == null ? '' : String(vars[k])));

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

// `label` / `detail` are English; UI shows t(labelKey) / t(detailKey).
const bike = (id: BikeType, icon: string) => {
  const labelKey = `more.bike.${id}` as Key;
  return { id, labelKey, label: englishT(labelKey), icon };
};

export const BIKE_OPTIONS: { id: BikeType; labelKey: Key; label: string; icon: string }[] = [
  bike('bike', 'bicycle'),
  bike('ebike', 'flash'),
  bike('bcycle', 'key'),
  bike('road', 'speedometer'),
  bike('gravel', 'trail-sign'),
  bike('tandem', 'people'),
];

const cls = (id: EbikeClass) => {
  const labelKey = `more.class.${id}` as Key;
  const detailKey = `more.class.${id}Detail` as Key;
  return { id, labelKey, detailKey, label: englishT(labelKey), detail: englishT(detailKey) };
};

export const EBIKE_CLASS_OPTIONS: { id: EbikeClass; labelKey: Key; detailKey: Key; label: string; detail: string }[] = [
  cls('1'),
  cls('2'),
  cls('3'),
  cls('unsure'),
];

const comfort = (id: Comfort, profile: RouteProfile) => {
  const labelKey = `more.comfort.${id}` as Key;
  const detailKey = `more.comfort.${id}Detail` as Key;
  return { id, labelKey, detailKey, label: englishT(labelKey), detail: englishT(detailKey), profile };
};

export const COMFORT_OPTIONS: {
  id: Comfort; labelKey: Key; detailKey: Key; label: string; detail: string; profile: RouteProfile;
}[] = [
  comfort('paths', 'quiet'),
  comfort('some', 'balanced'),
  comfort('confident', 'fast'),
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
export function prefsSummary(p: Prefs | null, t: Tr = englishT): string {
  if (!p) return t('more.prefsNotSet');
  const b = BIKE_OPTIONS.find((o) => o.id === p.bike);
  const bikeLabel = b ? t(b.labelKey) : t('more.bike.fallback');
  const cl = p.bike === 'ebike' && p.ebikeClass && p.ebikeClass !== 'unsure' ? t('more.class.inSummary', { n: p.ebikeClass }) : '';
  const c = COMFORT_OPTIONS.find((o) => o.id === p.comfort);
  return c ? `${bikeLabel}${cl} · ${t(c.labelKey)}` : `${bikeLabel}${cl}`;
}
