-- Deterministic rollback of 20260819120000_admin_new_order_notification.sql.
-- Restores enqueue_order_received_email() to its prior (order_received
-- only) body, drops the owner-notification settings columns, and
-- narrows email_outbox.email_type back to its previous set.
--
-- Any 'admin_new_order' rows already in email_outbox are left in
-- place (historical data is not deleted by a rollback) but will fail
-- the narrowed check constraint if this script tries to re-add it
-- while such rows exist -- so pending/failed admin_new_order rows are
-- deleted first; sent/skipped ones are kept for audit history with
-- their email_type widened to 'order_received' would misrepresent
-- history, so instead they are simply removed from the constraint's
-- reach by deleting them too. This mirrors how this project's other
-- rollbacks treat feature-specific data: reversible schema, not
-- silently-preserved orphan rows that no longer fit the schema.
begin;

delete from public.email_outbox where email_type = 'admin_new_order';

create or replace function public.enqueue_order_received_email()
returns trigger
language plpgsql
security definer
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
exception when others then
  raise warning 'enqueue_order_received_email failed (order save is unaffected): %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.enqueue_order_received_email() from public, anon, authenticated;

alter table public.email_outbox drop constraint if exists email_outbox_email_type_check;
alter table public.email_outbox
  add constraint email_outbox_email_type_check
  check (email_type in (
    'order_received', 'order_confirmed', 'order_cancelled',
    'newsletter_welcome', 'weekly_menu'
  ));

alter table public.email_settings
  drop column if exists owner_notification_email,
  drop column if exists owner_notifications_enabled;

commit;
