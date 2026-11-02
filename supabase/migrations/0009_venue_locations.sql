-- Corrected map pins for venues whose ticketing-site location is wrong.
-- Ticketmaster puts the Kohl Center and Camp Randall ~6 km south of campus, The Bur Oak and
-- Legacy20 Arena ~5 km off, and several others 400 m–1 km off. Every event saved (Ticketmaster,
-- SeatGeek, curated or partner) whose venue name matches a row here gets these coordinates, and
-- the address too when one is set. Add a row in Table Editor to fix a new venue; it applies to
-- events as they are next saved (the daily sync), or right away with the update at the bottom.

create table if not exists public.venue_locations (
  venue_key text primary key,          -- lower-case venue name, as ticketing sites spell it
  latitude double precision not null,
  longitude double precision not null,
  address text,                        -- optional replacement address
  note text
);

alter table public.venue_locations enable row level security;
-- No policies: only the database itself (the trigger below) and the dashboard read it.

create or replace function public.events_fix_venue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.venue_locations%rowtype;
begin
  if new.venue_name is null then
    return new;
  end if;
  select * into v from public.venue_locations where venue_key = lower(btrim(new.venue_name));
  if found then
    new.latitude := v.latitude;
    new.longitude := v.longitude;
    if v.address is not null then
      new.address := v.address;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists events_fix_venue on public.events;
create trigger events_fix_venue
  before insert or update of venue_name, latitude, longitude, address on public.events
  for each row execute function public.events_fix_venue();

-- Locations from OpenStreetMap, checked against each venue's street address.
insert into public.venue_locations (venue_key, latitude, longitude, address, note) values
  ('kohl center',                                            43.06942, -89.39688, '601 W Dayton St, Madison, WI', 'Ticketmaster pin ~6 km south'),
  ('camp randall',                                           43.07005, -89.41265, '1440 Monroe St, Madison, WI',  'Ticketmaster pin ~6 km south'),
  ('camp randall stadium',                                   43.07005, -89.41265, '1440 Monroe St, Madison, WI',  null),
  ('labahn arena',                                           43.06977, -89.39856, '105 E Campus Mall, Madison, WI', 'Ticketmaster pin ~1 km south'),
  ('uw field house',                                         43.06864, -89.41269, '1450 Monroe St, Madison, WI',  'Ticketmaster pin ~800 m north; address listed Madison twice'),
  ('overture center for the arts',                           43.07432, -89.38830, '201 State St, Madison, WI',    'Ticketmaster pin ~1 km east'),
  ('capitol theater - overture center',                      43.07427, -89.38862, '201 State St, Madison, WI',    'Ticketmaster pin ~1 km east'),
  ('the bur oak',                                            43.09697, -89.35171, '2262 Winnebago St, Madison, WI', 'Ticketmaster pin ~5 km northeast'),
  ('legacy20 arena at deforest yards',                       43.19135, -89.32247, '6251 Monticello Dr, DeForest, WI', 'Ticketmaster pin ~5 km north'),
  ('veterans memorial coliseum at alliant energy center',    43.04707, -89.37894, '1919 Alliant Energy Center Way, Madison, WI', 'Ticketmaster pin ~450 m east')
on conflict (venue_key) do update
  set latitude = excluded.latitude, longitude = excluded.longitude, address = excluded.address, note = excluded.note;

-- Fix events already saved (re-runs the trigger on matching rows).
update public.events e
   set venue_name = e.venue_name
  from public.venue_locations v
 where v.venue_key = lower(btrim(e.venue_name));
