-- ============================================================
-- URGENT FIX: production checkout was failing with
-- "new row violates row-level security policy for table email_outbox".
--
-- Root cause: enqueue_order_received_email() and
-- enqueue_order_status_email() insert into email_outbox but were
-- NOT security definer -- so when the order_items AFTER INSERT
-- trigger fired during a real anon checkout, it ran as `anon`,
-- which correctly has zero grants on email_outbox (by design --
-- see the original email_system_schema migration). The insert
-- failed, and because triggers execute inside the same transaction
-- as their triggering statement, the failure aborted the entire
-- order_items insert -- meaning a customer's order row was created
-- but every item failed to save. The original migration's own test
-- (a rolled-back transaction run via a privileged connection) never
-- caught this, because it never exercised the trigger as the `anon`
-- role the way real checkout does.
--
-- Fix: both functions become SECURITY DEFINER (they already have a
-- fixed search_path), so the email_outbox insert runs as the
-- function owner -- never as anon or authenticated -- regardless of
-- who triggered it. This does NOT grant anon or authenticated any
-- new access: both return type `trigger`, which Postgres only ever
-- invokes via the trigger mechanism itself -- they cannot be called
-- directly via RPC by any role, with or without an EXECUTE grant,
-- so there is no new callable surface here (verified live -- see the
-- follow-up migration).
--
-- Also wrapped each function's insert in an exception handler that
-- logs and swallows any failure rather than re-raising -- so a
-- customer's order can never again fail to save because of an
-- email-outbox problem, whatever the cause turns out to be next
-- time. Idempotency (ON CONFLICT DO NOTHING on the unique
-- idempotency_key) is unchanged.
--
-- Verified live 2026-08-18: a real anon-role checkout (order +
-- order_items insert via the anon key, including a builder_details
-- item) succeeded end-to-end -- 1 order, correct item count, exactly
-- 1 email_outbox row, sent and confirmed delivered via the Resend
-- webhook. Re-verified again after the follow-up grant-tightening
-- migration to confirm the EXECUTE revoke doesn't affect trigger
-- firing (it doesn't -- Postgres invokes triggers independently of
-- the invoking role's EXECUTE privilege on the trigger function).
-- ============================================================
begin;

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

create or replace function public.enqueue_order_status_email()
returns trigger
language plpgsql
security definer
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
exception when others then
  raise warning 'enqueue_order_status_email failed (status update is unaffected): %', sqlerrm;
  return new;
end;
$$;

commit;
