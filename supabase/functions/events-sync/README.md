# events-sync

Imports concerts and big events within 25 miles of Madison from Ticketmaster into the `events`
table (migration `0007_events.sql`) for the Events tab. Runs daily.

## One-time setup

1. **Ticketmaster key**: create a free account at https://developer-acct.ticketmaster.com, open
   **My Apps**, and copy the **Consumer Key**.
2. **Secret**: Supabase → Edge Functions → Secrets → add `TICKETMASTER_API_KEY` = that key.
3. **Function**: Edge Functions → Deploy a new function → Via Editor → name `events-sync` →
   paste `dashboard-paste.ts` (rebuild with `node scripts/build-events-sync-function.mjs`).
4. **Test**: open the function → Test → add query parameter `wait` = `1` → Send. You should see
   `{ fetched, saved, hidden }`.
5. **Schedule**: Integrations → Cron → Create job `sync-events`, schedule `23 9 * * *` (daily,
   3:23 AM Central), type Supabase Edge Function → `events-sync`, POST, header `apikey` = the
   project's publishable key.

## Managing events (Table Editor → events)

- **Approve a submission**: set `status` to `approved` (submissions arrive as `pending`, source `partner`).
- **Add your own**: Insert row with `source` = `curated`, `status` = `approved`, title, `starts_at`,
  venue, `latitude`/`longitude` (needed for Ride there), and a category: bike, music, community,
  arts, sports, food or family.
- **Feature a paying partner's event**: set `featured` = true (shown first, labeled Featured).
- **Hide a Ticketmaster event**: set `status` to `rejected`; the daily sync keeps it hidden.

## SeatGeek (optional)

1. Run `supabase/migrations/0008_events_seatgeek.sql` in the SQL Editor.
2. When SeatGeek approves the app, add the secret `SEATGEEK_CLIENT_ID` (Edge Functions → Secrets).
3. The next sync also pulls SeatGeek. Shows already listed on Ticketmaster (same venue, start within
   90 minutes) are skipped. The result has a `seatgeek` line: fetched, added, or an error.
   A SeatGeek error never stops the Ticketmaster import.
