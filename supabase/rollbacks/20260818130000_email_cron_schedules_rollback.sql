-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818130000_email_cron_schedules.sql
--
-- Unschedules both cron jobs. Does not touch the Vault secret
-- (project_service_role_key) -- that was created manually, outside
-- any migration, and removing it is the project owner's call.
-- ============================================================
begin;

select cron.unschedule('email-outbox-processor')
where exists (select 1 from cron.job where jobname = 'email-outbox-processor');

select cron.unschedule('weekly-newsletter-scheduler')
where exists (select 1 from cron.job where jobname = 'weekly-newsletter-scheduler');

commit;
