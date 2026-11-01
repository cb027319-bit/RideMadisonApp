-- Ride Madison partners v1: hours, Trail Partner trail, offer pass, offer tracking, report columns.
-- Run after 0002_partners.sql (and 0004_v1_fixes.sql if you have it).
-- Supabase: SQL Editor → New query → paste → Run. Safe to re-run.

-- ---------- new partner columns (all optional) ----------
alter table public.partners add column if not exists hours text;       -- OpenStreetMap format, e.g. 'Mo-Fr 10:00-18:00; Sa 10:00-16:00; Su off'
alter table public.partners add column if not exists trail_name text;  -- Trail Partner tier: exact trail name, e.g. 'Capital City State Trail'
alter table public.partners add column if not exists offer_code text;  -- optional code shown on the "Use offer" pass, e.g. 'RIDEMAD10'

comment on column public.partners.hours is 'Opening hours, OpenStreetMap opening_hours format. Shown as "Open now · closes 6 pm".';
comment on column public.partners.trail_name is 'Trail Partner tier: shown on this trail''s card as "Nearby on this trail" when within 0.5 mi of it.';
comment on column public.partners.offer_code is 'Optional redemption code shown on the full-screen offer pass.';

-- The app reads only public columns.
grant select (hours, trail_name, offer_code) on public.partners to anon, authenticated;

-- ---------- offer redemptions are a new event kind ----------
-- (If 0004 added a record_partner_event() function that validates kinds, make sure it accepts 'offer'.)
alter table public.partner_events drop constraint if exists partner_events_event_check;
alter table public.partner_events add constraint partner_events_event_check
  check (event in ('impression', 'open', 'call', 'website', 'directions', 'route', 'offer'));

-- ---------- monthly report: add offers and the partner's id/contact (for the emailed report) ----------
-- New columns are appended so existing queries on partner_report keep working.
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
  count(*) filter (where e.event in ('directions', 'route')) as directions,
  count(*) filter (where e.event = 'offer') as offers_used,
  p.id as partner_id,
  p.contact_name,
  p.contact_email
from public.partner_events e
join public.partners p on p.id = e.partner_id
group by p.id, p.name, p.tier, p.contact_name, p.contact_email, date_trunc('month', e.created_at)
order by 3 desc, 1;

revoke all on public.partner_report from anon, authenticated;
grant select on public.partner_report to service_role;
