-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260817112120_bug20_recipe_components_restrict_component_delete.sql
--
-- NOT applied. Restores recipe_components_component_recipe_id_fkey to its
-- original ON DELETE CASCADE behavior. No data was ever touched by the
-- forward migration (constraint-only change), so this is likewise a pure
-- constraint change -- no backup table, no data to restore.
--
-- Idempotent: only runs if the constraint is currently RESTRICT.
-- ============================================================
begin;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recipe_components_component_recipe_id_fkey'
      and confdeltype = 'r'
  ) then
    alter table public.recipe_components
      drop constraint recipe_components_component_recipe_id_fkey;

    alter table public.recipe_components
      add constraint recipe_components_component_recipe_id_fkey
        foreign key (component_recipe_id) references public.recipes(id) on delete cascade;
  end if;
end $$;

commit;
