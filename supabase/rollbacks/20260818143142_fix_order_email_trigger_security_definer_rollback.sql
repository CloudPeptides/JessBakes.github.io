-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818143142_fix_order_email_trigger_security_definer.sql
--
-- NOT recommended to apply -- this restores the exact broken
-- pre-fix behavior (real anon checkout fails with an RLS violation
-- on email_outbox). Provided only for completeness/symmetry with
-- this repo's migration convention. Restores both functions to
-- their original SECURITY INVOKER, no-exception-handler bodies
-- exactly as shipped in 20260818120000_email_system_schema.sql.
-- ============================================================
begin;

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

commit;
