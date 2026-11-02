-- Ride Madison events: the Events tab.
-- Three sources share one table:
--   curated      : added by Ride Madison in Table Editor (bike rides, races, community events)
--   partner      : submitted in the app by signed-in riders/businesses; wait for approval
--   ticketmaster : concerts and big events, imported daily by the events-sync Edge Function
-- Supabase: SQL Editor → New query → paste → Run. Safe to re-run.
--
-- To approve a submission: Table Editor → events → set status to 'approved'.
-- To add your own event: Table Editor → events → Insert row, source 'curated', status 'approved'.
-- To feature a paying partner's event: set featured = true (the app labels it "Featured").

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'curated' check (source in ('curated', 'partner', 'ticketmaster')),
  source_id text,                                  -- id in the source system (Ticketmaster event id)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  category text not null default 'community'
    check (category in ('bike', 'music', 'community', 'sports', 'arts', 'food', 'family')),
  title text not null check (char_length(title) between 3 and 120),
  description text check (description is null or char_length(description) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text check (venue_name is null or char_length(venue_name) <= 120),
  address text check (address is null or char_length(address) <= 200),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  url text check (url is null or url ~* '^https?://'),
  image_url text check (image_url is null or image_url ~* '^https://'),
  featured boolean not null default false,
  partner_id uuid references public.partners (id) on delete set null,
  submitted_by uuid default auth.uid() references auth.users (id) on delete set null,
  contact_email text check (contact_email is null or char_length(contact_email) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_source_unique unique (source, source_id),
  constraint events_ends_after_start check (ends_at is null or ends_at >= starts_at)
);

create index if not exists events_upcoming_idx on public.events (status, starts_at);

comment on table public.events is 'Events tab. Approve submissions by setting status = approved.';
comment on column public.events.featured is 'Paid placement: shown first and labeled Featured in the app.';
comment on column public.events.contact_email is 'Submitter contact (private: never readable from the app).';

-- Keep updated_at current.
create or replace function public.events_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events for each row execute function public.events_touch();

-- Limit spam: at most 5 pending submissions per account.
create or replace function public.events_submission_limit() returns trigger language plpgsql
security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and (
    select count(*) from public.events where submitted_by = auth.uid() and status = 'pending'
  ) >= 5 then
    raise exception 'Too many events waiting for review. Please wait for approval.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists events_submission_limit on public.events;
create trigger events_submission_limit before insert on public.events for each row execute function public.events_submission_limit();

-- ---------- access ----------
alter table public.events enable row level security;

-- Everyone can read approved events that haven't ended (6 h grace for events with no end time).
drop policy if exists "events: read approved upcoming" on public.events;
create policy "events: read approved upcoming" on public.events
  for select to anon, authenticated
  using (status = 'approved' and coalesce(ends_at, starts_at + interval '6 hours') > now());

-- Signed-in users may submit events; they always start pending, unfeatured, as a partner submission.
drop policy if exists "events: submit for review" on public.events;
create policy "events: submit for review" on public.events
  for insert to authenticated
  with check (
    source = 'partner' and status = 'pending' and featured = false and partner_id is null
    and submitted_by = auth.uid() and source_id is null
  );

-- Columns: the app never reads who submitted or their email.
revoke all on public.events from anon, authenticated;
grant select (id, source, source_id, status, category, title, description, starts_at, ends_at, venue_name, address,
              latitude, longitude, url, image_url, featured, partner_id)
  on public.events to anon, authenticated;
grant insert (category, title, description, starts_at, ends_at, venue_name, address, latitude, longitude, url,
              contact_email, source, status)
  on public.events to authenticated;
grant all on public.events to service_role;
