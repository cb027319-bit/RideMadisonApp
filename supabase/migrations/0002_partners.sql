-- Ride Madison advertising partners + simple ad reporting.
-- Run in Supabase: SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Add or edit partners in Table Editor → partners. The app picks up changes
-- within the hour (or on "Refresh map data now" in More).

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- featured  = Featured Listing ($49/mo): big branded pin + partner card
  -- trail     = Trail Partner ($149/mo): featured + listed on nearby trails
  -- corridor  = Corridor Sponsor ($500/mo): "Presented by" on one trail
  tier text not null default 'featured' check (tier in ('featured', 'trail', 'corridor')),
  category text not null default 'shop',     -- shop | food | drink | lodging | service | other
  latitude double precision,                 -- required for a map pin
  longitude double precision,
  address text,
  phone text,
  website text,
  blurb text,                                -- one or two sentences
  offer text,                                -- e.g. "10% off tune-ups for Ride Madison riders"
  color text default '#0f766e',              -- brand color for the pin
  logo_url text,                             -- square image (Storage → partner-media)
  photo_url text,                            -- wide image for the card
  sponsored_trail text,                      -- corridor only: exact trail name, e.g. "Capital City State Trail"
  osm_place_id text,                         -- optional: hides the matching plain OSM pin (e.g. "osm:node:123")
  active boolean not null default true,
  starts_on date,
  ends_on date,
  contact_name text,                         -- internal only (not shown in app)
  contact_email text,                        -- internal only
  monthly_price numeric,                     -- internal only
  notes text,                                -- internal only
  created_at timestamptz not null default now()
);

alter table public.partners enable row level security;

-- The app can read live partners, but only the public columns below.
drop policy if exists "Anyone can read live partners" on public.partners;
create policy "Anyone can read live partners" on public.partners
  for select to anon, authenticated
  using (
    active
    and (starts_on is null or starts_on <= current_date)
    and (ends_on is null or ends_on >= current_date)
  );

revoke select on public.partners from anon, authenticated;
grant select (
  id, name, tier, category, latitude, longitude, address, phone, website, blurb, offer, color,
  logo_url, photo_url, sponsored_trail, osm_place_id, active, starts_on, ends_on
) on public.partners to anon, authenticated;

-- ---------- ad reporting: impressions and taps per partner ----------
create table if not exists public.partner_events (
  id bigint generated always as identity primary key,
  partner_id uuid not null references public.partners (id) on delete cascade,
  event text not null check (event in ('impression', 'open', 'call', 'website', 'directions', 'route')),
  placement text,                            -- pin | trail_sponsor | card
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists partner_events_partner_idx on public.partner_events (partner_id, created_at);

alter table public.partner_events enable row level security;

-- The app may record events but never read them back.
drop policy if exists "App records partner events" on public.partner_events;
create policy "App records partner events" on public.partner_events
  for insert to anon, authenticated
  with check (true);

-- Monthly report per partner (view in SQL Editor: select * from partner_report;)
create or replace view public.partner_report
with (security_invoker = true) as
select
  p.name,
  p.tier,
  date_trunc('month', e.created_at)::date as month,
  count(*) filter (where e.event = 'impression') as impressions,
  count(*) filter (where e.event = 'open') as card_opens,
  count(*) filter (where e.event = 'call') as calls,
  count(*) filter (where e.event = 'website') as website_taps,
  count(*) filter (where e.event in ('directions', 'route')) as directions
from public.partner_events e
join public.partners p on p.id = e.partner_id
group by 1, 2, 3
order by 3 desc, 1;

revoke all on public.partner_report from anon, authenticated;

-- ---------- images: public bucket for logos and photos ----------
insert into storage.buckets (id, name, public)
values ('partner-media', 'partner-media', true)
on conflict (id) do nothing;
