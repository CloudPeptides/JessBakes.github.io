-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818090000_bug21_fk_indexes_redundant_rls_search_path.sql
--
-- NOT applied. No data was ever touched by the forward migration
-- (indexes/policies/function options only), so this is likewise a
-- pure schema-object rollback -- no backup table, no data to restore.
-- ============================================================
begin;

-- 3) Restore the mutable search_path (matches pre-migration state).
alter function public.set_packaging_updated_at() reset search_path;

-- 2) Restore the original policies exactly as they were.
drop policy if exists "Public can view published photos" on public.gallery_photos;
create policy "Public can view published photos" on public.gallery_photos
  for select to public
  using (published = true);

drop policy if exists "Public can view available menu items" on public.menu_items;
create policy "Public can view available menu items" on public.menu_items
  for select to public
  using (available = true);

drop policy if exists "Public can view approved reviews" on public.reviews;
create policy "Public can view approved reviews" on public.reviews
  for select to public
  using (approved = true);

drop policy if exists "Authenticated can read suggestions" on public.suggestions;
create policy "Authenticated can read suggestions" on public.suggestions
  for select to authenticated
  using (true);

-- 1) Drop the added covering indexes.
drop index if exists public.idx_ingredients_category_id;
drop index if exists public.idx_ingredients_supplier_id;
drop index if exists public.idx_menu_items_packaging_profile_id;
drop index if exists public.idx_menu_items_recipe_id;
drop index if exists public.idx_order_items_menu_item_id;
drop index if exists public.idx_order_items_order_id;
drop index if exists public.idx_purchases_ingredient_id;
drop index if exists public.idx_purchases_supplier_id;
drop index if exists public.idx_recipe_components_component_recipe_id;
drop index if exists public.idx_recipe_components_parent_recipe_id;
drop index if exists public.idx_recipe_ingredients_ingredient_id;
drop index if exists public.idx_recipe_ingredients_recipe_id;
drop index if exists public.idx_sale_items_menu_item_id;
drop index if exists public.idx_sale_items_sale_id;
drop index if exists public.idx_sales_order_id;

commit;
