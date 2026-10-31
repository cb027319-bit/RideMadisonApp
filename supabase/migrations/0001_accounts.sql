-- Ride Madison accounts: rider profiles + saved rides.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- ---------- profiles: one row per rider ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,                                   -- optional, E.164 (+16085551234)
  sms_opt_in boolean not null default false,    -- explicit consent to texts
  email_opt_in boolean not null default false,  -- consent to news/offers email
  bike_type text,                               -- bike | ebike | road | gravel
  comfort text,                                 -- paths | some | confident
  signup_method text,                           -- email | google | apple
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Riders read own profile" on public.profiles;
create policy "Riders read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Riders update own profile" on public.profiles;
create policy "Riders update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Riders insert own profile" on public.profiles;
create policy "Riders insert own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);

-- Create the profile automatically when someone signs up (any method).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, signup_method)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_app_meta_data ->> 'provider', 'email')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- saved rides ----------
create table if not exists public.saved_rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  ride jsonb not null,           -- stops, profile, route line, stats
  created_at timestamptz not null default now()
);

create index if not exists saved_rides_user_idx on public.saved_rides (user_id, created_at desc);

alter table public.saved_rides enable row level security;

drop policy if exists "Riders manage own rides" on public.saved_rides;
create policy "Riders manage own rides" on public.saved_rides
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------- in-app account deletion (required by Apple) ----------
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
  delete from auth.users where id = auth.uid();  -- cascades to profiles and saved_rides
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
