-- ============================================================
-- pg_cron schedule that drives the push-notification outbox
-- processor. Runs every minute (vs. the email outbox's every-5-
-- minutes) to meet the "deliver within approximately one minute"
-- requirement for a new-order alert.
--
-- Reuses the SAME Vault secret already created for the email system
-- (project_service_role_key -- see 20260818130000_email_cron_
-- schedules.sql) -- no new manual setup step needed for this
-- feature.
--
-- Safe to apply before send-push is deployed and before the VAPID
-- secrets exist: each run just fails inside the Edge Function (or
-- inside pg_net, if the function doesn't exist yet), logged and
-- harmless, touching no data -- and push_settings.order_push_enabled
-- is false regardless, so no real notification could go out even if
-- a run somehow partially succeeded early.
--
-- Idempotent: cron.schedule() upserts by job name.
-- ============================================================
begin;

select cron.schedule(
  'push-outbox-processor',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://fbfvqiuhwqfhhxufgmla.supabase.co/functions/v1/send-push',
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

commit;
