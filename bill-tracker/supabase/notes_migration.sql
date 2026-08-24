-- Run this once in the Supabase SQL editor, alongside shared_data_migration.sql.
--
-- A shared scratchpad notebook, separate from the bill/paycheck data in
-- household_state — meant for quick notes either person jots down, each
-- permanently stamped with who wrote it. Being its own table (not part of
-- the household_state JSON blob) means it's independent of session state:
-- notes never disappear when a sign-in expires, and both people can add to
-- or clean up the same shared list.

create table if not exists public.notes (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- Same trust model as household_state: anyone with an account already
-- passed the GitHub sign-up allowlist, so any authenticated user here is a
-- trusted household member, free to read, add, and clean up shared notes.
create policy "Household members can read notes"
  on public.notes for select
  using (auth.uid() is not null);

create policy "Household members can add notes"
  on public.notes for insert
  with check (auth.uid() is not null);

create policy "Household members can delete notes"
  on public.notes for delete
  using (auth.uid() is not null);

do $$
begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then
  null;
end $$;
