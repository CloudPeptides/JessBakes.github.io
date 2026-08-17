-- ============================================================
-- ALREADY APPLIED TO THE HOSTED SUPABASE PROJECT.
--
-- This file is a record of a migration that was applied directly via the
-- Supabase MCP `apply_migration` tool on 2026-08-17, NOT deployed by
-- running this file against the database. It is committed here purely so
-- the applied schema is version-controlled and reviewable in the repo,
-- matching Supabase's standard `supabase/migrations/` filename convention
-- (version `20260817092629`, matching this migration's recorded version in
-- `supabase_migrations.schema_migrations` on the live project).
--
-- Do not re-run this file against the hosted project — every statement in
-- it has already executed successfully there. It is safe to re-run against
-- a fresh/empty database (a local dev copy, a new environment), since it
-- uses `create table if not exists`, `create or replace function`, and
-- `drop policy if exists` throughout.
--
-- Fixes BUG-16, BUG-17, and BUG-18 from docs/bakery-rebuild/03-bug-register.md.
-- Full investigation, rationale, and verification are in
-- docs/bakery-rebuild/08-security-repair-plan.md.
--
-- Recovered verbatim from `supabase_migrations.schema_migrations` on the
-- live project on 2026-08-17 (read-only query) — this is the exact SQL
-- that was applied, not a reconstruction.
-- ============================================================

begin;

-- ============================================================
-- 1. Admin-identity infrastructure (new — required by orders/
--    order_items policies and by both SECURITY DEFINER functions)
-- ============================================================

create table if not exists public.admins (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- Intentionally zero policies: no anon/authenticated request can read or
-- write this table directly, by design. Only is_admin() (SECURITY DEFINER,
-- below) and the Postgres/service_role connection used to run this
-- migration can see it.

-- Seed with whichever account(s) already exist today. Confirmed via
-- `select count(*) from auth.users` (no email/PII read) that this is
-- currently exactly one row.
insert into public.admins (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.admins a where a.user_id = auth.uid()
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
-- 2. BUG-16 — orders / order_items
-- ============================================================

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Admins can view all orders"   on public.orders;
drop policy if exists "Admins can update orders"      on public.orders;
drop policy if exists "Admins can delete orders"      on public.orders;

create policy "Admins can view all orders" on public.orders
    for select to authenticated
    using (public.is_admin());

create policy "Admins can update orders" on public.orders
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Admins can delete orders" on public.orders
    for delete to authenticated
    using (public.is_admin());

-- "Public can create orders" (anon, INSERT, with_check: true) is left
-- exactly as-is — it is already correctly scoped to insert-only.

drop policy if exists "Admins can view all order items" on public.order_items;
drop policy if exists "Admins can update order items"    on public.order_items;
drop policy if exists "Admins can delete order items"    on public.order_items;

create policy "Admins can view all order items" on public.order_items
    for select to authenticated
    using (public.is_admin());

create policy "Admins can update order items" on public.order_items
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy "Admins can delete order items" on public.order_items
    for delete to authenticated
    using (public.is_admin());

-- "Public can create order items" is left exactly as-is.

-- Defense-in-depth: trim the raw grants to match least privilege.
revoke select, update, delete on public.orders      from anon;
revoke select, update, delete on public.order_items from anon;
grant insert on public.orders      to anon;
grant insert on public.order_items to anon;

-- ============================================================
-- 3. BUG-17 — complete_production / end_current_ballot
-- ============================================================

create or replace function public.complete_production(
    p_production_date date,
    p_snapshot jsonb,
    p_deductions jsonb
)
returns public.production_runs
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_run public.production_runs;
    v_item jsonb;
    v_id bigint;
    v_qty numeric;
begin
    if not public.is_admin() then
        raise exception 'Not authorized';
    end if;

    if p_production_date is null then
        raise exception 'p_production_date is required';
    end if;

    insert into public.production_runs(production_date,status,snapshot)
    values(p_production_date,'in_progress',p_snapshot)
    on conflict(production_date)
    do update set snapshot=excluded.snapshot,updated_at=now();

    select * into v_run
    from public.production_runs
    where production_date=p_production_date
    for update;

    if v_run.inventory_deducted then
        raise exception 'Inventory already deducted for %',p_production_date;
    end if;

    for v_item in
        select value from jsonb_array_elements(coalesce(p_deductions,'[]'::jsonb))
    loop
        v_id=(v_item->>'ingredient_id')::bigint;
        v_qty=greatest(coalesce((v_item->>'quantity_purchase_units')::numeric,0),0);
        update public.ingredients
        set quantity_on_hand=greatest(coalesce(quantity_on_hand,0)-v_qty,0)
        where id=v_id;
    end loop;

    update public.production_runs
    set status='completed',snapshot=p_snapshot,inventory_deducted=true,
        completed_at=now(),updated_at=now()
    where production_date=p_production_date
    returning * into v_run;

    return v_run;
end;
$function$;

revoke all on function public.complete_production(date, jsonb, jsonb) from public, anon;
grant execute on function public.complete_production(date, jsonb, jsonb) to authenticated;

create or replace function public.end_current_ballot(ballot_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
    if not public.is_admin() then
        raise exception 'Not authorized';
    end if;

    if ballot_uuid is null then
        raise exception 'ballot_uuid is required';
    end if;

    update public.ballot_settings
    set active = false
    where id = ballot_uuid;
end;
$function$;

revoke all on function public.end_current_ballot(uuid) from public, anon;
grant execute on function public.end_current_ballot(uuid) to authenticated;

-- Hygiene: fixed search_path for prepare_new_ballot too.
alter function public.prepare_new_ballot() set search_path = public;

-- rls_auto_enable already has a fixed search_path and, as an event-trigger
-- function, cannot realistically be invoked via RPC regardless of grants —
-- tightened anyway for hygiene / to match least-privilege intent.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- ============================================================
-- 4. BUG-18 — recipe_costs / packaging_profile_costs
-- ============================================================

alter view public.recipe_costs            set (security_invoker = true);
alter view public.packaging_profile_costs set (security_invoker = true);

revoke all on public.recipe_costs            from anon;
revoke all on public.packaging_profile_costs from anon;
grant select on public.recipe_costs            to authenticated;
grant select on public.packaging_profile_costs to authenticated;

commit;
