-- ============================================================
-- Production email system schema: order-lifecycle transactional
-- emails, single-opt-in newsletter with per-email unsubscribe
-- tokens, a durable outbox/queue, weekly-campaign scheduling
-- support, webhook event log, and admin-only settings.
--
-- Design summary (see docs/bakery-rebuild/10-email-system.md for
-- the full writeup):
--   * subscribers gains a real lifecycle `status` (active/
--     unsubscribed/bounced/complained), consent metadata, and a
--     regenerating consent_event_id used to key welcome emails so
--     a genuine resubscribe gets a fresh welcome email while a
--     duplicate form-submit does not.
--   * email_outbox is the single durable queue every outbound
--     email (order + newsletter) flows through, keyed by a unique
--     idempotency_key so retries/duplicate triggers can never
--     double-send. No rendered HTML/customer content is stored --
--     only routing/status metadata; the actual email is rendered
--     fresh at send time from source data.
--   * email_campaigns tracks one row per weekly send (or skip),
--     keyed by a unique campaign_key derived from the Berlin-local
--     Sunday date, so a scheduler retry can never create two
--     campaigns for the same week.
--   * email_unsubscribe_tokens holds only a SHA-256 hash per
--     token; a fresh token is minted for every email a subscriber
--     is sent (not reused/derived), so no raw token or subscriber
--     ID ever needs to be reconstructed from stored data, and old
--     links keep working indefinitely.
--   * email_settings (weekly campaign config) and bakery_settings
--     (private pickup location + general settings) are singleton
--     tables, admin-only, with zero anon access.
--   * email_webhook_events stores only sanitized fields from
--     Resend/Svix delivery events -- never the full raw payload.
--   * Going forward, ALL public writes (subscribe/unsubscribe) go
--     through narrowly-scoped Edge Functions using the service-role
--     key, which bypasses RLS -- so no table here grants anon
--     anything at all. The pre-existing "Anyone can subscribe"
--     direct-insert policy on `subscribers` is removed as part of
--     this migration (closing a live surface that let anyone
--     insert arbitrary subscriber rows with no validation, consent
--     recording, or rate limiting).
--   * Order-lifecycle emails are enqueued by database triggers
--     (not client code), so they cannot be skipped, duplicated, or
--     spoofed by retries in the browser: order_received fires once
--     per order after ALL of that order's items are inserted
--     (statement-level trigger on order_items, reading the
--     transition table); order_confirmed/order_cancelled fire on
--     the orders.status transition into 'confirmed'/'cancelled'.
--     A failing/slow email send can never block or roll back the
--     order/order_items write itself -- enqueueing is a simple
--     insert with ON CONFLICT DO NOTHING, and actual sending
--     happens later, out of band, in an Edge Function.
-- ============================================================
begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------
-- 1) subscribers: extend with a real lifecycle + consent metadata.
-- ---------------------------------------------------------------
alter table public.subscribers
  add column if not exists status text not null default 'active',
  add column if not exists consent_at timestamptz,
  add column if not exists consent_source text,
  add column if not exists privacy_version text,
  add column if not exists consent_event_id uuid not null default gen_random_uuid(),
  add column if not exists bounce_count integer not null default 0,
  add column if not exists complaint_count integer not null default 0,
  add column if not exists suppressed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscribers_status_check'
  ) then
    alter table public.subscribers
      add constraint subscribers_status_check
      check (status in ('active', 'unsubscribed', 'bounced', 'complained'));
  end if;
end $$;

-- Backfill: existing rows are treated as legacy, already-consented
-- subscribers (owner-confirmed scope: they keep their subscription,
-- but do NOT get a retroactive welcome email -- welcome emails are
-- only ever enqueued by the newsletter-subscribe Edge Function's own
-- insert path, never by this migration).
update public.subscribers
  set status = case when is_active then 'active' else 'unsubscribed' end,
      consent_source = coalesce(consent_source, 'legacy_import'),
      consent_at = coalesce(consent_at, created_at),
      privacy_version = coalesce(privacy_version, '2026-08-18')
where consent_source is null;

-- Case-insensitive dedup, in addition to the existing plain unique
-- constraint on `email` (kept as-is; this is stricter, not a
-- replacement, and the Edge Function always writes lowercased/
-- trimmed email going forward so the two never disagree).
create unique index if not exists subscribers_email_lower_idx
  on public.subscribers (lower(btrim(email)));

create index if not exists idx_subscribers_status on public.subscribers (status);

-- Keep the legacy `is_active` boolean (still read by
-- js/admin-subscribers.js) in sync with the new `status` column,
-- so no existing admin code needs to change.
create or replace function public.sync_subscriber_is_active()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_active := (new.status = 'active');
  new.updated_at := now();

  -- A genuine (re)subscribe event -- status transitioning INTO
  -- 'active' from something else, including first insert -- mints a
  -- fresh consent_event_id so a resubscribe after unsubscribing gets
  -- its own welcome email, keyed independently from any prior one.
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.consent_event_id := gen_random_uuid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_subscriber_is_active on public.subscribers;
create trigger trg_sync_subscriber_is_active
  before insert or update of status on public.subscribers
  for each row execute function public.sync_subscriber_is_active();

-- Close the pre-existing unrestricted-anon-insert surface. Going
-- forward, subscribing happens exclusively through the
-- newsletter-subscribe Edge Function (service-role, bypasses RLS),
-- which validates, rate-limits, honeypot-checks, and records real
-- consent metadata -- none of which the old direct-insert policy did.
drop policy if exists "Anyone can subscribe" on public.subscribers;
revoke all on public.subscribers from anon;

-- ---------------------------------------------------------------
-- 2) email_unsubscribe_tokens: one row per minted token (one per
--    email actually sent, not one per subscriber), hash-only.
-- ---------------------------------------------------------------
create table if not exists public.email_unsubscribe_tokens (
  token_hash text primary key,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists idx_unsub_tokens_subscriber on public.email_unsubscribe_tokens (subscriber_id);

alter table public.email_unsubscribe_tokens enable row level security;
revoke all on public.email_unsubscribe_tokens from anon, authenticated;

-- ---------------------------------------------------------------
-- 3) email_campaigns: one row per weekly send (or documented skip).
-- ---------------------------------------------------------------
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_type text not null default 'weekly_menu' check (campaign_type in ('weekly_menu')),
  campaign_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skip_reason text,
  menu_snapshot jsonb,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_campaigns_status on public.email_campaigns (status);
create index if not exists idx_email_campaigns_created_at on public.email_campaigns (created_at desc);

alter table public.email_campaigns enable row level security;
revoke all on public.email_campaigns from anon;

-- ---------------------------------------------------------------
-- 4) email_outbox: the durable queue every outbound email flows
--    through. No rendered HTML/customer content is stored.
-- ---------------------------------------------------------------
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  email_type text not null check (email_type in (
    'order_received', 'order_confirmed', 'order_cancelled',
    'newsletter_welcome', 'weekly_menu'
  )),
  idempotency_key text not null unique,
  recipient_email text not null,
  recipient_ref_table text check (recipient_ref_table in ('orders', 'subscribers')),
  recipient_ref_id uuid,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending', 'sending', 'sent', 'failed', 'cancelled', 'skipped'
  )),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_outbox_status_next_attempt
  on public.email_outbox (status, next_attempt_at)
  where status in ('pending', 'failed');
create index if not exists idx_email_outbox_recipient_ref
  on public.email_outbox (recipient_ref_table, recipient_ref_id);
create index if not exists idx_email_outbox_campaign on public.email_outbox (campaign_id);
create index if not exists idx_email_outbox_type on public.email_outbox (email_type);

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon;

-- ---------------------------------------------------------------
-- 5) email_webhook_events: sanitized Resend/Svix event log. Never
--    the full raw payload (which contains the recipient address).
-- ---------------------------------------------------------------
create table if not exists public.email_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend',
  event_type text not null,
  provider_message_id text,
  outbox_id uuid references public.email_outbox(id) on delete set null,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  detail text,
  received_at timestamptz not null default now(),
  processed boolean not null default false
);

create index if not exists idx_webhook_events_message_id on public.email_webhook_events (provider_message_id);
create index if not exists idx_webhook_events_received_at on public.email_webhook_events (received_at desc);

alter table public.email_webhook_events enable row level security;
revoke all on public.email_webhook_events from anon;

-- ---------------------------------------------------------------
-- 6) email_settings: singleton, weekly-campaign configuration.
-- ---------------------------------------------------------------
create table if not exists public.email_settings (
  id uuid primary key default gen_random_uuid(),
  order_emails_enabled boolean not null default false,
  newsletter_enabled boolean not null default false,
  weekly_weekday smallint not null default 0 check (weekly_weekday between 0 and 6),
  weekly_local_time text not null default '18:00',
  weekly_timezone text not null default 'Europe/Berlin',
  sender_name text not null default 'Jess Bakes Sourdough',
  reply_to_email text,
  weekly_subject text not null default E'This Week’s Menu at Jess Bakes Sourdough',
  weekly_intro text not null default 'Here''s what''s fresh and available to order this week.',
  test_recipient_email text,
  daily_send_limit integer,
  monthly_send_limit integer,
  updated_at timestamptz not null default now()
);

create unique index if not exists email_settings_singleton_idx on public.email_settings ((true));

insert into public.email_settings (order_emails_enabled, newsletter_enabled)
select false, false
where not exists (select 1 from public.email_settings);

alter table public.email_settings enable row level security;
revoke all on public.email_settings from anon;

-- ---------------------------------------------------------------
-- 7) bakery_settings: singleton, general/private site settings.
--    pickup_location is PRIVATE -- admin-only RLS, never selected
--    by any public-facing code path.
-- ---------------------------------------------------------------
create table if not exists public.bakery_settings (
  id uuid primary key default gen_random_uuid(),
  pickup_location text,
  updated_at timestamptz not null default now()
);

create unique index if not exists bakery_settings_singleton_idx on public.bakery_settings ((true));

insert into public.bakery_settings (pickup_location)
select null
where not exists (select 1 from public.bakery_settings);

alter table public.bakery_settings enable row level security;
revoke all on public.bakery_settings from anon;

-- ---------------------------------------------------------------
-- 8) RLS policies: admin-only (authenticated + is_admin()) for every
--    table above. No anon policy anywhere -- public access is only
--    ever through the Edge Functions (service-role, bypasses RLS).
-- ---------------------------------------------------------------
drop policy if exists "Admins can view outbox" on public.email_outbox;
create policy "Admins can view outbox" on public.email_outbox
  for select to authenticated using (is_admin());
drop policy if exists "Admins can update outbox" on public.email_outbox;
create policy "Admins can update outbox" on public.email_outbox
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "Admins can view campaigns" on public.email_campaigns;
create policy "Admins can view campaigns" on public.email_campaigns
  for select to authenticated using (is_admin());

drop policy if exists "Admins can view webhook events" on public.email_webhook_events;
create policy "Admins can view webhook events" on public.email_webhook_events
  for select to authenticated using (is_admin());

drop policy if exists "Admins can view unsubscribe tokens" on public.email_unsubscribe_tokens;
create policy "Admins can view unsubscribe tokens" on public.email_unsubscribe_tokens
  for select to authenticated using (is_admin());

drop policy if exists "Admins can view email settings" on public.email_settings;
create policy "Admins can view email settings" on public.email_settings
  for select to authenticated using (is_admin());
drop policy if exists "Admins can update email settings" on public.email_settings;
create policy "Admins can update email settings" on public.email_settings
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "Admins can view bakery settings" on public.bakery_settings;
create policy "Admins can view bakery settings" on public.bakery_settings
  for select to authenticated using (is_admin());
drop policy if exists "Admins can update bakery settings" on public.bakery_settings;
create policy "Admins can update bakery settings" on public.bakery_settings
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------
-- 9) Order-lifecycle enqueue triggers.
-- ---------------------------------------------------------------

-- Fires once per INSERT statement on order_items (cart.js inserts
-- every line of one order in a single bulk .insert() call), reading
-- the transition table so it only runs after ALL of that order's
-- items exist. Skips silently (no row inserted) if the order has no
-- email on file -- there is nowhere to send it, and customer_email
-- is nullable by design (checkout only requires phone).
create or replace function public.enqueue_order_received_email()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_order record;
begin
  for v_order in
    select distinct o.id, o.customer_email
    from new_items ni
    join public.orders o on o.id = ni.order_id
  loop
    if v_order.customer_email is not null and btrim(v_order.customer_email) <> '' then
      insert into public.email_outbox (
        email_type, idempotency_key, recipient_email,
        recipient_ref_table, recipient_ref_id
      ) values (
        'order_received',
        'order_received:' || v_order.id::text,
        lower(btrim(v_order.customer_email)),
        'orders', v_order.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_enqueue_order_received_email on public.order_items;
create trigger trg_enqueue_order_received_email
  after insert on public.order_items
  referencing new table as new_items
  for each statement execute function public.enqueue_order_received_email();

-- Fires on orders.status transitioning into 'confirmed'/'cancelled'.
-- ON CONFLICT DO NOTHING on the unique idempotency_key means a
-- retried/duplicate status update -- or even the same order somehow
-- reaching 'confirmed' a second time -- never enqueues a second email.
create or replace function public.enqueue_order_status_email()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'confirmed' and (old.status is distinct from 'confirmed') then
    if new.customer_email is not null and btrim(new.customer_email) <> '' then
      insert into public.email_outbox (
        email_type, idempotency_key, recipient_email,
        recipient_ref_table, recipient_ref_id
      ) values (
        'order_confirmed',
        'order_confirmed:' || new.id::text,
        lower(btrim(new.customer_email)),
        'orders', new.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  if new.status = 'cancelled' and (old.status is distinct from 'cancelled') then
    if new.customer_email is not null and btrim(new.customer_email) <> '' then
      insert into public.email_outbox (
        email_type, idempotency_key, recipient_email,
        recipient_ref_table, recipient_ref_id
      ) values (
        'order_cancelled',
        'order_cancelled:' || new.id::text,
        lower(btrim(new.customer_email)),
        'orders', new.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_order_status_email on public.orders;
create trigger trg_enqueue_order_status_email
  after update of status on public.orders
  for each row execute function public.enqueue_order_status_email();

commit;
