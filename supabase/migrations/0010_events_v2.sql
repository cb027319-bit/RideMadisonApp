-- Ride Madison events v2: prices, extra categories, weekly series,
-- "Your events" (list + withdraw), account deletion that covers
-- submitted events, and throttling for the events-sync function.
-- Run after 0007, 0008 and 0009.
-- Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Lines kept short on purpose: long lines broke when pasted into the
-- SQL Editor.

-- ---------- 1. new columns ----------
-- price_min / price_max: USD. is_free: true = free, false = paid,
-- null = unknown. extra_categories: more categories from the same
-- list (a bike event also listed under 'family'). series_id: rows of
-- a weekly repeating submission share one id.
alter table public.events
  add column if not exists price_min numeric(8,2),
  add column if not exists price_max numeric(8,2),
  add column if not exists is_free boolean,
  add column if not exists extra_categories text[]
    not null default '{}',
  add column if not exists series_id uuid;

comment on column public.events.price_min is
  'Lowest ticket price in USD (null = unknown).';
comment on column public.events.price_max is
  'Highest ticket price in USD (null = unknown or same as min).';
comment on column public.events.is_free is
  'true = free, false = paid, null = unknown.';
comment on column public.events.extra_categories is
  'More categories, e.g. {family} on a kid-friendly bike ride.';
comment on column public.events.series_id is
  'Shared by every date of a weekly repeating submission.';

alter table public.events
  drop constraint if exists events_price_check;
alter table public.events
  add constraint events_price_check
  check (
    (price_min is null or price_min >= 0)
    and (price_max is null or price_max >= 0)
    and (price_min is null or price_max is null
         or price_max >= price_min)
  );

-- A free event can't have a price above 0.
alter table public.events
  drop constraint if exists events_free_check;
alter table public.events
  add constraint events_free_check
  check (
    is_free is distinct from true
    or (coalesce(price_min, 0) = 0 and coalesce(price_max, 0) = 0)
  );

-- extra_categories: only names from the category list (same list as
-- the category check in 0007), never the main category, no repeats.
create or replace function public.events_extra_ok(
  p_main text,
  p_extra text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_extra is not null
    and p_extra <@ array[
      'bike', 'music', 'community', 'sports', 'arts', 'food', 'family'
    ]::text[]
    and not (p_main = any (p_extra))
    and cardinality(p_extra) = (
      select count(distinct x) from unnest(p_extra) as u (x)
    ),
    false
  );
$$;

alter table public.events
  drop constraint if exists events_extra_categories_check;
alter table public.events
  add constraint events_extra_categories_check
  check (public.events_extra_ok(category, extra_categories));

create index if not exists events_series_idx
  on public.events (series_id)
  where series_id is not null;
create index if not exists events_submitted_by_idx
  on public.events (submitted_by, status)
  where submitted_by is not null;

-- ---------- 2. column access ----------
-- Everyone may read the new columns. Signed-in riders may send them
-- with a submission; the insert policy from 0007 still pins
-- source = 'partner', status = 'pending', featured = false.
grant select (price_min, price_max, is_free, extra_categories,
              series_id)
  on public.events to anon, authenticated;
grant insert (price_min, price_max, is_free, extra_categories,
              series_id)
  on public.events to authenticated;
grant all on public.events to service_role;

-- ---------- 3. submission limits ----------
-- At most 5 submissions waiting for review per account, where a
-- whole weekly series counts as one; a series has at most 12 dates.
-- The advisory lock stops parallel inserts from slipping past the
-- count. Rows inserted earlier in the same statement (the other
-- dates of a series) are visible here, so a series counts once.
create or replace function public.events_submission_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_groups integer;
  v_dates integer;
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('events_submit:' || v_user::text)
  );

  if new.series_id is not null then
    -- A series belongs to one account.
    if exists (
      select 1 from public.events e
       where e.series_id = new.series_id
         and e.submitted_by is distinct from v_user
    ) then
      raise exception 'This weekly event belongs to another account.'
        using errcode = 'P0001';
    end if;

    select count(*) into v_dates
      from public.events e
     where e.series_id = new.series_id;
    if v_dates >= 12 then
      raise exception 'A weekly event can have at most 12 dates.'
        using errcode = 'P0001';
    end if;

    -- Another date of a series already waiting: not a new submission.
    if exists (
      select 1 from public.events e
       where e.series_id = new.series_id
         and e.submitted_by = v_user
         and e.status = 'pending'
    ) then
      return new;
    end if;
  end if;

  select count(distinct coalesce(e.series_id, e.id)) into v_groups
    from public.events e
   where e.submitted_by = v_user
     and e.status = 'pending';
  if v_groups >= 5 then
    raise exception
      'Too many events waiting for review. Please wait for approval.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists events_submission_limit on public.events;
create trigger events_submission_limit
  before insert on public.events
  for each row execute function public.events_submission_limit();

-- ---------- 4. "Your events": list and withdraw ----------
-- The caller's own submissions (any status), newest first.
create or replace function public.my_event_submissions()
returns table (
  id uuid,
  series_id uuid,
  title text,
  starts_at timestamptz,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.series_id, e.title, e.starts_at, e.status,
         e.created_at
    from public.events e
   where e.submitted_by = auth.uid()
   order by e.created_at desc, e.starts_at
   limit 100;
$$;

revoke all on function public.my_event_submissions()
  from public, anon;
grant execute on function public.my_event_submissions()
  to authenticated;

-- Deletes one of the caller's own events (any status), or every date
-- of its weekly series. Returns how many rows were deleted (0 when
-- the id isn't the caller's).
create or replace function public.withdraw_event(
  p_id uuid,
  p_whole_series boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_series uuid;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  select e.series_id into v_series
    from public.events e
   where e.id = p_id
     and e.submitted_by = v_user;
  if not found then
    return 0;
  end if;

  if coalesce(p_whole_series, false) and v_series is not null then
    delete from public.events e
     where e.series_id = v_series
       and e.submitted_by = v_user;
  else
    delete from public.events e
     where e.id = p_id
       and e.submitted_by = v_user;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.withdraw_event(uuid, boolean)
  from public, anon;
grant execute on function public.withdraw_event(uuid, boolean)
  to authenticated;

-- ---------- 5. partner tracking from the Events tab ----------
-- record_partner_event() (0004) checks placement only against the
-- pattern ^[a-z_]{1,32}$ and partner_events.placement has no check,
-- so placement 'events' is already accepted. Nothing to change.
comment on column public.partner_events.placement is
  'Where it was shown: pin | trail_sponsor | card | events | ...';

-- ---------- 6. account deletion covers submitted events ----------
-- Same as 0004, plus: events the rider submitted that aren't
-- published are deleted; published ones stay listed but lose the
-- link to the account and the contact email. profiles, saved_rides
-- and ride_logs cascade; partner_events.user_id is set to null.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  delete from public.events
   where submitted_by = v_user
     and status <> 'approved';

  update public.events
     set submitted_by = null,
         contact_email = null
   where submitted_by = v_user;

  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 7. events-sync throttling ----------
-- events-sync records its last successful run here and refuses runs
-- less than 20 minutes apart (unless called with the sync token).
-- Only the service role (the function) uses it: RLS on, no policies.
create table if not exists public.sync_state (
  key text primary key,
  last_run timestamptz
);

alter table public.sync_state enable row level security;
revoke all on public.sync_state from anon, authenticated;
grant all on public.sync_state to service_role;
