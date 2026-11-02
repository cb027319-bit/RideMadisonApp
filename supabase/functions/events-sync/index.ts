// Ride Madison: events-sync (Supabase Edge Function, Deno).
//
// Imports concerts and big events within 25 miles of Madison from the Ticketmaster Discovery API
// into the `events` table (migration 0007), for the next 60 days. Run daily with Supabase Cron.
// Events you've set to 'rejected' in Table Editor stay hidden; cancelled events are hidden too.
//
// Secrets: TICKETMASTER_API_KEY (Edge Functions → Secrets). Provided automatically: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. scripts/build-events-sync-function.mjs bundles this into dashboard-paste.ts.

import { mapTicketmaster, type EventRow, type TmEvent } from './map';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const CENTER = '43.0731,-89.4012'; // State Capitol
const RADIUS_MILES = 25;
const DAYS_AHEAD = 60;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { 'Content-Type': 'application/json' } });

const tmDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function fetchTicketmaster(apiKey: string): Promise<TmEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + DAYS_AHEAD * 86_400_000);
  const out: TmEvent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      apikey: apiKey,
      latlong: CENTER,
      radius: String(RADIUS_MILES),
      unit: 'miles',
      startDateTime: tmDate(now),
      endDateTime: tmDate(until),
      size: String(PAGE_SIZE),
      sort: 'date,asc',
      page: String(page),
      locale: '*',
    });
    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
    if (!res.ok) throw new Error(`Ticketmaster ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const body = (await res.json()) as { _embedded?: { events?: TmEvent[] }; page?: { totalPages?: number } };
    out.push(...(body._embedded?.events ?? []));
    if (page + 1 >= (body.page?.totalPages ?? 0)) break;
    await new Promise((r) => setTimeout(r, 250)); // stay under 5 requests/second
  }
  return out;
}

async function sync(supabaseUrl: string, key: string, apiKey: string) {
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const raw = await fetchTicketmaster(apiKey);
  const rows: EventRow[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const row = mapTicketmaster(e);
    if (row && !seen.has(row.source_id)) {
      seen.add(row.source_id);
      rows.push(row);
    }
  }

  // Keep events you've hidden in Table Editor hidden.
  const hiddenRes = await fetch(`${supabaseUrl}/rest/v1/events?source=eq.ticketmaster&status=eq.rejected&select=source_id`, { headers: auth });
  const hidden = new Set(hiddenRes.ok ? ((await hiddenRes.json()) as { source_id: string }[]).map((r) => r.source_id) : []);
  for (const r of rows) if (hidden.has(r.source_id)) r.status = 'rejected';

  for (let i = 0; i < rows.length; i += 200) {
    const up = await fetch(`${supabaseUrl}/rest/v1/events?on_conflict=source,source_id`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!up.ok) throw new Error(`save ${up.status}: ${(await up.text()).slice(0, 200)}`);
  }
  return { fetched: raw.length, saved: rows.length, hidden: rows.filter((r) => r.status === 'rejected').length };
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('TICKETMASTER_API_KEY');
  if (!supabaseUrl || !key) return json({ error: 'Server not configured' }, 500);
  if (!apiKey) return json({ error: 'Add the TICKETMASTER_API_KEY secret first' }, 500);

  const run = sync(supabaseUrl, key, apiKey);
  // Scheduled runs answer at once and finish in the background (the scheduler only waits a few seconds).
  // Test with ?wait=1 to see the result.
  if (new URL(req.url).searchParams.get('wait') !== '1' && typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(run.catch((e) => console.error('events-sync failed', e)));
    return json({ started: true }, 202);
  }
  try {
    return json(await run);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
