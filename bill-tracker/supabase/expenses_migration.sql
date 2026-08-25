-- Run this once in the Supabase SQL editor, alongside the other migrations.
--
-- Backs the new Expenses tab: a shared, itemized spending log (groceries,
-- gas, fast food, etc.) separate from household_state, same reasoning as
-- notes_migration.sql — its own table so it can grow freely, be queried
-- directly, and sync live between both people without bloating the single
-- household_state JSON blob. Bill/debt payments are NOT duplicated in here;
-- the app derives those from paidByMonth (already the source of truth) and
-- merges them with these manually-logged rows at render time.

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null,
  amount numeric not null,
  category text not null,
  note text,
  date date not null,
  receipt_path text,
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

-- Same trust model as every other shared table here: an account already
-- passed the GitHub sign-up allowlist, so any authenticated user is a
-- trusted household member, free to read, log, edit, and remove entries.
create policy "Household members can read expenses"
  on public.expenses for select
  using (auth.uid() is not null);

create policy "Household members can add expenses"
  on public.expenses for insert
  with check (auth.uid() is not null);

create policy "Household members can update expenses"
  on public.expenses for update
  using (auth.uid() is not null);

create policy "Household members can delete expenses"
  on public.expenses for delete
  using (auth.uid() is not null);

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then
  null;
end $$;

-- Receipt photos: a private bucket (not publicly listable/readable without
-- a signed URL or an authenticated session), one object per expense that
-- has one. Uploaded from either the camera or a photo library on mobile.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "Household members can read receipts"
  on storage.objects for select
  using (bucket_id = 'receipts' and auth.uid() is not null);

create policy "Household members can upload receipts"
  on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid() is not null);

create policy "Household members can delete receipts"
  on storage.objects for delete
  using (bucket_id = 'receipts' and auth.uid() is not null);
