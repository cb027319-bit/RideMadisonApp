-- Ride Madison: welcome email bookkeeping.
-- Run in Supabase: SQL Editor > New query > paste > Run. Safe to run more than once.

alter table public.profiles add column if not exists welcomed_at timestamptz;
alter table public.profiles add column if not exists language text check (language in ('en', 'es'));

-- Riders who already had accounts before this change don't get a surprise welcome.
update public.profiles set welcomed_at = coalesce(welcomed_at, now()) where welcomed_at is null;
