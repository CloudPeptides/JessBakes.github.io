-- Deterministic rollback of 20260819140000_web_push_notifications.sql.
begin;

drop trigger if exists trg_enqueue_order_push_event on public.order_items;
drop function if exists public.enqueue_order_push_event();

drop table if exists public.push_outbox;
drop table if exists public.push_settings;
drop table if exists public.admin_push_subscriptions;

commit;
