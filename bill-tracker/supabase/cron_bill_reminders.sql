-- Run this once in the Supabase SQL editor, AFTER:
--   1. push_subscriptions_migration.sql has been run,
--   2. `supabase functions deploy send-bill-reminders` has been run from
--      the bill-tracker directory (needs the Supabase CLI + `supabase login`),
--   3. the function's secrets are set:
--        supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
--      (VAPID_PUBLIC_KEY must match the constant in
--      src/components/NotificationSettings.jsx — they're a matched pair,
--      generated together; don't regenerate one without the other.)
--
-- Schedules that function to run once a day. Never put the service role key
-- directly in this file — it's a full-database-bypass credential, and this
-- file is committed to git. Store it in Supabase Vault instead (once,
-- interactively, not saved anywhere in the repo):
--
--   select vault.create_secret('paste-your-service-role-key-here', 'cron_service_role_key');
--
-- (Project Settings → API → service_role key. Run the line above directly
-- in the SQL editor, then you can delete it from your query history —
-- the secret itself now lives in Vault, not in this file.)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Runs at 13:00 UTC daily — adjust the hour to land in your own morning;
-- Supabase cron schedules always run in UTC, not your local timezone.
select cron.schedule(
  'daily-bill-reminders',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-bill-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To change the time later: select cron.unschedule('daily-bill-reminders');
-- then re-run the cron.schedule(...) block above with a new cron string.
-- To test it immediately without waiting for the schedule, run the
-- net.http_post(...) call above by itself (with your real project ref).
