import { COLORS } from './config';
import type { PathKind, PlaceKind } from './osm';

export const PLACE_META: Record<PlaceKind, { label: string; plural: string; color: string; icon: string; fallbackName: string }> = {
  shop: { label: 'Bike shop', plural: 'Bike shops', color: COLORS.shop, icon: 'storefront', fallbackName: 'Bike shop' },
  repair: { label: 'Fix-it station', plural: 'Fix-it stations', color: COLORS.repair, icon: 'construct', fallbackName: 'Fix-it station' },
  parking: { label: 'Bike parking', plural: 'Bike parking', color: COLORS.parking, icon: 'lock-closed', fallbackName: 'Bike parking' },
  water: { label: 'Drinking water', plural: 'Water', color: COLORS.water, icon: 'water', fallbackName: 'Drinking water' },
  restroom: { label: 'Restroom', plural: 'Restrooms', color: COLORS.restroom, icon: 'male-female', fallbackName: 'Restroom' },
  playground: { label: 'Playground', plural: 'Playgrounds', color: COLORS.playground, icon: 'happy', fallbackName: 'Playground' },
  food: { label: 'Eat', plural: 'Eat', color: COLORS.food, icon: 'restaurant', fallbackName: 'Place to eat' },
  drink: { label: 'Drink', plural: 'Drink', color: COLORS.drink, icon: 'beer', fallbackName: 'Place to drink' },
};

export const PATH_META: Record<PathKind, { label: string; color: string }> = {
  path_paved: { label: 'Car-free paved path', color: COLORS.pathPaved },
  path_unpaved: { label: 'Unpaved trail', color: COLORS.pathUnpaved },
  lane: { label: 'On-street bike lane', color: COLORS.lane },
};

/** How each kind of line is drawn on the map (shared by the map and the map key). */
export interface LineStyle {
  color: string;
  width: number;
  dash?: number[];
}

export const LINE_STYLE: Record<PathKind | 'hiking' | 'parkUnknown', LineStyle> = {
  path_paved: { color: COLORS.pathPaved, width: 4 },
  path_unpaved: { color: COLORS.pathUnpaved, width: 4, dash: [7, 4] },
  lane: { color: COLORS.lane, width: 2 },
  /** Park paths where bikes aren't allowed: thin grey dots. */
  hiking: { color: COLORS.hiking, width: 2, dash: [1, 5] },
  /** Park paths with no bike rule mapped: thin grey dashes. */
  parkUnknown: { color: COLORS.hiking, width: 2.5, dash: [6, 4] },
};

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}
