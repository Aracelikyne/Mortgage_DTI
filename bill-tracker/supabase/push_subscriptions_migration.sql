-- Run this once in the Supabase SQL editor, alongside the other migrations.
--
-- One row per browser/device that's turned on bill reminders (the "Get
-- reminders" button in the app header). The send-bill-reminders Edge
-- Function (see supabase/functions/send-bill-reminders) reads every row
-- here with the service role key, so RLS below only needs to cover what the
-- app itself does: add your own device, and see/remove any device on the
-- shared account.

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  user_name text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Household members can read subscriptions"
  on public.push_subscriptions for select
  using (auth.uid() is not null);

create policy "Household members can add a subscription"
  on public.push_subscriptions for insert
  with check (auth.uid() is not null);

create policy "Household members can remove a subscription"
  on public.push_subscriptions for delete
  using (auth.uid() is not null);
