# map-data: Ride Madison's own copy of the map

Builds trails/bike lanes, places, parks, Eat and Drink for Greater Madison from OpenStreetMap
(server-side) and saves them as JSON in the public Storage bucket `map-data`. The app loads these
first (fast, one download) and only falls back to the public Overpass servers if they're missing.

## Deploy (Dashboard)
Edge Functions → Deploy a new function → Via Editor → name `map-data` → paste all of
`dashboard-paste.ts` → Deploy. (Rebuild that file with `node scripts/build-map-data-function.mjs`
after changing `build.ts` or the parsing code in `src/lib`.)

## Run it once now
Edge Functions → map-data → Test (top right) → Send request (POST, empty body). It takes up to
~2 minutes and returns a count per dataset. Files appear in Storage → map-data.

## Refresh daily (Supabase Cron)
Integrations → Cron → (enable if asked) → Create job:
- Name: `refresh-map-data`
- Schedule: `0 9 * * *` (09:00 UTC = early morning in Madison)
- Type: Supabase Edge Function → `map-data`, method POST
Calls within 6 hours of the last refresh are skipped automatically; add `?force=1` to the URL to force one.
