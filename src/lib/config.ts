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

export const COLORS = {
  brand: '#0f766e',
  brandDark: '#115e59',
  pathPaved: '#15803d',
  pathUnpaved: '#a16207',
  lane: '#2563eb',
  bcycle: '#e11d48',
  shop: '#7c3aed',
  repair: '#ea580c',
  parking: '#0284c7',
  water: '#0891b2',
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  bg: '#ffffff',
};
