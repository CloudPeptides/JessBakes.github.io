-- ============================================================
-- ALREADY APPLIED TO THE HOSTED SUPABASE PROJECT.
--
-- This file is a record of a migration applied directly via the Supabase
-- MCP `apply_migration` tool on 2026-08-17 (version `20260817105550`,
-- matching `supabase_migrations.schema_migrations` on the live project),
-- NOT deployed by running this file. Everything from the next
-- "-- Phase 1B:" comment onward is byte-for-byte identical to the exact
-- statement that was submitted and applied (verified via MD5 checksum
-- against `supabase_migrations.schema_migrations.statements`) -- do not
-- edit it if this file is ever re-used as a reference. Do not re-run it
-- against the hosted project.
--
-- Phase 1B: historical backfill for the 18 confirmed Mix & Match sales
-- affected by BUG-01 (see docs/bakery-rebuild/03-bug-register.md and
-- docs/bakery-rebuild/09-bug01-regression-report.md for full detail).
--
-- Design constraints, all satisfied:
--   * Uses ONLY already-stored historical values -- order_items.line_total
--     for the missing parent revenue, and each sale's own already-correct
--     sales.revenue/total_cost for the profit correction. Never reads
--     recipe_costs or packaging_profile_costs.
--   * Scoped to an explicit, closed allowlist of 18 sale IDs throughout --
--     structurally cannot touch any other sale, order, order_item,
--     inventory, recipe, production, or customer-data row.
--   * Does not touch the two unrelated "€15 anomaly" sales (BUG-22) or the
--     eight cost-drift sales -- neither is in the allowlist.
--   * No permanent backup table is created. Exact rollback SQL, derived
--     from values captured immediately before this migration ran, lives in
--     supabase/rollbacks/20260817105550_backfill_bug01_mix_and_match_18_historical_sales_rollback.sql.
--   * A safety assertion (step 4) automatically rolls back the entire
--     transaction if the resulting numbers do not match exactly what was
--     independently verified beforehand.
--
-- What actually happened when this was applied: the first attempt used a
-- hardcoded expected-profit-sum value in the safety assertion (145.28) that
-- turned out to be a transposition mistake on the author's part -- the
-- assertion caught it immediately and the entire transaction rolled back
-- automatically with zero side effects (confirmed via a read-only check
-- immediately after: 0 new rows present, sale profit still at its
-- pre-migration value). The correct value, 318.83, was independently
-- computed by hand beforehand and matched exactly what Postgres reported
-- in the aborted attempt's error message -- confirming the number itself
-- was always right and only the hardcoded assertion literal was wrong. The
-- corrected migration (below, with 318.83) was then applied successfully.
--
-- Verified after applying: all 18 sales reconcile (revenue = sum of
-- sale_items.line_revenue, profit = revenue - total_cost); total profit
-- across the 18 is exactly 318.83 (previously -16.17, a swing of exactly
-- +335.00, matching every independent measurement of this bug's impact);
-- both BUG-22 anomaly sales and a cost-drift sample sale are confirmed
-- byte-identical to their pre-migration values; orders/order_items/
-- ingredients/recipes row counts unchanged; zero duplicate revenue-bearing
-- rows found for any of the 18 sales.
-- ============================================================

-- Phase 1B: historical backfill for the 18 confirmed Mix & Match sales
-- affected by BUG-01. Uses ONLY already-stored historical values (order_items
-- .line_total for the missing parent revenue, and each sale's own already-
-- correct sales.revenue/total_cost for the profit correction). Never touches
-- recipe_costs/packaging_profile_costs. Explicit 18-sale-ID allowlist
-- throughout -- structurally cannot touch any other sale, order, order_item,
-- inventory, recipe, production, or customer-data row.
begin;

-- 1) Insert the missing revenue-bearing parent row for each of the 19
--    builder order lines across the 18 sales (one sale has two boxes).
--    IDs are pre-generated and explicit so the rollback file can target
--    them exactly -- no backup table needed.
insert into sale_items (id, sale_id, menu_item_id, item_name, quantity, unit_price, food_cost, packaging_cost, total_cost, line_revenue, line_profit)
values
('67216428-3fb9-49ed-9b70-3ca95e97095a','0c2be140-857f-46d8-99c1-eef63d440da3','83dd0bd6-8374-4cf4-a3e8-14289bca2854','Mix & Match Cinnamon Rolls',1,20.00,0,0,0,20.00,20.00),
('015d4d9a-4d09-4ba3-bf03-d27683a22c6b','0c2be140-857f-46d8-99c1-eef63d440da3','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('2dba4d44-766f-4118-bfe3-a6100fef5c05','17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('2d2b1360-4fa4-4a71-9a59-4c9f831037ca','244b48f8-4e50-4368-9661-d13306bb7c66','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('4fc6a94a-c277-49be-b776-098af6b6e0a6','378a22af-c033-4619-bf43-dd517cb9bb2c','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('3acadec3-bf3d-4fe1-9c21-add4185677d3','45158454-bb0b-4842-a552-affbd5663ff5','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('b3c1f6ec-ca4e-4d33-8af3-2464e5a98363','50630b5a-e562-4689-b8cb-161132d6f29c','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('a2051190-e48f-4255-897e-203aee37927a','57bb97bc-96a6-4f60-ba65-dd2bba695ade','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('80077153-33b6-43fb-8812-055a6986ddee','5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('d62c872c-207f-4895-abcb-9d2a3f672f88','9585be5e-e95f-4fbf-87c8-e596772347c2','22a1b32f-a307-4dec-b5e3-2b014bb8ade0','12 Mix & Match Cookies',1,25.00,0,0,0,25.00,25.00),
('4790b2df-aeae-4969-8133-703c51771a96','98e7a52b-4157-4593-a84e-2af6722e84bd','22a1b32f-a307-4dec-b5e3-2b014bb8ade0','12 Mix & Match Cookies',1,25.00,0,0,0,25.00,25.00),
('fee8bb65-b69e-4489-a7db-c3489698c9bc','acc07673-c812-4937-9c34-481190dea042','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('0abe7dba-05d1-4b42-a4c7-8da6c680000d','b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('998858ea-7e65-484c-adbf-18545ced5ec8','bee8c664-625f-499d-9d59-e1b0b28657fc','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('553a5bb8-3d0a-4286-8232-75abbd3bafe5','c126d972-5103-4842-9d0a-b888a8e40320','83dd0bd6-8374-4cf4-a3e8-14289bca2854','Mix & Match Cinnamon Rolls',1,20.00,0,0,0,20.00,20.00),
('48ba5ae2-6501-4e01-beb9-bf54c55f4dcf','c28a5435-aef9-4109-a482-c806445097c9','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('3ebc607e-2575-4d4b-a2c6-4f67f53078e8','ce484030-bb4c-419a-adeb-9565929de2f5','22a1b32f-a307-4dec-b5e3-2b014bb8ade0','12 Mix & Match Cookies',1,25.00,0,0,0,25.00,25.00),
('b89537fc-6319-4d12-85e6-8442a4fc4235','d06b4e30-3465-41f5-b66d-ab6d8739e6fa','2dfec176-0e71-429b-a62f-4b337ff33d71','6 Mix & Match Cookies',1,15.00,0,0,0,15.00,15.00),
('40a9756d-0967-44d7-aa58-c9189379d5e7','deb53e6f-d3f0-48e1-b877-4f7aa67677be','22a1b32f-a307-4dec-b5e3-2b014bb8ade0','12 Mix & Match Cookies',1,25.00,0,0,0,25.00,25.00);

-- 2) Correct the existing child rows' line_profit using their own already-
--    stored total_cost (never recomputed from current cost tables).
update sale_items
set line_profit = -(total_cost * quantity)
where sale_id in (
  'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
  '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
  '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
  'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
  '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
  '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
)
and line_revenue = 0 and total_cost > 0;

-- 3) Correct sale-level profit from already-correct revenue/total_cost.
update sales
set profit = revenue - total_cost
where id in (
  'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
  '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
  '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
  'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
  '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
  '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
);

-- 4) Safety assertion: automatically abort the whole transaction unless
--    every expected condition holds exactly.
do $$
declare
  v_profit_sum numeric;
  v_revenue_mismatch int;
begin
  select sum(profit) into v_profit_sum from sales where id in (
    'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
    '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
    '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
    'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
    '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
    '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
  );
  if v_profit_sum is distinct from 318.83 then
    raise exception 'Aborting: corrected profit sum for the 18 sales is %, expected exactly 318.83', v_profit_sum;
  end if;

  select count(*) into v_revenue_mismatch from sales s where s.id in (
    'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
    '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
    '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
    'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
    '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
    '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
  ) and s.revenue is distinct from (select coalesce(sum(si.line_revenue),0) from sale_items si where si.sale_id = s.id);
  if v_revenue_mismatch > 0 then
    raise exception 'Aborting: % sale(s) do not reconcile revenue = sum(sale_items.line_revenue)', v_revenue_mismatch;
  end if;
end $$;

commit;
