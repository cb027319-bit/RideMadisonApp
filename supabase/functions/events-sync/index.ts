// Ride Madison: events-sync (Supabase Edge Function, Deno).
//
// Imports concerts and big events within 25 miles of Madison from the Ticketmaster Discovery API
// and (when SEATGEEK_CLIENT_ID is set) SeatGeek into the `events` table (migrations 0007, 0008),
// for the next 60 days. SeatGeek shows already listed on Ticketmaster are skipped. Run daily.
// Events you've set to 'rejected' in Table Editor stay hidden; cancelled events are hidden too.
//
// Throttled (throttle.ts): a run less than 20 minutes after the last successful one gets 429, unless the
// request has header x-sync-token = the SNAPSHOT_TOKEN secret. The daily cron is unaffected.
//
// Secrets: TICKETMASTER_API_KEY, optional SEATGEEK_CLIENT_ID, SNAPSHOT_TOKEN (Edge Functions → Secrets). Provided
// automatically: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. scripts/build-events-sync-function.mjs bundles this into
// dashboard-paste.ts. Needs migration 0010 (price columns, sync_state).

import { isSameEvent, mapSeatGeek, mapTicketmaster, type EventRow, type SgEvent, type TmEvent } from './map';
import { SYNC_KEY, SYNC_START_KEY, throttleDecision } from './throttle';

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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

type Auth = { apikey: string; Authorization: string };

/** last_run per sync_state key (migration 0010). Unreadable → empty, so the daily cron never gets stuck. */
async function readSyncState(supabaseUrl: string, auth: Auth): Promise<Record<string, string | null>> {
  try {
    const keys = [SYNC_KEY, SYNC_START_KEY].map((k) => `"${k}"`).join(',');
    const res = await fetch(`${supabaseUrl}/rest/v1/sync_state?key=in.(${encodeURIComponent(keys)})&select=key,last_run`, {
      headers: auth,
    });
    if (!res.ok) {
      console.error('events-sync: could not read sync_state', res.status, (await res.text()).slice(0, 160));
      return {};
    }
    const rows = (await res.json()) as { key: string; last_run: string | null }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.last_run]));
  } catch (e) {
    console.error('events-sync: could not read sync_state', e);
    return {};
  }
}

/** Upsert last_run = now for a sync_state key. Failures are logged, never fatal. */
async function markSyncState(supabaseUrl: string, auth: Auth, key: string): Promise<void> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/sync_state?on_conflict=key`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, last_run: new Date().toISOString() }),
    });
    if (!res.ok) console.error('events-sync: could not save sync_state', key, res.status, (await res.text()).slice(0, 160));
  } catch (e) {
    console.error('events-sync: could not save sync_state', key, e);
  }
}

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

async function fetchSeatGeek(clientId: string): Promise<SgEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + DAYS_AHEAD * 86_400_000);
  const [lat, lon] = CENTER.split(',');
  const out: SgEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      client_id: clientId,
      lat,
      lon,
      range: `${RADIUS_MILES}mi`,
      'datetime_utc.gte': now.toISOString().slice(0, 19),
      'datetime_utc.lte': until.toISOString().slice(0, 19),
      per_page: String(PAGE_SIZE),
      page: String(page),
      sort: 'datetime_utc.asc',
    });
    const res = await fetch(`https://api.seatgeek.com/2/events?${q}`);
    if (!res.ok) throw new Error(`SeatGeek ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const body = (await res.json()) as { events?: SgEvent[]; meta?: { total?: number; per_page?: number } };
    out.push(...(body.events ?? []));
    if (page * PAGE_SIZE >= (body.meta?.total ?? 0)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

async function sync(supabaseUrl: string, auth: Auth, apiKey: string, seatGeekId?: string) {
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

  // SeatGeek: only shows Ticketmaster doesn't already list. A SeatGeek failure never blocks Ticketmaster.
  let seatgeek: { fetched: number; added: number; error?: string } | undefined;
  if (seatGeekId) {
    try {
      const sg = await fetchSeatGeek(seatGeekId);
      const tm = [...rows];
      let added = 0;
      for (const e of sg) {
        const row = mapSeatGeek(e);
        if (!row || seen.has(`sg:${row.source_id}`) || tm.some((t) => isSameEvent(t, row))) continue;
        seen.add(`sg:${row.source_id}`);
        rows.push(row);
        added++;
      }
      seatgeek = { fetched: sg.length, added };
    } catch (e) {
      seatgeek = { fetched: 0, added: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Keep events you've hidden in Table Editor hidden.
  const hiddenRes = await fetch(
    `${supabaseUrl}/rest/v1/events?source=in.(ticketmaster,seatgeek)&status=eq.rejected&select=source,source_id`,
    { headers: auth },
  );
  const hidden = new Set(
    hiddenRes.ok ? ((await hiddenRes.json()) as { source: string; source_id: string }[]).map((r) => `${r.source}:${r.source_id}`) : [],
  );
  for (const r of rows) if (hidden.has(`${r.source}:${r.source_id}`)) r.status = 'rejected';

  for (let i = 0; i < rows.length; i += 200) {
    const up = await fetch(`${supabaseUrl}/rest/v1/events?on_conflict=source,source_id`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!up.ok) throw new Error(`save ${up.status}: ${(await up.text()).slice(0, 200)}`);
  }
  await markSyncState(supabaseUrl, auth, SYNC_KEY);
  return { fetched: raw.length, saved: rows.length, hidden: rows.filter((r) => r.status === 'rejected').length, seatgeek };
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('TICKETMASTER_API_KEY');
  if (!supabaseUrl || !key) return json({ error: 'Server not configured' }, 500);
  if (!apiKey) return json({ error: 'Add the TICKETMASTER_API_KEY secret first' }, 500);
  const auth: Auth = { apikey: key, Authorization: `Bearer ${key}` };

  const state = await readSyncState(supabaseUrl, auth);
  const decision = throttleDecision({
    lastSuccess: state[SYNC_KEY],
    lastStart: state[SYNC_START_KEY],
    now: Date.now(),
    token: req.headers.get('x-sync-token'),
    secret: Deno.env.get('SNAPSHOT_TOKEN'),
  });
  if (!decision.run) {
    return json({ error: 'Ran recently' }, 429, { 'Retry-After': String(decision.retryAfterSec) });
  }
  await markSyncState(supabaseUrl, auth, SYNC_START_KEY);

  const run = sync(supabaseUrl, auth, apiKey, Deno.env.get('SEATGEEK_CLIENT_ID') || undefined);
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
