// Suggested rides: a curated set of classic Madison-area loops and
// out-and-backs. Each one is measured live with the same bike router the
// planner uses, so length, climbing and surface mix are real, not guesses.
//
// Waypoints are hand-placed near trailheads and landmarks. To add a ride,
// append to SUGGESTED_RIDES; it is measured on the rider's phone and cached.

import { distanceMeters } from './geo';
import { t } from './i18n';
import type { LatLon, RouteBreakdown, RouteProfile, RouteResult } from './routing';

export type RideType = 'trail' | 'gravel' | 'road';

export interface SuggestedRide {
  id: string;
  name: string;
  area: string;
  description: string;
  /** Rides end where they start: loops visit each point; out-and-backs turn at the last. */
  shape: 'loop' | 'out_and_back';
  points: (LatLon & { label: string })[];
  profile: RouteProfile;
  /** Shown until the ride has been measured. */
  expectedType: RideType;
  /** Hand-checked as easy and calm enough for kids. */
  family?: boolean;
}

const p = (label: string, latitude: number, longitude: number) => ({ label, latitude, longitude });

export const SUGGESTED_RIDES: SuggestedRide[] = [
  {
    id: 'monona-loop',
    name: 'Lake Monona Loop',
    area: 'Madison · Monona',
    get description() {
      return t('route.ride.mononaLoop');
    },
    shape: 'loop',
    points: [p('Monona Terrace', 43.0717, -89.3808), p('Olbrich Gardens', 43.0927, -89.3349), p('Winnequah Park', 43.0606, -89.3315), p('Olin Park', 43.0527, -89.3755)],
    profile: 'quiet',
    expectedType: 'road',
  },
  {
    id: 'mendota-loop',
    name: 'Lake Mendota Loop',
    area: 'Madison · Middleton · Maple Bluff',
    get description() {
      return t('route.ride.mendotaLoop');
    },
    shape: 'loop',
    points: [p('Memorial Union', 43.0763, -89.4), p('Middleton', 43.0975, -89.5045), p('Governor Nelson State Park', 43.136, -89.4385), p('Warner Park', 43.1265, -89.37), p('Tenney Park', 43.0915, -89.3705)],
    profile: 'quiet',
    expectedType: 'road',
  },
  {
    id: 'capital-city-lake-farm',
    name: 'Capital City Trail to Lake Farm Park',
    area: 'Madison · Capital Springs',
    get description() {
      return t('route.ride.capitalCityLakeFarm');
    },
    shape: 'out_and_back',
    points: [p('Monona Terrace', 43.0717, -89.3808), p('Lake Farm County Park', 43.0246, -89.3448)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'lower-yahara',
    name: 'Lower Yahara River Trail',
    area: 'Madison · McFarland',
    get description() {
      return t('route.ride.lowerYahara');
    },
    shape: 'out_and_back',
    points: [p('Lake Farm County Park', 43.0246, -89.3448), p('McDaniel Park, McFarland', 43.0128, -89.2947)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'southwest-path',
    name: 'Southwest Commuter Path',
    area: 'Madison · Fitchburg',
    get description() {
      return t('route.ride.southwestPath');
    },
    shape: 'out_and_back',
    points: [p('Camp Randall', 43.0697, -89.4128), p('Fitchburg', 43.028, -89.45)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'cannonball',
    name: 'Wingra Creek & Cannonball Path',
    area: 'Madison · Fitchburg',
    get description() {
      return t('route.ride.cannonball');
    },
    shape: 'out_and_back',
    points: [p('Wingra Creek', 43.0545, -89.392), p('Cannonball Path, Fitchburg', 43.02, -89.4215)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'arboretum-wingra',
    name: 'Arboretum & Lake Wingra',
    area: 'Madison',
    get description() {
      return t('route.ride.arboretumWingra');
    },
    shape: 'loop',
    points: [p('Vilas Park', 43.0603, -89.4155), p('Arboretum Visitor Center', 43.0413, -89.4277), p('Monroe St', 43.061, -89.428)],
    profile: 'quiet',
    expectedType: 'trail',
    family: true,
  },
  {
    id: 'military-ridge-verona',
    name: 'Military Ridge Trail to Verona',
    area: 'Fitchburg · Verona',
    get description() {
      return t('route.ride.militaryRidgeVerona');
    },
    shape: 'out_and_back',
    points: [p('Military Ridge Trail, Fitchburg', 42.9985, -89.4515), p('Verona', 42.9875, -89.534)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'military-ridge-mount-horeb',
    name: 'Military Ridge Trail to Mount Horeb',
    area: 'Verona · Mount Horeb',
    get description() {
      return t('route.ride.militaryRidgeMountHoreb');
    },
    shape: 'out_and_back',
    points: [p('Verona', 42.9875, -89.534), p('Mount Horeb', 43.0072, -89.7383)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'badger-paoli',
    name: 'Badger State Trail to Paoli',
    area: 'Fitchburg · Paoli',
    get description() {
      return t('route.ride.badgerPaoli');
    },
    shape: 'out_and_back',
    points: [p('Badger State Trail, Fitchburg', 43.0125, -89.429), p('Paoli', 42.9278, -89.5268)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'glacial-drumlin-deerfield',
    name: 'Glacial Drumlin Trail to Deerfield',
    area: 'Cottage Grove · Deerfield',
    get description() {
      return t('route.ride.glacialDrumlinDeerfield');
    },
    shape: 'out_and_back',
    points: [{
      get label() {
        return t('route.point.cottageGroveTrailhead');
      },
      latitude: 43.0786,
      longitude: -89.2003,
    }, p('Deerfield', 43.0519, -89.077)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'kegonsa',
    name: 'McFarland to Lake Kegonsa State Park',
    area: 'McFarland · Stoughton',
    get description() {
      return t('route.ride.kegonsa');
    },
    shape: 'out_and_back',
    points: [p('McDaniel Park, McFarland', 43.0128, -89.2947), p('Lake Kegonsa State Park', 42.978, -89.235)],
    profile: 'balanced',
    expectedType: 'road',
  },
];

/** Points sent to the router: loops close back to the start; out-and-backs retrace. */
export function routePoints(r: SuggestedRide): LatLon[] {
  const pts = r.points.map(({ latitude, longitude }) => ({ latitude, longitude }));
  if (r.shape === 'loop') return [...pts, pts[0]];
  return [...pts, ...pts.slice(0, -1).reverse()];
}

/** Ride type from what the route actually uses. */
export function rideTypeOf(b?: RouteBreakdown): RideType | undefined {
  if (!b) return undefined;
  if (b.unpaved >= 0.35) return 'gravel';
  if (b.path >= 0.55) return 'trail';
  return 'road';
}

/** Labels are getters so they always read the current language. */
export const RIDE_TYPE_LABEL: Readonly<Record<RideType, string>> = {
  get trail() {
    return t('route.type.trail');
  },
  get gravel() {
    return t('route.type.gravel');
  },
  get road() {
    return t('route.type.road');
  },
};

/** Under this share of busier roads, a "road" ride is really quiet streets. */
const LOW_ROAD = 0.15;

/** Label for a ride's type; low-traffic street rides read "Mostly quiet streets". */
export function rideTypeLabel(type: RideType, b?: RouteBreakdown): string {
  if (type === 'road' && b && b.road < LOW_ROAD) return t('route.type.quietStreets');
  return RIDE_TYPE_LABEL[type];
}

/** Good for kids: almost no busier roads when measured, else a known path ride. */
export function isFamilyFriendly(m: { ride: SuggestedRide; result?: RouteResult }): boolean {
  const b = m.result?.breakdown;
  if (b) return b.road < 0.1 && b.unpaved < 0.35;
  return !!m.ride.family || m.ride.expectedType === 'trail';
}

export type TypeFilter = RideType | 'any' | 'family';
export type LengthFilter = 'any' | 'short' | 'medium' | 'long';
export type FromMeFilter = 'any' | 'near' | 'mid';

/** A filter option whose label (and a11y text) is looked up when read, in the current language. */
function opt<T extends string, X extends object>(id: T, labelKey: string, a11yKey: string | null, extra: X) {
  return {
    id,
    ...extra,
    get label() {
      return labelKey.startsWith('route.') ? t(labelKey) : RIDE_TYPE_LABEL[labelKey as RideType];
    },
    get a11y() {
      return a11yKey ? t(a11yKey) : this.label;
    },
  };
}

export const TYPE_FILTERS: { id: TypeFilter; readonly label: string }[] = [
  opt('any', 'route.filter.anyType', null, {}),
  opt('family', 'route.filter.family', null, {}),
  opt('trail', 'trail', null, {}),
  opt('gravel', 'gravel', null, {}),
  opt('road', 'road', null, {}),
];

export const LENGTH_FILTERS: { id: LengthFilter; readonly label: string; readonly a11y: string; min: number; max: number }[] = [
  opt('any', 'route.filter.anyLength', null, { min: 0, max: Infinity }),
  opt('short', 'route.filter.short', 'route.filter.shortA11y', { min: 0, max: 10 }),
  opt('medium', 'route.filter.medium', 'route.filter.mediumA11y', { min: 10, max: 25 }),
  opt('long', 'route.filter.long', 'route.filter.longA11y', { min: 25, max: Infinity }),
];

export const FROM_ME_FILTERS: { id: FromMeFilter; readonly label: string; readonly a11y: string; maxMi: number }[] = [
  opt('any', 'route.filter.anywhere', null, { maxMi: Infinity }),
  opt('near', 'route.filter.near', 'route.filter.nearA11y', { maxMi: 5 }),
  opt('mid', 'route.filter.mid', 'route.filter.midA11y', { maxMi: 15 }),
];

export interface MeasuredRide {
  ride: SuggestedRide;
  result?: RouteResult;
  /** Miles from the rider to the closest point of the ride. */
  fromMeMi?: number;
}

const MI = 1609.344;

export function closestMiles(from: LatLon, ride: SuggestedRide, result?: RouteResult): number {
  const pts = result?.coords.length ? result.coords : ride.points;
  let best = Infinity;
  for (const c of pts) best = Math.min(best, distanceMeters(from.latitude, from.longitude, c.latitude, c.longitude));
  return best / MI;
}

export function filterRides(
  rides: MeasuredRide[],
  f: { length: LengthFilter; type: TypeFilter; fromMe: FromMeFilter },
): MeasuredRide[] {
  const len = LENGTH_FILTERS.find((l) => l.id === f.length)!;
  const near = FROM_ME_FILTERS.find((n) => n.id === f.fromMe)!;
  return rides
    .filter((m) => {
      if (f.length !== 'any') {
        if (!m.result) return false;
        const mi = m.result.distanceM / MI;
        if (mi < len.min || mi >= len.max) return false;
      }
      if (f.type === 'family') {
        if (!isFamilyFriendly(m)) return false;
      } else if (f.type !== 'any') {
        const kind = rideTypeOf(m.result?.breakdown) ?? (m.result ? undefined : m.ride.expectedType);
        // A path ride measured as "road" only because of quiet park roads still counts as a trail ride.
        const quietPath = f.type === 'trail' && m.ride.expectedType === 'trail' && kind === 'road' && (m.result?.breakdown?.road ?? 1) < 0.1;
        if (kind !== f.type && !quietPath) return false;
      }
      if (f.fromMe !== 'any' && (m.fromMeMi == null || m.fromMeMi > near.maxMi)) return false;
      return true;
    })
    .sort((a, b) => (a.fromMeMi ?? Infinity) - (b.fromMeMi ?? Infinity));
}
