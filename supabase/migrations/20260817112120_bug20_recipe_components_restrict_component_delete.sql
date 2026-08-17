-- ============================================================
-- ALREADY APPLIED TO THE HOSTED SUPABASE PROJECT.
--
-- Applied directly via the Supabase MCP `apply_migration` tool on
-- 2026-08-17 (version `20260817112120`, matching
-- `supabase_migrations.schema_migrations` on the live project), NOT
-- deployed by running this file. Everything from the next "-- Phase 2:"
-- comment onward is byte-for-byte identical to the exact statement that
-- was submitted and applied (verified via MD5 checksum against
-- `supabase_migrations.schema_migrations.statements`).
--
-- BUG-20 (see docs/bakery-rebuild/03-bug-register.md): deleting a recipe
-- still used as a component in another recipe used to cascade silently.
-- This is a constraint-only change (CASCADE -> RESTRICT on one foreign
-- key) -- it does not read, write, or delete any existing row, so it
-- cannot fail against current data and needs no data backfill.
--
-- Verified live after applying: confdeltype for
-- recipe_components_component_recipe_id_fkey is now 'r' (RESTRICT); a
-- transaction-wrapped, rolled-back test delete of "Cream Cheese Frosting"
-- (a real recipe confirmed used as a component in 4 other recipes) now
-- fails with 23503 "violates foreign key constraint" instead of silently
-- cascading, exactly as intended.
-- ============================================================

-- Phase 2: BUG-20 fix. Deleting a recipe that is still used as a component
-- in another recipe currently cascades silently (ON DELETE CASCADE on
-- recipe_components.component_recipe_id), removing it from every recipe
-- that uses it with no warning. This changes that one foreign key to
-- ON DELETE RESTRICT, matching the safe behavior already correctly in
-- place for the other two "still in use" cases (ingredients still
-- referenced by recipe_ingredients/packaging_profile_items, and recipes
-- still referenced by menu_items.recipe_id -- both already RESTRICT/NO
-- ACTION). recipe_components_parent_recipe_id_fkey is intentionally left
-- as CASCADE -- deleting a recipe should still remove its own
-- component-link rows, that part is correct today.
--
-- Idempotent: only runs if the constraint is not already RESTRICT.
-- Constraint-only change; no existing row is read, written, or deleted, so
-- this cannot fail against current data.
begin;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recipe_components_component_recipe_id_fkey'
      and confdeltype = 'c'
  ) then
    alter table public.recipe_components
      drop constraint recipe_components_component_recipe_id_fkey;

    alter table public.recipe_components
      add constraint recipe_components_component_recipe_id_fkey
        foreign key (component_recipe_id) references public.recipes(id) on delete restrict;
  end if;
end $$;

commit;
