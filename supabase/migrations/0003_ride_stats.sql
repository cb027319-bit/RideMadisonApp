-- Ride Madison: ride log for profile stats and badges.
-- Run in Supabase: SQL Editor > New query > paste > Run. Safe to run more than once.

create table if not exists public.ride_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  started_at timestamptz not null,
  distance_m real not null check (distance_m >= 0 and distance_m < 500000),
  moving_s real not null check (moving_s >= 0),
  elapsed_s real not null check (elapsed_s >= 0),
  climb_m real not null default 0 check (climb_m >= 0),
  max_speed_mps real not null default 0 check (max_speed_mps >= 0 and max_speed_mps < 30),
  title text not null default 'Ride',
  ride_id text,
  created_at timestamptz not null default now()
);

create index if not exists ride_logs_user_started on public.ride_logs (user_id, started_at desc);

alter table public.ride_logs enable row level security;

drop policy if exists "Riders read their own ride log" on public.ride_logs;
create policy "Riders read their own ride log" on public.ride_logs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Riders add to their own ride log" on public.ride_logs;
create policy "Riders add to their own ride log" on public.ride_logs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Riders delete from their own ride log" on public.ride_logs;
create policy "Riders delete from their own ride log" on public.ride_logs
  for delete to authenticated using (user_id = auth.uid());

-- Deleting an account (delete_my_account) removes the ride log too, via the cascade above.
