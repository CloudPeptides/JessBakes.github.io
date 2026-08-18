-- ============================================================
-- BUG-21 (safe portion): missing FK indexes, redundant permissive
-- RLS policies, and one function with a mutable search_path.
--
-- Confirmed live via the Supabase performance/security advisors on
-- 2026-08-18. Deliberately excludes items from the same advisor run
-- that are NOT part of this migration's scope:
--   - `admins` RLS-enabled-no-policy (pre-existing, intentional --
--     the table is only ever read through the SECURITY DEFINER
--     is_admin() function, not touched here).
--   - The three `authenticated`-executable SECURITY DEFINER function
--     warnings (complete_production/end_current_ballot/is_admin) --
--     these are legitimate: the real admin calls them as an
--     authenticated user, and each already gates on is_admin()
--     internally (see 20260817092629_...). Revoking `authenticated`
--     EXECUTE here would break the admin dashboard.
--   - Leaked-password protection -- an Auth setting only togglable
--     in the Supabase dashboard, not via SQL.
--
-- Applied and verified live 2026-08-18: all three targeted advisor
-- categories (unindexed_foreign_keys, multiple_permissive_policies,
-- function_search_path_mutable) are gone from a re-run of the
-- advisors; no rows in any table were read, written, or deleted by
-- this migration (indexes/policies/function options only).
-- ============================================================
begin;

-- ---------------------------------------------------------------
-- 1) Covering indexes for every unindexed foreign key flagged by
--    the performance advisor. No data change; purely additive.
-- ---------------------------------------------------------------
create index if not exists idx_ingredients_category_id on public.ingredients (category_id);
create index if not exists idx_ingredients_supplier_id on public.ingredients (supplier_id);
create index if not exists idx_menu_items_packaging_profile_id on public.menu_items (packaging_profile_id);
create index if not exists idx_menu_items_recipe_id on public.menu_items (recipe_id);
create index if not exists idx_order_items_menu_item_id on public.order_items (menu_item_id);
create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_purchases_ingredient_id on public.purchases (ingredient_id);
create index if not exists idx_purchases_supplier_id on public.purchases (supplier_id);
create index if not exists idx_recipe_components_component_recipe_id on public.recipe_components (component_recipe_id);
create index if not exists idx_recipe_components_parent_recipe_id on public.recipe_components (parent_recipe_id);
create index if not exists idx_recipe_ingredients_ingredient_id on public.recipe_ingredients (ingredient_id);
create index if not exists idx_recipe_ingredients_recipe_id on public.recipe_ingredients (recipe_id);
create index if not exists idx_sale_items_menu_item_id on public.sale_items (menu_item_id);
create index if not exists idx_sale_items_sale_id on public.sale_items (sale_id);
create index if not exists idx_sales_order_id on public.sales (order_id);

-- ---------------------------------------------------------------
-- 2) Redundant permissive RLS policies for `authenticated`.
--
-- gallery_photos, menu_items, and reviews each have a "Public can
-- view ..." policy granted to the `public` pseudo-role (which
-- includes `authenticated`) alongside an "Admins can view all ..."
-- policy that already grants `authenticated` unconditional SELECT --
-- so Postgres evaluates both permissive policies on every
-- authenticated SELECT. Scoping the public policy to `anon` removes
-- the overlap. `anon` already holds an explicit table-level SELECT
-- grant on all three tables (confirmed via
-- information_schema.role_table_grants before writing this
-- migration), so anonymous visitors keep exactly the same access.
-- ---------------------------------------------------------------
drop policy if exists "Public can view published photos" on public.gallery_photos;
create policy "Public can view published photos" on public.gallery_photos
  for select to anon
  using (published = true);

drop policy if exists "Public can view available menu items" on public.menu_items;
create policy "Public can view available menu items" on public.menu_items
  for select to anon
  using (available = true);

drop policy if exists "Public can view approved reviews" on public.reviews;
create policy "Public can view approved reviews" on public.reviews
  for select to anon
  using (approved = true);

-- suggestions has two literally identical `authenticated`/SELECT/`true`
-- policies ("Admins can view suggestions" and "Authenticated can read
-- suggestions") -- true duplicates, not a public/admin split. Drop the
-- redundant one; net access for `authenticated` is unchanged.
drop policy if exists "Authenticated can read suggestions" on public.suggestions;

-- ---------------------------------------------------------------
-- 3) Fixed search_path hygiene, matching the convention already
--    applied to every other function in 20260817092629_....
-- ---------------------------------------------------------------
alter function public.set_packaging_updated_at() set search_path = public;

commit;
