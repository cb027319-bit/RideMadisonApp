# Ride Madison analytics events (PostHog)

This is every event the app sends to PostHog, when it fires and what it carries. Use it
to build insights and dashboards in PostHog. The code is in `src/lib/analytics.tsx` (setup)
and `src/lib/analytics-core.ts` (event names, privacy filter, rounding helpers).

## Ground rules

- **Never sent:** latitude/longitude or any GPS point, addresses, route lines, search text,
  the rider's name, email or phone. A filter in `analytics-core.ts` drops these property
  names and anything that isn't a plain number/text/true-false value, even if a future
  change tries to send one.
- **Rounded instead:** distances are miles rounded to the nearest 0.5 (`distance_mi`),
  progress is a percent rounded to the nearest 10, durations are minutes rounded to 5,
  and a trail's unpaved share is a bucket (`none`, `under_25`, `25_50`, `50_75`, `75_plus`).
- **People:** riders are anonymous. A signed-in rider is linked only by their account's
  random Supabase id (no name or email), and signing out starts a new anonymous id.
- **Off switch:** More → "Share anonymous usage stats" (on by default). When it's off,
  nothing is sent.
- **Not used:** session replay, automatic tap/text capture, automatic crash reports, and
  PostHog's IP-to-location lookup are all switched off.
- **Screens:** each screen change sends a PostHog `$screen` event named from the path only:
  `map`, `route`, `nearby`, `events`, `about`, `navigate` (turn-by-turn) or `tour` (flyover).

## Sponsor reports: Supabase is the official count

The app already records sponsored-listing activity in Supabase (`partner_events`, through
the `record_partner_event` function). **That stays the source of truth for sponsor
reports.** The PostHog sponsor events below are sent from the same function
(`trackPartner` in `src/lib/partners.ts`), right after the Supabase call and only when it is
made, so they count exactly the same moments with the same rules:

- Impressions count **once per partner per placement per app launch** (a pin scrolling in
  and out of view, or a card being re-opened, isn't counted again). Taps count every time.
- Nothing is sent for the sample partners shown in development builds, or when Supabase
  isn't configured.

PostHog is handy for trends and for joining sponsor activity with the rest of the app
(e.g. "riders who saw the trail sponsor and then started a route"). If PostHog and
Supabase ever disagree, Supabase wins (PostHog can drop events, for example from riders
who opted out, or ad blockers on web).

| Event | When it fires | Properties |
|---|---|---|
| `sponsored_listing_impression` | A sponsored listing is shown: a partner pin appears on the map (`pin`), a trail sponsor line or Trail Partner appears on an open trail card (`trail_sponsor`), or a sponsored event is on screen in Events (`events`) | `partner_id`, `partner_name`, `placement`, `tier`, `event_id` (events only) |
| `sponsored_listing_tap` | A rider acts on a sponsored listing. `action` says what: `open` (partner card or sponsored event opened), `call`, `website`, `directions` (open in Maps), `route` (Route here / Ride there) | same as above, plus `action` |
| `offer_viewed` | The rider taps "Use offer" on a partner card, which opens the full-screen offer pass to show at the counter (Supabase kind `offer`) | same as impression |

Property notes:

- `placement` uses the same values as the Supabase table: `pin`, `trail_sponsor`, `card`
  (the partner's own detail card), `events`.
- `tier` is the partner's package: `featured`, `trail` (Trail Partner) or `corridor`
  (trail sponsor). On `events` placements it's filled in when the partner list has loaded.
- `partner_name` is the business name (a public place, fine to send).

Suggested sponsor report in PostHog: a Trends insight on `sponsored_listing_impression`,
`sponsored_listing_tap` and `offer_viewed`, filtered by `partner_id` (or broken down by
`partner_name`), then broken down by `placement` and, for taps, by `action`.

## All other events

| Event | When it fires | Properties |
|---|---|---|
| `app_opened` | Once each time the app starts (cold start) | none |
| `onboarding_completed` | The rider finishes or skips the first-run "What do you ride?" questions | `skipped`, `bike_type`, `comfort`, `ebike_class` (the last three only when not skipped) |
| `search_performed` | Place search on the Route tab returns results (once per search text, 3+ characters) | `query_length` (number of characters, never the text), `result_count`, `mode` (`stop` or `start`) |
| `route_started` | A route has been planned and is ready on the Route tab, after the rider chose where to go | `distance_mi`, `profile` (route style), `bike_type`, `source`, `stops`, `round_trip` |
| `navigation_started` | The rider taps Start ride and turn-by-turn opens | `distance_mi` (planned), `profile`, `bike_type`, `suggested_ride` |
| `navigation_completed` | The rider reaches the destination | `distance_mi`, `ridden_mi`, `pct_complete` (100), `duration_min`, `profile`, `suggested_ride`, `simulated` |
| `navigation_abandoned` | Turn-by-turn is closed before arriving (End ride, or Android back) | same as completed, with `pct_complete` = ridden ÷ planned distance, rounded to 10 |
| `trail_card_viewed` | A trail's card opens (tap on the map, or from Nearby) | `trail_id`, `trail_name`, `trail_kind`, `length_mi`, `unpaved_share` (bucket), `pass_needed` |
| `layer_toggled` | A map layer is switched on or off | `layer` (e.g. `trails`, `lanes`, `bcycle`, `food`), `on`, `from` (`chips` or `layers_sheet`) |
| `bcycle_station_viewed` | A BCycle station's card opens | `station_id`, `station_name`, `bikes_available` |
| `event_viewed` | An event's details open on the Events tab | `event_id`, `event_title`, `category`, `sponsored` |
| `event_route_started` | "Ride there" on an event | `event_id`, `event_title`, `category`, `sponsored` |
| `suggested_ride_opened` | A suggested ride is loaded into the planner (`plan`) or its flyover preview is opened (`preview`) | `ride_id`, `ride_name`, `action`, `distance_mi` |
| `flyover_preview_started` | The flyover ride preview opens (from Route or a suggested ride) | `distance_mi`, `profile`, `suggested_ride` |
| `analytics_opted_in` | The rider turns "Share anonymous usage stats" back on after turning it off | none |

`route_started` `source` values:

| Value | Meaning |
|---|---|
| `search` | Picked a place from search on the Route tab |
| `trail_card` | "Route to trail" on a trail's card |
| `map_card` | "Route here" on any other card (place, partner, BCycle station, park) |
| `event` | "Ride there" on an event |
| `suggested_ride` | Chose a suggested ride |
| `saved_ride` | Opened or started one of the rider's saved rides |
| `map_long_press` | Pressed and held on the Route map to drop a stop |

Planner tweaks after that (moving stops, changing route style) don't send another
`route_started`.

## Not tracked (and why)

- `can_i_ride_here_expanded`: "Can I ride here?" is always shown open on a trail card;
  there is nothing to expand. Opening a trail card is `trail_card_viewed`.
- `offer_redeemed`: the app can't tell when an offer is actually used at the counter.
  The closest moment is opening the offer pass (`offer_viewed`).
- Sponsored listings on the **Nearby** tab: Nearby shows nearby partners at the top of
  its lists, but the Supabase pipeline doesn't record those as impressions today, so
  PostHog doesn't either (the two stay identical). Tapping one opens the partner's card,
  which does count (`sponsored_listing_tap`, `action` = `open`, `placement` = `card`).
  Recording Nearby impressions would mean adding a `trackPartner(..., 'impression', 'nearby')`
  call there, which changes the Supabase counts too.
