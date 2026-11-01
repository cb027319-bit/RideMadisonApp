// Where partners may appear: pure rules, unit-tested (tests/partners.test.ts).
// Kept apart from partners.ts so tests don't load Supabase.

import { distanceMeters } from './geo';
import type { BikePath } from './osm';
import { distanceToPathsM, type Trail } from './trails';

/** Minimal partner shape these rules need (matches Partner in partners.ts). */
export interface PartnerLike {
  id: string;
  name: string;
  tier: string;
  category: string;
  latitude: number | null;
  longitude: number | null;
  osm_place_id?: string | null;
  trail_name?: string | null;
}

/** Partners are pinned to the top of Nearby only when this close to the rider. */
export const PARTNER_PIN_RADIUS_M = 3 * 1609.344;
export const PARTNER_PIN_MAX = 2;
/** Trail Partners show on a trail's card when within this distance of the trail. */
export const TRAIL_PARTNER_RADIUS_M = 0.5 * 1609.344;

/** Map layer that controls each partner category's pins (others always show). */
export const PARTNER_LAYER: Record<string, 'shop' | 'food' | 'drink'> = { shop: 'shop', food: 'food', drink: 'drink' };

/** Partners to pin at the top of a Nearby list: closest first, within ~3 mi, at most 2. */
export function partnersToPin<P extends PartnerLike>(
  partners: P[],
  origin: { latitude: number; longitude: number },
  match: (p: P) => boolean = () => true,
  radiusM = PARTNER_PIN_RADIUS_M,
  max = PARTNER_PIN_MAX,
): { partner: P; meters: number }[] {
  return partners
    .filter((p) => p.latitude != null && p.longitude != null && match(p))
    .map((p) => ({ partner: p, meters: distanceMeters(origin.latitude, origin.longitude, p.latitude!, p.longitude!) }))
    .filter((r) => r.meters <= radiusM)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, max);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Trail Partners near a trail ("Nearby on this trail"): tier 'trail', within 0.5 mi of its line,
 *  and if the partner names a trail, it must be this one. Closest first. */
export function partnersOnTrail<P extends PartnerLike>(
  partners: P[],
  trail: Pick<Trail, 'name'>,
  trailPaths: BikePath[],
  radiusM = TRAIL_PARTNER_RADIUS_M,
): { partner: P; meters: number }[] {
  if (!trailPaths.length) return [];
  return partners
    .filter((p) => p.tier === 'trail' && p.latitude != null && p.longitude != null)
    .filter((p) => !p.trail_name || (!!trail.name && norm(p.trail_name) === norm(trail.name)))
    .map((p) => ({ partner: p, meters: distanceToPathsM(trailPaths, { latitude: p.latitude!, longitude: p.longitude! }) }))
    .filter((r) => r.meters <= radiusM)
    .sort((a, b) => a.meters - b.meters);
}

/** True when a plain OpenStreetMap place is the same business as a partner (so it isn't listed twice). */
export function isPartnerPlace(
  place: { id: string; name?: string; lat: number; lon: number },
  partners: PartnerLike[],
  withinM = 40,
): boolean {
  return partners.some((p) => {
    if (p.osm_place_id && p.osm_place_id === place.id) return true;
    if (!place.name || p.latitude == null || p.longitude == null) return false;
    if (norm(place.name) !== norm(p.name)) return false;
    return distanceMeters(place.lat, place.lon, p.latitude, p.longitude) <= withinM;
  });
}
