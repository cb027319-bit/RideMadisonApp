import { COLORS } from './config';
import { t } from './i18n';
import type { PathKind, PlaceKind } from './osm';

export interface PlaceMeta {
  readonly label: string;
  readonly plural: string;
  readonly color: string;
  readonly icon: string;
  readonly fallbackName: string;
}

/** Labels are getters so they always read the current language. */
function placeMeta(kind: PlaceKind, color: string, icon: string, fallbackKey?: string): PlaceMeta {
  return {
    get label() { return t(`map.place.${kind}`); },
    get plural() { return t(`map.place.${kind}Plural`); },
    get fallbackName() { return t(fallbackKey ?? `map.place.${kind}`); },
    color,
    icon,
  };
}

export const PLACE_META: Record<PlaceKind, PlaceMeta> = {
  shop: placeMeta('shop', COLORS.shop, 'storefront'),
  repair: placeMeta('repair', COLORS.repair, 'construct'),
  parking: placeMeta('parking', COLORS.parking, 'lock-closed'),
  water: placeMeta('water', COLORS.water, 'water'),
  restroom: placeMeta('restroom', COLORS.restroom, 'male-female'),
  playground: placeMeta('playground', COLORS.playground, 'happy'),
  food: placeMeta('food', COLORS.food, 'restaurant', 'map.place.foodFallback'),
  drink: placeMeta('drink', COLORS.drink, 'beer', 'map.place.drinkFallback'),
};

const PATH_KEY: Record<PathKind, string> = { path_paved: 'map.path.paved', path_unpaved: 'map.path.unpaved', lane: 'map.path.lane' };
const pathMeta = (kind: PathKind, color: string) => ({ get label() { return t(PATH_KEY[kind]); }, color });

export const PATH_META: Record<PathKind, { readonly label: string; color: string }> = {
  path_paved: pathMeta('path_paved', COLORS.pathPaved),
  path_unpaved: pathMeta('path_unpaved', COLORS.pathUnpaved),
  lane: pathMeta('lane', COLORS.lane),
};

/** Brighter line colours so trails stand out on the dark map. */
const DARK_LINE_COLOR: Record<string, string> = {
  [COLORS.pathPaved]: '#22c55e',
  [COLORS.pathUnpaved]: '#eab308',
  [COLORS.lane]: '#60a5fa',
  [COLORS.hiking]: '#9ca3af',
};

/** A map line colour, brightened for the dark map. */
export function lineColor(color: string, dark: boolean): string {
  return dark ? (DARK_LINE_COLOR[color] ?? color) : color;
}

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
  if (s < 60) return t('map.ago.now');
  const m = Math.round(s / 60);
  if (m < 60) return t('map.ago.min', { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t('map.ago.hr', { n: h }) : t('map.ago.days', { n: Math.round(h / 24) });
}
