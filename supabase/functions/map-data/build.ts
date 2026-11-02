// Ride Madison: map-data snapshot builder (Supabase Edge Function, Deno).
//
// Fetches trails/bike lanes, places, parks, Eat and Drink for Greater Madison from the
// OpenStreetMap Overpass servers (server-side, with generous timeouts), parses them with
// the same code the app uses, and saves each as JSON in the public Storage bucket
// "map-data". The app downloads these files instead of querying Overpass itself.
//
// Call it once a day (Supabase Cron). It skips datasets refreshed in the last 6 hours, so
// extra calls are harmless; add ?force=1 to refresh anyway, or ?only=paths to do one dataset.
// Provided automatically by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Source of truth for the app-side parsing lives in src/lib; scripts/build-map-data-function.mjs
// bundles this file + those modules into dashboard-paste.ts for the Supabase editor.

import { OVERPASS_URLS } from '../../../src/lib/config';
import { fetchFood, fetchPaths, fetchPlaces } from '../../../src/lib/osm';
import { fetchParks } from '../../../src/lib/parks';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const BUCKET = 'map-data';
const FRESH_MS = 6 * 3600 * 1000;
const TIMEOUT = 100_000;

/** Rotate the server list so each dataset starts on a different Overpass server. */
const rotate = (n: number) => [...OVERPASS_URLS.slice(n % OVERPASS_URLS.length), ...OVERPASS_URLS.slice(0, n % OVERPASS_URLS.length)];

const DATASETS: Record<string, (i: number) => Promise<unknown[]>> = {
  paths: (i) => fetchPaths({ timeoutMs: TIMEOUT, urls: rotate(i) }),
  places: (i) => fetchPlaces({ timeoutMs: TIMEOUT, urls: rotate(i) }),
  parks: (i) => fetchParks({ timeoutMs: TIMEOUT, urls: rotate(i) }),
  food: (i) => fetchFood('food', { timeoutMs: TIMEOUT, urls: rotate(i) }),
  drink: (i) => fetchFood('drink', { timeoutMs: TIMEOUT, urls: rotate(i) }),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !key) return json({ error: 'Server not configured' }, 500);
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const params = new URL(req.url).searchParams;
  const force = params.get('force') === '1';
  const only = params.get('only');

  // Make sure the public bucket exists (ignore "already exists").
  await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  }).catch(() => null);

  const names = Object.keys(DATASETS).filter((n) => !only || n === only);
  const results = await Promise.all(
    names.map(async (name, i) => {
      const fileUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${name}.json`;
      if (!force) {
        const head = await fetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${name}.json`, { method: 'HEAD' }).catch(() => null);
        const modified = head?.ok ? Date.parse(head.headers.get('last-modified') ?? '') : NaN;
        if (Number.isFinite(modified) && Date.now() - modified < FRESH_MS) return { name, skipped: 'fresh' };
      }
      try {
        const started = Date.now();
        const data = await DATASETS[name](i);
        if (!data.length) throw new Error('empty');
        const up = await fetch(fileUrl, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
          body: JSON.stringify({ savedAt: new Date().toISOString(), data }),
        });
        if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 120)}`);
        return { name, count: data.length, seconds: Math.round((Date.now() - started) / 1000) };
      } catch (e) {
        return { name, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return json({ results });
});
