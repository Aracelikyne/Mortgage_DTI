-- Run this once in the Supabase SQL editor, after schema.sql and
-- allowlist.example.sql (or your local copy of it) are already in place.
--
-- Moves the app from one private row per signed-in user to a single shared
-- "household" row that every allowlisted GitHub account reads and writes —
-- so both users always see the same data. The old per-user app_state table
-- is left in place untouched (the app uses it once, automatically, to seed
-- the shared row the first time someone loads the app after this migration
-- runs — nothing here deletes it, and it's safe to drop by hand later once
-- you've confirmed the shared row has everything).
--
-- Attribution ("who made what edits") comes from two places:
--   - household_state.updated_by_name / updated_by_id: who saved last.
--   - activity_log: an append-only feed of individual changes, each
--     stamped with who made it and when.

create table if not exists public.household_state (
  id text primary key default 'household',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_id uuid references auth.users(id) on delete set null,
  updated_by_name text
);

alter table public.household_state enable row level security;

-- Anyone who has an account already passed the GitHub sign-up allowlist
-- trigger (see allowlist.example.sql) — so any authenticated user here is
-- a trusted household member, not a stranger. No per-row ownership check
-- is needed the way the old per-user table required one.
create policy "Household members can read shared state"
  on public.household_state for select
  using (auth.uid() is not null);

create policy "Household members can insert shared state"
  on public.household_state for insert
  with check (auth.uid() is not null);

create policy "Household members can update shared state"
  on public.household_state for update
  using (auth.uid() is not null);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.activity_log enable row level security;

create policy "Household members can read activity"
  on public.activity_log for select
  using (auth.uid() is not null);

create policy "Household members can log activity"
  on public.activity_log for insert
  with check (auth.uid() is not null);

-- Realtime needs a table added to its publication before postgres_changes
-- subscriptions receive anything for it. Wrapped so re-running this file
-- doesn't error if it's already been added.
do $$
begin
  alter publication supabase_realtime add table public.household_state;
exception when duplicate_object then
  null;
end $$;
