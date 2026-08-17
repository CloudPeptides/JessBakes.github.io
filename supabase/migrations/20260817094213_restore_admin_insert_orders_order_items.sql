-- ============================================================
-- ALREADY APPLIED TO THE HOSTED SUPABASE PROJECT.
--
-- This file is a record of a migration that was applied directly via the
-- Supabase MCP `apply_migration` tool on 2026-08-17, NOT deployed by
-- running this file against the database. It is committed here purely so
-- the applied schema is version-controlled and reviewable in the repo,
-- matching Supabase's standard `supabase/migrations/` filename convention
-- (version `20260817094213`, matching this migration's recorded version in
-- `supabase_migrations.schema_migrations` on the live project).
--
-- Do not re-run this file against the hosted project — both statements in
-- it have already executed successfully there.
--
-- Narrow follow-up to the prior migration
-- (20260817092629_security_repair_bug16_17_18_orders_rls_admin_functions_cost_views.sql).
-- That migration enabled RLS on `orders`/`order_items` and only preserved
-- the `SELECT`/`UPDATE`/`DELETE` admin policies that existed before RLS was
-- turned on — matching the pre-migration policy set exactly, since an
-- `INSERT` policy for `authenticated` had never been needed while RLS was
-- disabled. Enabling RLS surfaced that latent gap: any `orders`/`order_items`
-- INSERT running as `authenticated` (the admin dashboard's manual order
-- entry, or the admin testing checkout while already logged in) was
-- rejected with "new row violates row-level security policy," because the
-- only INSERT policy on either table was the intentionally anon-only
-- "Public can create orders"/"Public can create order items" policy. This
-- migration adds the missing authenticated-admin INSERT policies, gated by
-- the same is_admin() check used everywhere else. It does not alter
-- anonymous access, and it does not touch anything else the prior
-- migration set up.
--
-- Full incident detail — the failed checkout log, how the anon-vs-
-- authenticated role was determined without exposing tokens/PII, and the
-- verification tests run after this fix — is recorded in
-- docs/bakery-rebuild/08-security-repair-plan.md.
--
-- Recovered verbatim from `supabase_migrations.schema_migrations` on the
-- live project on 2026-08-17 (read-only query) — this is the exact SQL
-- that was applied, not a reconstruction.
-- ============================================================

begin;

create policy "Admins can insert orders" on public.orders
    for insert to authenticated
    with check (public.is_admin());

create policy "Admins can insert order items" on public.order_items
    for insert to authenticated
    with check (public.is_admin());

commit;
