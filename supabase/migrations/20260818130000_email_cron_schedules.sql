-- ============================================================
-- pg_cron schedules that drive the email system's two periodic
-- Edge Function invocations. NOT applied as part of the initial
-- email-system migration -- this is deliberately held until the
-- Edge Functions are actually deployed (a real function URL to call)
-- and the one-time Vault secret below has been created, both part
-- of the post-Resend-setup activation phase.
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
