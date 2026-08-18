-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818120000_email_system_schema.sql
--
-- NOT applied. Restores subscribers to its pre-migration shape and
-- drops every new table/trigger/function this migration added.
-- Intentionally does NOT drop the pg_cron/pg_net/pgcrypto
-- extensions -- safe to leave installed even after rollback, and
-- other things may come to depend on them.
--
-- Idempotent: every statement is IF EXISTS / conditional.
-- ============================================================
begin;

-- 9) Order-lifecycle triggers/functions.
drop trigger if exists trg_enqueue_order_status_email on public.orders;
drop function if exists public.enqueue_order_status_email();

drop trigger if exists trg_enqueue_order_received_email on public.order_items;
drop function if exists public.enqueue_order_received_email();

-- 6/7) Settings tables.
drop table if exists public.bakery_settings;
drop table if exists public.email_settings;

-- 5) Webhook event log.
drop table if exists public.email_webhook_events;

-- 4) Outbox.
drop table if exists public.email_outbox;

-- 3) Campaigns.
drop table if exists public.email_campaigns;

-- 2) Unsubscribe tokens.
drop table if exists public.email_unsubscribe_tokens;

-- 1) subscribers: drop the sync trigger/function, then the added
-- columns/constraint/indexes, and restore the original anon-insert
-- policy and grant exactly as they were before this migration.
drop trigger if exists trg_sync_subscriber_is_active on public.subscribers;
drop function if exists public.sync_subscriber_is_active();

drop index if exists public.subscribers_email_lower_idx;
drop index if exists public.idx_subscribers_status;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'subscribers_status_check') then
    alter table public.subscribers drop constraint subscribers_status_check;
  end if;
end $$;

alter table public.subscribers
  drop column if exists status,
  drop column if exists consent_at,
  drop column if exists consent_source,
  drop column if exists privacy_version,
  drop column if exists consent_event_id,
  drop column if exists bounce_count,
  drop column if exists complaint_count,
  drop column if exists suppressed_at,
  drop column if exists updated_at;

grant insert, select, update, delete, truncate, references, trigger
  on public.subscribers to anon;

drop policy if exists "Anyone can subscribe" on public.subscribers;
create policy "Anyone can subscribe" on public.subscribers
  for insert to anon, authenticated
  with check (true);

commit;
