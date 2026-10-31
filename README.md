# Ride Madison

Free bike map for Madison, WI and nearby communities (Middleton, Verona, Fitchburg,
McFarland, Monona, Sun Prairie, Waunakee). Built with Expo (SDK 58) / React Native for iPhone and Android.

## What's in this first build (map core)

- **Map of bike paths**: paved paths (green), unpaved trails (brown, dashed) and on-street
  bike lanes (blue) from OpenStreetMap. Tap a line for its name and surface.
- **Live Madison BCycle**: every station with bikes and open docks, refreshed every minute
  from BCycle's public GBFS feed. Grey pin = no bikes or not renting.
- **Bike shops, fix-it stations, bike parking, drinking water**, with layer toggles.
  Parking and water appear once you zoom in.
- **Details card**: address, hours, tools or capacity, and buttons for bike directions
  (opens Google Maps), call and website.
- **Nearby tab**: closest BCycle stations, shops and fix-it stations, sorted by distance.
- **Works offline-ish**: paths and places are saved on the phone and refresh weekly.

No backend, no API keys, no accounts yet.

## Run it on your phone (about 5 minutes)

1. Install **Node.js (LTS)** on your computer (nodejs.org).
2. Install the **Expo Go** app on your phone (App Store / Google Play).
3. In a terminal:

   ```sh
   git clone https://github.com/cb027319-bit/RideMadisonApp.git
   cd RideMadisonApp
   npm install
   npx expo start
   ```

4. Scan the QR code: iPhone, use the Camera app; Android, use Expo Go.
   Phone and computer must be on the same Wi-Fi (or run `npx expo start --tunnel`).
5. Allow location when asked. The first load of bike paths takes 5 to 20 seconds; after
   that it opens instantly.

## Develop

```sh
npm test           # unit tests for OSM + BCycle parsing and geo helpers
npm run typecheck  # TypeScript
npm run lint       # ESLint
```

| Path | What |
|---|---|
| `src/app/(tabs)/index.tsx` | Map screen: layers, pins, path lines, detail card |
| `src/app/(tabs)/nearby.tsx` | Nearby list |
| `src/app/(tabs)/about.tsx` | Map key, data refresh, attribution |
| `src/lib/osm.ts` | Overpass queries + parsing for paths and places |
| `src/lib/bcycle.ts` | BCycle GBFS feed |
| `src/lib/data.tsx` | Shared state: data loading, live refresh, location, selection |
| `src/lib/cache.ts` | Saved copies on the phone (offline fallback) |
| `src/lib/config.ts` | Coverage area, colors, refresh intervals |

## Roadmap (next milestones)

1. **Own the data**: nightly job that builds the path/places snapshot (OSM + Greater Madison
   MPO comfort/LTS layers, WI DNR, Dane County Parks) and hosts it, so phones don't hit the
   public Overpass API. Required before launch.
2. **Featured listings** for shops ($49/mo package) and sponsor slots on the map.
3. **Rules badges** (state trail pass, e-bike classes, Dane County MTB permit) and trail conditions/closures.
4. **In-app bike directions and draw-your-own ride** (GPX export). Likely moves the map to
   MapLibre in a custom dev build.
5. Hazard reports, events calendar, ride weather.

Ideas and code worth reusing from the earlier MadTrails prototype (private repo
`Madisonbikeapp`): OSM ingest pipeline, Supabase schema for conditions/hazards, Valhalla routing setup.

## Data and attribution

Map data © OpenStreetMap contributors, ODbL. BCycle station data via Madison BCycle's public
GBFS feed. Not affiliated with BCycle or the City of Madison.
