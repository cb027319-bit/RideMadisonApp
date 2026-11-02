// App-wide constants for Ride Madison.

/** Coverage area: Madison plus Middleton, Verona, Fitchburg, McFarland,
 *  Monona, Sun Prairie and Waunakee. [minLon, minLat, maxLon, maxLat] */
export const COVERAGE_BBOX: [number, number, number, number] = [-89.65, 42.9, -89.15, 43.25];

export const MADISON_CENTER = { latitude: 43.0731, longitude: -89.3844 };

export const INITIAL_REGION = {
  ...MADISON_CENTER,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

export const BCYCLE_GBFS_URL = 'https://gbfs.bcycle.com/bcycle_madison/gbfs.json';

/** Public Overpass (OpenStreetMap) endpoints, tried in order. */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Identify the app to public servers (some reject anonymous clients). */
export const USER_AGENT = 'RideMadison/1.0 (https://ridemadison.com; hello@ridemadison.com)';

export const CACHE_TTL = {
  paths: 7 * 24 * 3600 * 1000,
  places: 3 * 24 * 3600 * 1000,
};

/** How often live BCycle counts refresh while the app is open. */
export const BCYCLE_REFRESH_MS = 60 * 1000;

/** Ride Madison brand palette (Capitol Spoke pin). */
export const BRAND = {
  navy: '#14213D', // Capitol Navy: primary
  navyDeep: '#0B1630',
  limestone: '#E9E4DA', // Capitol limestone
  cream: '#F4F1EA', // light backgrounds
  red: '#E63946', // Signal Red: routes, highlights
  gold: '#F4B740', // Dome Gold: partners, accents
  slate: '#4A4F5E', // secondary text
};

/** Red Hat Display weights (loaded in the root layout). */
export const FONT = {
  light: 'RedHatDisplay_300Light',
  regular: 'RedHatDisplay_400Regular',
  medium: 'RedHatDisplay_500Medium',
  bold: 'RedHatDisplay_700Bold',
  heavy: 'RedHatDisplay_800ExtraBold',
  black: 'RedHatDisplay_900Black',
};

export const COLORS = {
  brand: BRAND.navy,
  brandDark: BRAND.navyDeep,
  accent: BRAND.red,
  route: BRAND.red,
  gold: BRAND.gold,
  pathPaved: '#15803d',
  pathUnpaved: '#a16207',
  lane: '#2563eb',
  // Pin colours: white icons/text on each pass 4.5:1, and hues are kept apart from route red.
  bcycle: BRAND.navy, // navy pin + white bike (red is reserved for routes)
  bcycleEmpty: '#6B7280',
  shop: '#7c3aed', // violet
  repair: '#c2410c', // dark orange
  parking: '#0369a1', // dark sky blue
  water: '#0e7490', // dark cyan
  food: '#be185d', // magenta
  drink: '#b45309', // amber
  restroom: '#475569', // slate
  playground: '#0f766e', // teal
  hiking: '#6B7280', // park paths where bikes aren't allowed
  partner: BRAND.gold,
  inactive: '#5F6472', // inactive tab labels and other secondary UI text on white
  park: '#166534',
  text: BRAND.navy,
  muted: BRAND.slate,
  border: '#E4E0D6',
  bg: '#ffffff',
  surface: BRAND.cream,
};
