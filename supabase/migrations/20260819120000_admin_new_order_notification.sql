-- ============================================================
-- Internal "new order" notification to the bakery owner.
--
-- Independent from the existing order_received customer email:
-- separate email_type ('admin_new_order'), separate outbox row,
-- separate idempotency_key ('admin_new_order:<order_id>'), separate
-- enable toggle (owner_notifications_enabled). Enqueued by the same
-- statement-level order_items trigger that already enqueues
-- order_received -- i.e. only after ALL of an order's items have
-- been saved -- so both emails are generated from one successful
-- order, but a failure/disable of either one never affects the
-- other (each outbox row is processed independently) and never
-- affects the order/order_items write itself (the trigger function
-- is already wrapped in an exception handler that logs and swallows
-- any failure -- see 20260818143142_fix_order_email_trigger_
-- security_definer.sql).
--
-- Per-order uniqueness is enforced at the database level by
-- email_outbox.idempotency_key's existing unique constraint --
-- retries, page refreshes, and repeated ON CONFLICT DO NOTHING
-- inserts (whatever fires the trigger more than once for the same
-- order) can never produce a second admin_new_order row.
-- ============================================================
begin;

-- 1) Recognize the new email_type.
alter table public.email_outbox drop constraint if exists email_outbox_email_type_check;
alter table public.email_outbox
  add constraint email_outbox_email_type_check
  check (email_type in (
    'order_received', 'order_confirmed', 'order_cancelled',
    'newsletter_welcome', 'weekly_menu', 'admin_new_order'
  ));

-- 2) Settings: where to send it, and whether to send it at all.
--    owner_notification_email is initially backfilled from the
--    already-configured reply_to_email (the existing business
--    contact address) rather than left blank or hardcoded -- the
--    admin can change it independently afterward on the Email page.
alter table public.email_settings
  add column if not exists owner_notification_email text,
  add column if not exists owner_notifications_enabled boolean not null default false;

update public.email_settings
  set owner_notification_email = reply_to_email
where owner_notification_email is null
  and reply_to_email is not null;

-- 3) Enqueue trigger: extend the existing order_received function
--    (statement-level, fires once per order_items INSERT statement,
--    reading the transition table -- so this only runs after ALL of
--    an order's items exist, exactly like order_received) to also
--    insert an admin_new_order row, addressed to whatever owner
--    notification email is configured at the time. If none is
--    configured yet, this is skipped for now (nothing to send to) --
--    not retroactive once one is set, same convention as every other
--    "not configured yet" gap in this system.
create or replace function public.enqueue_order_received_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_owner_email text;
begin
  select owner_notification_email into v_owner_email
  from public.email_settings
  limit 1;

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

    if v_owner_email is not null and btrim(v_owner_email) <> '' then
      insert into public.email_outbox (
        email_type, idempotency_key, recipient_email,
        recipient_ref_table, recipient_ref_id
      ) values (
        'admin_new_order',
        'admin_new_order:' || v_order.id::text,
        lower(btrim(v_owner_email)),
        'orders', v_order.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return null;
exception when others then
  raise warning 'enqueue_order_received_email failed (order save is unaffected): %', sqlerrm;
  return null;
end;
$$;

-- Grants are unaffected by create-or-replace, but re-assert the
-- project's minimal-grants convention explicitly (matches
-- 20260818143411_tighten_order_email_trigger_grants.sql).
revoke all on function public.enqueue_order_received_email() from public, anon, authenticated;

commit;
