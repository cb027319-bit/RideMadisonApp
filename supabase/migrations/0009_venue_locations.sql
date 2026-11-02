-- Corrected map pins for venues whose ticketing-site location is wrong (Ticketmaster puts the
-- Kohl Center and Camp Randall about 6 km south of campus, and others up to 5 km off).
-- Any event saved with a matching venue name gets these coordinates and address.
-- To fix a new venue, add a row in Table Editor (venue name in lower case).
-- Lines kept short on purpose: long lines broke when pasted into the SQL Editor.

create table if not exists public.venue_locations (
  venue_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  note text
);

alter table public.venue_locations enable row level security;

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
  select * into v from public.venue_locations
   where venue_key = lower(btrim(new.venue_name));
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
  before insert or update of venue_name, latitude, longitude, address
  on public.events
  for each row execute function public.events_fix_venue();

insert into public.venue_locations
  (venue_key, latitude, longitude, address)
values
  ('kohl center', 43.06942, -89.39688,
   '601 W Dayton St, Madison, WI'),
  ('camp randall', 43.07005, -89.41265,
   '1440 Monroe St, Madison, WI'),
  ('camp randall stadium', 43.07005, -89.41265,
   '1440 Monroe St, Madison, WI'),
  ('labahn arena', 43.06977, -89.39856,
   '105 E Campus Mall, Madison, WI'),
  ('uw field house', 43.06864, -89.41269,
   '1450 Monroe St, Madison, WI'),
  ('overture center for the arts', 43.07432, -89.38830,
   '201 State St, Madison, WI'),
  ('capitol theater - overture center', 43.07427, -89.38862,
   '201 State St, Madison, WI'),
  ('the bur oak', 43.09697, -89.35171,
   '2262 Winnebago St, Madison, WI'),
  ('legacy20 arena at deforest yards', 43.19135, -89.32247,
   '6251 Monticello Dr, DeForest, WI'),
  ('veterans memorial coliseum at alliant energy center',
   43.04707, -89.37894,
   '1919 Alliant Energy Center Way, Madison, WI')
on conflict (venue_key) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      address = excluded.address;

update public.events e
   set venue_name = e.venue_name
  from public.venue_locations v
 where v.venue_key = lower(btrim(e.venue_name));
