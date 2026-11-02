-- Ride Madison: price and category details for the three curated bike
-- events in events-bike-2026.sql. Run after that file and after
-- migration 0010_events_v2.sql.
-- SQL Editor > paste > Run. Safe to re-run.
-- Only what the event descriptions say: both free rides are marked
-- free; the Santa Cycle Rampage gives no price, so it stays unknown.

-- "Madison Bikes' free, family-friendly runway show ... Bring kids'
-- winter clothing": free, and also listed under Family.
update public.events
   set is_free = true,
       price_min = null,
       price_max = null,
       extra_categories = '{family}'
 where source = 'curated'
   and title = 'Winter Bike Fashion Show'
   and starts_at = timestamptz '2026-11-15 13:00 America/Chicago';

-- "Trek Bicycle Madison's free, no-drop group ride": free.
update public.events
   set is_free = true,
       price_min = null,
       price_max = null
 where source = 'curated'
   and title = 'Holiday Lights Ride'
   and starts_at = timestamptz '2026-12-10 18:00 America/Chicago';

-- Santa Cycle Rampage: "Registration required", no price given.
-- Left as is (price unknown).
