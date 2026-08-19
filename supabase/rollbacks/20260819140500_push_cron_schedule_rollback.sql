-- Deterministic rollback for
-- supabase/migrations/20260819140500_push_cron_schedule.sql
begin;

select cron.unschedule('push-outbox-processor')
where exists (select 1 from cron.job where jobname = 'push-outbox-processor');

commit;
