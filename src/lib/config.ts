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
export const USER_AGENT = 'RideMadison/0.1 (+https://ridemadison.com)';

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
  bcycle: '#e11d48',
  shop: '#7c3aed',
  repair: '#ea580c',
  parking: '#0284c7',
  water: '#0891b2',
  food: '#db2777',
  drink: '#9333ea',
  park: '#166534',
  text: BRAND.navy,
  muted: BRAND.slate,
  border: '#E4E0D6',
  bg: '#ffffff',
  surface: BRAND.cream,
};
