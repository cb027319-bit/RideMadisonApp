-- Ride Madison v1 fixes: trustworthy ad reporting and account deletion.
-- Run in Supabase: SQL Editor > New query > paste > Run. Safe to run more than once.
-- Needs 0001_accounts.sql and 0002_partners.sql first.
--
-- What it does:
--   1. partner_events.user_id now points at auth.users and is cleared when an
--      account is deleted (on delete set null), so ad stats stay but the rider
--      link goes away.
--   2. The app can no longer insert into partner_events directly (anyone could
--      forge ad stats). It calls record_partner_event() instead, which sets the
--      rider from the session, checks the event kind and placement, only counts
--      live partners and ignores repeats.
--   3. Adds the 'offer' event (rider opened a partner's offer pass).

-- ---------- 1. user_id -> auth.users, cleared on account deletion ----------
-- Clear links to accounts that no longer exist, or the constraint can't be added.
update public.partner_events e
set user_id = null
where e.user_id is not null
  and not exists (select 1 from auth.users u where u.id = e.user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'partner_events_user_id_fkey' and conrelid = 'public.partner_events'::regclass
  ) then
    alter table public.partner_events
      add constraint partner_events_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end;
$$;

-- No default from the session any more: only record_partner_event() writes rows.
alter table public.partner_events alter column user_id drop default;

-- Per-launch random key from the app, used only to rate-limit signed-out riders.
alter table public.partner_events add column if not exists session_key text;

create index if not exists partner_events_dedupe_idx
  on public.partner_events (partner_id, event, created_at desc);

-- ---------- 3. allow the 'offer' event ----------
alter table public.partner_events drop constraint if exists partner_events_event_check;
alter table public.partner_events
  add constraint partner_events_event_check
  check (event in ('impression', 'open', 'call', 'website', 'directions', 'route', 'offer'));

-- ---------- 2. no direct inserts; record through a checked function ----------
drop policy if exists "App records partner events" on public.partner_events;
revoke insert, update, delete on public.partner_events from anon, authenticated;
-- RLS stays on with no policies for anon/authenticated: the app can neither
-- read nor write this table directly.

create or replace function public.record_partner_event(
  p_partner uuid,
  p_kind text,
  p_placement text default 'card',
  p_session text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session text := nullif(left(coalesce(p_session, ''), 64), '');
  v_placement text := coalesce(nullif(p_placement, ''), 'card');
  v_window interval;
begin
  -- Validate quietly: bad input is ignored, never an error the app has to handle.
  if p_partner is null
     or p_kind is null
     or p_kind not in ('impression', 'open', 'call', 'website', 'directions', 'route', 'offer')
     or v_placement !~ '^[a-z_]{1,32}$' then
    return;
  end if;

  -- Only live partners.
  if not exists (
    select 1 from public.partners p
    where p.id = p_partner
      and p.active
      and (p.starts_on is null or p.starts_on <= current_date)
      and (p.ends_on is null or p.ends_on >= current_date)
  ) then
    return;
  end if;

  -- Repeats from the same rider (or, signed out, the same app launch) count once:
  -- impressions per 30 minutes, taps per minute.
  v_window := case when p_kind = 'impression' then interval '30 minutes' else interval '1 minute' end;
  if (v_user is not null or v_session is not null) and exists (
    select 1 from public.partner_events e
    where e.partner_id = p_partner
      and e.event = p_kind
      and coalesce(e.placement, '') = v_placement
      and e.created_at > now() - v_window
      and (
        (v_user is not null and e.user_id = v_user)
        or (v_user is null and e.session_key = v_session)
      )
  ) then
    return;
  end if;

  -- Flood guard: a partner can't plausibly get more than 300 events a minute.
  if (
    select count(*) from public.partner_events e
    where e.partner_id = p_partner and e.created_at > now() - interval '1 minute'
  ) >= 300 then
    return;
  end if;

  insert into public.partner_events (partner_id, event, placement, user_id, session_key)
  values (p_partner, p_kind, v_placement, v_user, case when v_user is null then v_session end);
end;
$$;

revoke all on function public.record_partner_event(uuid, text, text, text) from public;
grant execute on function public.record_partner_event(uuid, text, text, text) to anon, authenticated;

-- ---------- account deletion keeps working ----------
-- delete_my_account() deletes the auth.users row: profiles, saved_rides and
-- ride_logs cascade; partner_events.user_id is set to null (above). Recreated
-- here unchanged except for a clearer error, so this file is self-contained.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
