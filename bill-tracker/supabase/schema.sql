-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- for your project before signing in from the app.

create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

create policy "Users can read their own state"
  on app_state for select
  using (auth.uid() = user_id);

create policy "Users can insert their own state"
  on app_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own state"
  on app_state for update
  using (auth.uid() = user_id);
