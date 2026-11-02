# events-sync

Imports concerts and big events within 25 miles of Madison from Ticketmaster into the `events`
table (migration `0007_events.sql`) for the Events tab. Runs daily. It also saves ticket prices
(US dollars) and lists family or children's shows under Family as well, which needs migration
`0010_events_v2.sql`: run it before deploying this version.

## One-time setup

1. **Ticketmaster key**: create a free account at https://developer-acct.ticketmaster.com, open
   **My Apps**, and copy the **Consumer Key**.
2. **Secret**: Supabase → Edge Functions → Secrets → add `TICKETMASTER_API_KEY` = that key.
3. **Function**: Edge Functions → Deploy a new function → Via Editor → name `events-sync` →
   paste `dashboard-paste.ts` (rebuild with `node scripts/build-events-sync-function.mjs`).
4. **Test**: open the function → Test → add query parameter `wait` = `1` and header
   `x-sync-token` = your `SNAPSHOT_TOKEN` secret → Send. You should see `{ fetched, saved, hidden }`.
   (Without the token a test right after another run gets `429 Ran recently`; see below.)
5. **Schedule**: Integrations → Cron → Create job `sync-events`, schedule `23 9 * * *` (daily,
   3:23 AM Central), type Supabase Edge Function → `events-sync`, POST, header `apikey` = the
   project's publishable key.

## Throttle (why you may see 429 "Ran recently")

The cron job uses the publishable key, which ships inside the app, so anyone could call this
function. To protect the Ticketmaster quota, a call is refused with `429 {"error":"Ran recently"}`
(and a `Retry-After` header) when:

- the last successful run finished less than 20 minutes ago, or
- another run started less than 3 minutes ago and hasn't finished.

The daily cron is never affected. To run it by hand at any time, send header `x-sync-token` with
the value of the `SNAPSHOT_TOKEN` secret (Edge Functions → Secrets; the same token map-data uses).
Times are kept in table `sync_state` (keys `events-sync` = last success, `events-sync:start`);
only the function can read it. Delete those rows to reset.

## Managing events (Table Editor → events)

- **Approve a submission**: set `status` to `approved` (submissions arrive as `pending`, source `partner`).
- **Add your own**: Insert row with `source` = `curated`, `status` = `approved`, title, `starts_at`,
  venue, `latitude`/`longitude` (needed for Ride there), and a category: bike, music, community,
  arts, sports, food or family.
- **Feature a paying partner's event**: set `featured` = true (shown first, labeled Featured).
- **Hide a Ticketmaster event**: set `status` to `rejected`; the daily sync keeps it hidden.
- **Price**: `is_free` = true for free events; otherwise `price_min` / `price_max` in dollars
  (leave all three empty if you don't know). The sync fills them for Ticketmaster and SeatGeek.
- **More categories**: `extra_categories`, e.g. `{family}` for a kid-friendly bike ride (not the
  main category again).
- **Weekly events from riders** share a `series_id`. Riders can see and withdraw their own
  submissions in the app (Events → Your events).

## SeatGeek (optional)

1. Run `supabase/migrations/0008_events_seatgeek.sql` in the SQL Editor.
2. When SeatGeek approves the app, add the secret `SEATGEEK_CLIENT_ID` (Edge Functions → Secrets).
3. The next sync also pulls SeatGeek. Shows already listed on Ticketmaster (same venue, start within
   90 minutes) are skipped. The result has a `seatgeek` line: fetched, added, or an error.
   A SeatGeek error never stops the Ticketmaster import.
