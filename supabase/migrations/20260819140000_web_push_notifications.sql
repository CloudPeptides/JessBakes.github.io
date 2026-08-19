-- ============================================================
-- Web Push notifications for new orders (installable admin PWA).
--
-- Three new tables, admin-only end to end:
--   * admin_push_subscriptions -- one row per admin+device Web Push
--     subscription. RLS lets an admin register/view/disable only
--     their OWN rows (auth.uid() = admin_user_id); the actual send
--     path uses the service-role client (bypasses RLS) to read every
--     active subscription across all approved admins/devices.
--   * push_outbox -- durable queue, ONE row per order event (not per
--     device -- the send-push Edge Function fans out to every active
--     subscription at send time, so adding a second admin device
--     later needs no outbox change and never double-enqueues).
--     idempotency_key is unique, so a duplicate/retried order_items
--     insert can never enqueue a second push event for the same
--     order -- exactly the same pattern already proven for
--     email_outbox.
--   * push_settings -- singleton, admin-only, mirrors email_settings.
--     order_push_enabled defaults to FALSE: deploying this migration
--     enables no real sending on its own.
--
-- Enqueue trigger: a SEPARATE statement-level AFTER INSERT trigger on
-- order_items (own function, own exception handler) alongside the
-- existing enqueue_order_received_email trigger -- both fire once per
-- order_items INSERT statement (i.e. only after ALL of an order's
-- items exist), completely independently of each other, so a push
-- failure/disable can never affect order-confirmation emails or vice
-- versa, and neither can ever fail the order/order_items write itself
-- (both are exception-wrapped, matching the fix already proven live
-- in 20260818143142_fix_order_email_trigger_security_definer.sql).
--
-- No backfill: only NEW order_items inserts (from this point forward)
-- enqueue a push_outbox row, so deploying this never sends a
-- notification for any pre-existing order.
-- ============================================================
begin;

-- ---------------------------------------------------------------
-- 1) admin_push_subscriptions
-- ---------------------------------------------------------------
create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  disabled boolean not null default false,
  disabled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_push_subs_admin on public.admin_push_subscriptions (admin_user_id);
create index if not exists idx_admin_push_subs_active on public.admin_push_subscriptions (disabled) where disabled = false;

alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_subscriptions from anon;

-- Admins may register/view/update ONLY their own subscription rows.
-- No policy grants anything to anon or to a non-admin authenticated
-- user -- is_admin() is required in every clause, matching every
-- other admin-only table in this project.
drop policy if exists "Admins manage their own push subscriptions (select)" on public.admin_push_subscriptions;
create policy "Admins manage their own push subscriptions (select)" on public.admin_push_subscriptions
  for select to authenticated
  using (is_admin() and admin_user_id = auth.uid());

drop policy if exists "Admins manage their own push subscriptions (insert)" on public.admin_push_subscriptions;
create policy "Admins manage their own push subscriptions (insert)" on public.admin_push_subscriptions
  for insert to authenticated
  with check (is_admin() and admin_user_id = auth.uid());

drop policy if exists "Admins manage their own push subscriptions (update)" on public.admin_push_subscriptions;
create policy "Admins manage their own push subscriptions (update)" on public.admin_push_subscriptions
  for update to authenticated
  using (is_admin() and admin_user_id = auth.uid())
  with check (is_admin() and admin_user_id = auth.uid());

-- ---------------------------------------------------------------
-- 2) push_outbox
-- ---------------------------------------------------------------
create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'order_new' check (event_type in ('order_new')),
  idempotency_key text not null unique,
  order_id uuid references public.orders(id) on delete set null,
  -- Set only for a test send (Settings -> Send Test Notification):
  -- scopes delivery to that ONE admin's own devices, never every
  -- approved admin's phone. Null (the real order_new path) means
  -- "fan out to every active subscription".
  target_admin_user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'failed', 'skipped'
  )),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_outbox_status_next_attempt
  on public.push_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');
create index if not exists idx_push_outbox_order on public.push_outbox (order_id);

alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon;

drop policy if exists "Admins can view push outbox" on public.push_outbox;
create policy "Admins can view push outbox" on public.push_outbox
  for select to authenticated using (is_admin());

-- ---------------------------------------------------------------
-- 3) push_settings (singleton, admin-only)
-- ---------------------------------------------------------------
create table if not exists public.push_settings (
  id uuid primary key default gen_random_uuid(),
  order_push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create unique index if not exists push_settings_singleton_idx on public.push_settings ((true));

insert into public.push_settings (order_push_enabled)
select false
where not exists (select 1 from public.push_settings);

alter table public.push_settings enable row level security;
revoke all on public.push_settings from anon;

drop policy if exists "Admins can view push settings" on public.push_settings;
create policy "Admins can view push settings" on public.push_settings
  for select to authenticated using (is_admin());
drop policy if exists "Admins can update push settings" on public.push_settings;
create policy "Admins can update push settings" on public.push_settings
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------
-- 4) Enqueue trigger (separate from, and independent of, the email
--    trigger on the same table/event).
-- ---------------------------------------------------------------
create or replace function public.enqueue_order_push_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  for v_order in
    select distinct o.id
    from new_items ni
    join public.orders o on o.id = ni.order_id
  loop
    insert into public.push_outbox (event_type, idempotency_key, order_id)
    values ('order_new', 'push_order_new:' || v_order.id::text, v_order.id)
    on conflict (idempotency_key) do nothing;
  end loop;

  return null;
exception when others then
  raise warning 'enqueue_order_push_event failed (order save is unaffected): %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.enqueue_order_push_event() from public, anon, authenticated;

drop trigger if exists trg_enqueue_order_push_event on public.order_items;
create trigger trg_enqueue_order_push_event
  after insert on public.order_items
  referencing new table as new_items
  for each statement execute function public.enqueue_order_push_event();

commit;
