-- Ride Madison: confirmed Madison-area bike events, Nov–Dec 2026 (researched Nov 2, 2026).
-- SQL Editor → paste → Run. Safe to re-run (skips events already added).

insert into public.events
  (source, status, category, title, description, starts_at, ends_at, venue_name, address, latitude, longitude, url)
select * from (values
  ('curated', 'approved', 'bike',
   'Winter Bike Fashion Show',
   'Madison Bikes'' free, family-friendly runway show of winter riding outfits and bike setups, with a Q&A from year-round riders and tips for staying warm. Bring kids'' winter clothing to donate.',
   timestamptz '2026-11-15 13:00 America/Chicago', timestamptz '2026-11-15 16:00 America/Chicago',
   'Goodman Community Center (Ironworks Building)', '149 Waubesa St, Madison, WI',
   43.0973475::float8, -89.3431739::float8,
   'https://www.madisonbikes.org/events/winter-bike-fashion-show-2026/'),

  ('curated', 'approved', 'bike',
   'Holiday Lights Ride',
   'Trek Bicycle Madison''s free, no-drop group ride through the Holiday Fantasy in Lights. Deck your bike with lights; helmets required. Pre-registration recommended.',
   timestamptz '2026-12-10 18:00 America/Chicago', timestamptz '2026-12-10 21:00 America/Chicago',
   'Delta Beer Lab', '167 E Badger Rd, Madison, WI 53713',
   43.0373542::float8, -89.3823463::float8,
   'https://www.eventbrite.com/e/holiday-lights-ride-tickets-1980388980752'),

  ('curated', 'approved', 'bike',
   'Santa Cycle Rampage – Madison',
   'The Wisconsin Bike Fed''s costumed holiday group ride through Madison, raising money for youth and family biking programs. Registration required.',
   timestamptz '2026-12-12 11:00 America/Chicago', timestamptz '2026-12-12 13:00 America/Chicago',
   'Breese Stevens Field', '917 E Mifflin St, Madison, WI',
   43.0833533::float8, -89.3731381::float8,
   'https://wisconsinbikefed.org/santa-cycle-rampage/')
) as v(source, status, category, title, description, starts_at, ends_at, venue_name, address, latitude, longitude, url)
where not exists (
  select 1 from public.events e where e.title = v.title and e.starts_at = v.starts_at
);
