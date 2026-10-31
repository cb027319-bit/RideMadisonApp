import { COLORS } from './config';
import type { PathKind, PlaceKind } from './osm';

export const PLACE_META: Record<PlaceKind, { label: string; plural: string; color: string; icon: string; fallbackName: string }> = {
  shop: { label: 'Bike shop', plural: 'Bike shops', color: COLORS.shop, icon: 'storefront', fallbackName: 'Bike shop' },
  repair: { label: 'Fix-it station', plural: 'Fix-it stations', color: COLORS.repair, icon: 'construct', fallbackName: 'Fix-it station' },
  parking: { label: 'Bike parking', plural: 'Bike parking', color: COLORS.parking, icon: 'lock-closed', fallbackName: 'Bike parking' },
  water: { label: 'Drinking water', plural: 'Water', color: COLORS.water, icon: 'water', fallbackName: 'Drinking water' },
};

export const PATH_META: Record<PathKind, { label: string; color: string }> = {
  path_paved: { label: 'Paved bike path', color: COLORS.pathPaved },
  path_unpaved: { label: 'Unpaved trail', color: COLORS.pathUnpaved },
  lane: { label: 'On-street bike lane', color: COLORS.lane },
};

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}
