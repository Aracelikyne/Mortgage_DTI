-- Copy this file to allowlist.local.sql (gitignored — never committed) and
-- fill in real emails, then run it in the Supabase SQL editor after schema.sql.
-- Blocks GitHub sign-in for anyone whose GitHub account's primary email
-- isn't in the allowed_emails table below. Existing accounts are unaffected
-- (this only fires when a brand-new auth.users row would be created).

create table if not exists public.allowed_emails (
  email text primary key
);

-- RLS enabled with zero policies = unreachable from the anon/authenticated
-- API entirely. Only editable here in the SQL editor (or via service_role).
alter table public.allowed_emails enable row level security;

insert into public.allowed_emails (email) values
  ('you@example.com'),
  ('other-person@example.com')
on conflict (email) do nothing;

create or replace function public.enforce_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.allowed_emails where email = new.email) then
    raise exception 'Sign-up not permitted for %', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_allowlist_trigger on auth.users;
create trigger enforce_signup_allowlist_trigger
  before insert on auth.users
  for each row
  execute function public.enforce_signup_allowlist();
