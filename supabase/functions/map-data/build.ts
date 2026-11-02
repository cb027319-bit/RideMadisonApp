// Ride Madison: map-data snapshot builder (Supabase Edge Function, Deno).
//
// Fetches trails/bike lanes, places, parks, Eat and Drink for Greater Madison from the
// OpenStreetMap Overpass servers (server-side, with generous timeouts), parses them with
// the same code the app uses, and saves each as JSON in the public Storage bucket
// "map-data". The app downloads these files instead of querying Overpass itself.
//
// Call it every hour (Supabase Cron): each call refreshes ONE dataset that is missing or older
// than 20 hours, so all five refresh daily and failures retry an hour later.
// ?only=paths does that dataset; ?force=1 ignores freshness.
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
const FRESH_MS = 20 * 3600 * 1000;
// Supabase free plan stops a function after 150 s. The public Overpass servers can take
// 40 s+ for a big query, so ask every server at once and keep the first good answer.
const TIMEOUT = 120_000;

type Opts = { timeoutMs: number; urls: string[] };
/** Run one fetch per Overpass server in parallel; resolve with the first non-empty result. */
const race = (fetcher: (o: Opts) => Promise<unknown[]>) =>
  Promise.any(
    OVERPASS_URLS.map(async (url) => {
      const list = await fetcher({ timeoutMs: TIMEOUT, urls: [url] });
      if (!list.length) throw new Error('empty');
      return list;
    }),
  ).catch(() => {
    throw new Error('every Overpass server failed or timed out');
  });

const DATASETS: Record<string, () => Promise<unknown[]>> = {
  paths: () => race((o) => fetchPaths(o)),
  places: () => race((o) => fetchPlaces(o)),
  parks: () => race((o) => fetchParks(o)),
  food: () => race((o) => fetchFood('food', o)),
  drink: () => race((o) => fetchFood('drink', o)),
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

  // One dataset per call keeps each run inside the free plan's time and memory limits.
  // With no ?only=, refresh the first dataset that is missing or older than FRESH_MS.
  let names = Object.keys(DATASETS).filter((n) => !only || n === only);
  if (!only) {
    const ages = await Promise.all(
      names.map(async (n) => {
        const head = await fetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${n}.json`, { method: 'HEAD' }).catch(() => null);
        const modified = head?.ok ? Date.parse(head.headers.get('last-modified') ?? '') : NaN;
        return { n, age: Number.isFinite(modified) ? Date.now() - modified : Infinity };
      }),
    );
    const stale = ages.filter((a) => force || a.age >= FRESH_MS).sort((a, b) => b.age - a.age);
    if (!stale.length) return json({ results: [], note: 'all datasets fresh' });
    names = [stale[0].n];
  }
  const results = await Promise.all(
    names.map(async (name) => {
      const fileUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${name}.json`;
      if (!force) {
        const head = await fetch(`${supabaseUrl}/storage/v1/object/public/${BUCKET}/${name}.json`, { method: 'HEAD' }).catch(() => null);
        const modified = head?.ok ? Date.parse(head.headers.get('last-modified') ?? '') : NaN;
        if (Number.isFinite(modified) && Date.now() - modified < FRESH_MS) return { name, skipped: 'fresh' };
      }
      try {
        const started = Date.now();
        const data = await DATASETS[name]();
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
