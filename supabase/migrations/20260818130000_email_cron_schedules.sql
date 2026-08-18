-- ============================================================
-- pg_cron schedules that drive the email system's two periodic
-- Edge Function invocations.
--
-- Applied 2026-08-18. Safe to apply before the Edge Functions are
-- deployed and before the Vault secret below exists: each run
-- simply fails inside pg_net (logged, harmless, touches no data)
-- until both are in place -- and order_emails_enabled/
-- newsletter_enabled are false regardless, so no email could go out
-- even if a run somehow succeeded early. See
-- docs/bakery-rebuild/10-email-system.md §10 for current status.
--
-- One-time manual prerequisite (run once, in the Supabase SQL
-- editor, by the project owner -- the value is never seen by or
-- passed through any AI assistant or this repository):
--
--   select vault.create_secret(
--     '<paste the Project API "service_role" key from
--       Project Settings -> API>',
--     'project_service_role_key'
--   );
--
-- Why a Vault secret and not a hardcoded key: pg_cron jobs run
-- inside Postgres, which has no built-in access to the project's
-- service-role key. Vault stores it encrypted-at-rest and exposes it
-- to SQL only via `vault.decrypted_secrets`, which is itself
-- superuser/service-role-only -- never queryable by `anon` or
-- `authenticated`. The two functions this calls independently verify
-- the bearer token is genuinely the service-role JWT before doing
-- anything (see _shared/supabaseAdmin.ts `isServiceRoleRequest`), so
-- even a Vault misconfiguration can't grant more than "trigger the
-- outbox processor / weekly scheduler," never arbitrary database
-- access from the calling side.
--
-- Idempotent: cron.schedule() upserts by job name.
-- ============================================================
begin;

select cron.schedule(
  'email-outbox-processor',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fbfvqiuhwqfhhxufgmla.supabase.co/functions/v1/send-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_service_role_key'
      )
    ),
    body := jsonb_build_object('action', 'process')
  );
  $cron$
);

select cron.schedule(
  'weekly-newsletter-scheduler',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fbfvqiuhwqfhhxufgmla.supabase.co/functions/v1/weekly-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'project_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

commit;
