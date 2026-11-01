// Suggested rides: a curated set of classic Madison-area loops and
// out-and-backs. Each one is measured live with the same bike router the
// planner uses, so length, climbing and surface mix are real, not guesses.
//
// Waypoints are hand-placed near trailheads and landmarks. To add a ride,
// append to SUGGESTED_RIDES; it is measured on the rider's phone and cached.

import { distanceMeters } from './geo';
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
}

const p = (label: string, latitude: number, longitude: number) => ({ label, latitude, longitude });

export const SUGGESTED_RIDES: SuggestedRide[] = [
  {
    id: 'monona-loop',
    name: 'Lake Monona Loop',
    area: 'Madison · Monona',
    description: 'The classic lake loop past Monona Terrace, Olbrich Gardens and Olin Park, with lake views most of the way.',
    shape: 'loop',
    points: [p('Monona Terrace', 43.0717, -89.3808), p('Olbrich Gardens', 43.0927, -89.3349), p('Winnequah Park', 43.0606, -89.3315), p('Olin Park', 43.0527, -89.3755)],
    profile: 'quiet',
    expectedType: 'road',
  },
  {
    id: 'mendota-loop',
    name: 'Lake Mendota Loop',
    area: 'Madison · Middleton · Maple Bluff',
    description: 'A big half-day loop around Lake Mendota through Middleton and past Governor Nelson State Park.',
    shape: 'loop',
    points: [p('Memorial Union', 43.0763, -89.4), p('Middleton', 43.0975, -89.5045), p('Governor Nelson State Park', 43.136, -89.4385), p('Warner Park', 43.1265, -89.37), p('Tenney Park', 43.0915, -89.3705)],
    profile: 'quiet',
    expectedType: 'road',
  },
  {
    id: 'capital-city-lake-farm',
    name: 'Capital City Trail to Lake Farm Park',
    area: 'Madison · Capital Springs',
    description: 'Paved, flat and car-free once you leave downtown, out to the marshes and prairie of Capital Springs.',
    shape: 'out_and_back',
    points: [p('Monona Terrace', 43.0717, -89.3808), p('Lake Farm County Park', 43.0246, -89.3448)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'lower-yahara',
    name: 'Lower Yahara River Trail',
    area: 'Madison · McFarland',
    description: 'Short and scenic: the long boardwalk across Lake Waubesa’s wetlands between Lake Farm Park and McFarland.',
    shape: 'out_and_back',
    points: [p('Lake Farm County Park', 43.0246, -89.3448), p('McDaniel Park, McFarland', 43.0128, -89.2947)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'southwest-path',
    name: 'Southwest Commuter Path',
    area: 'Madison · Fitchburg',
    description: 'Madison’s busiest bike path, from near Camp Randall out to Fitchburg on a former rail line.',
    shape: 'out_and_back',
    points: [p('Camp Randall', 43.0697, -89.4128), p('Fitchburg', 43.028, -89.45)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'cannonball',
    name: 'Wingra Creek & Cannonball Path',
    area: 'Madison · Fitchburg',
    description: 'Quiet creekside path that links into the Cannonball Path toward Fitchburg.',
    shape: 'out_and_back',
    points: [p('Wingra Creek', 43.0545, -89.392), p('Cannonball Path, Fitchburg', 43.02, -89.4215)],
    profile: 'quiet',
    expectedType: 'trail',
  },
  {
    id: 'arboretum-wingra',
    name: 'Arboretum & Lake Wingra',
    area: 'Madison',
    description: 'An easy loop through the UW Arboretum woods and around Lake Wingra. Great with kids.',
    shape: 'loop',
    points: [p('Vilas Park', 43.0603, -89.4155), p('Arboretum Visitor Center', 43.0413, -89.4277), p('Monroe St', 43.061, -89.428)],
    profile: 'quiet',
    expectedType: 'road',
  },
  {
    id: 'military-ridge-verona',
    name: 'Military Ridge Trail to Verona',
    area: 'Fitchburg · Verona',
    description: 'Crushed-limestone rail trail west to Verona’s coffee shops and brewpub. State trail pass required.',
    shape: 'out_and_back',
    points: [p('Military Ridge Trail, Fitchburg', 42.9985, -89.4515), p('Verona', 42.9875, -89.534)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'military-ridge-mount-horeb',
    name: 'Military Ridge Trail to Mount Horeb',
    area: 'Verona · Mount Horeb',
    description: 'A long, steady gravel climb along the ridge to the Troll Capital. State trail pass required.',
    shape: 'out_and_back',
    points: [p('Verona', 42.9875, -89.534), p('Mount Horeb', 43.0072, -89.7383)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'badger-paoli',
    name: 'Badger State Trail to Paoli',
    area: 'Fitchburg · Paoli',
    description: 'Rail trail south through farmland to tiny Paoli, with a café and creamery at the turnaround. State trail pass required.',
    shape: 'out_and_back',
    points: [p('Badger State Trail, Fitchburg', 43.0125, -89.429), p('Paoli', 42.9278, -89.5268)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'glacial-drumlin-deerfield',
    name: 'Glacial Drumlin Trail to Deerfield',
    area: 'Cottage Grove · Deerfield',
    description: 'Flat crushed-stone rail trail east through marsh and farm country. State trail pass required.',
    shape: 'out_and_back',
    points: [p('Cottage Grove trailhead', 43.0786, -89.2003), p('Deerfield', 43.0519, -89.077)],
    profile: 'balanced',
    expectedType: 'gravel',
  },
  {
    id: 'kegonsa',
    name: 'McFarland to Lake Kegonsa State Park',
    area: 'McFarland · Stoughton',
    description: 'Country roads south to Lake Kegonsa State Park’s beach and prairie trails.',
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

export const RIDE_TYPE_LABEL: Record<RideType, string> = {
  trail: 'Paved trail',
  gravel: 'Gravel',
  road: 'Roads & bike lanes',
};

export type LengthFilter = 'any' | 'short' | 'medium' | 'long';
export type FromMeFilter = 'any' | 'near' | 'mid';

export const LENGTH_FILTERS: { id: LengthFilter; label: string; min: number; max: number }[] = [
  { id: 'any', label: 'Any length', min: 0, max: Infinity },
  { id: 'short', label: 'Under 10 mi', min: 0, max: 10 },
  { id: 'medium', label: '10–25 mi', min: 10, max: 25 },
  { id: 'long', label: '25+ mi', min: 25, max: Infinity },
];

export const FROM_ME_FILTERS: { id: FromMeFilter; label: string; maxMi: number }[] = [
  { id: 'any', label: 'Anywhere', maxMi: Infinity },
  { id: 'near', label: 'Within 5 mi', maxMi: 5 },
  { id: 'mid', label: 'Within 15 mi', maxMi: 15 },
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
  f: { length: LengthFilter; type: RideType | 'any'; fromMe: FromMeFilter },
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
      if (f.type !== 'any') {
        const t = rideTypeOf(m.result?.breakdown) ?? (m.result ? undefined : m.ride.expectedType);
        if (t !== f.type) return false;
      }
      if (f.fromMe !== 'any' && (m.fromMeMi == null || m.fromMeMi > near.maxMi)) return false;
      return true;
    })
    .sort((a, b) => (a.fromMeMi ?? Infinity) - (b.fromMeMi ?? Infinity));
}
