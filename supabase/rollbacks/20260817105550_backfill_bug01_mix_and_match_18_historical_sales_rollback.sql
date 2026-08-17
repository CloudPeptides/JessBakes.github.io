-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260817105550_backfill_bug01_mix_and_match_18_historical_sales.sql
--
-- NOT applied. Kept in the repository as an exact, ready-to-run reversal
-- in case the Phase 1B historical backfill ever needs to be undone.
--
-- This does not use a backup table. It reverses each of the three writes
-- made by the forward migration using values captured immediately before
-- that migration ran:
--   1) Deletes the 19 parent sale_items rows the forward migration inserted
--      (explicit literal IDs, identical to the ones it generated).
--   2) Resets the 28 pre-existing child sale_items rows' line_profit back
--      to 0.00, their value before the forward migration corrected them.
--   3) Resets each of the 18 sales' profit back to its original stored
--      value (captured before the forward migration ran).
--
-- A safety assertion aborts the whole rollback unless the resulting sum of
-- profit across the 18 sales is exactly -16.17 (the original, pre-backfill
-- total), matching the +335.00 swing verified by the forward migration and
-- by docs/bakery-rebuild/09-bug01-regression-report.md.
--
-- Scope: only the 18 explicit sale IDs and their own sale_items rows.
-- Never touches orders, order_items, inventory, recipes, production,
-- customer data, or any other sale.
-- ============================================================
begin;

-- 1) Remove the 19 parent rows inserted by the forward migration.
delete from sale_items
where id in (
  '67216428-3fb9-49ed-9b70-3ca95e97095a','015d4d9a-4d09-4ba3-bf03-d27683a22c6b','2dba4d44-766f-4118-bfe3-a6100fef5c05',
  '2d2b1360-4fa4-4a71-9a59-4c9f831037ca','4fc6a94a-c277-49be-b776-098af6b6e0a6','3acadec3-bf3d-4fe1-9c21-add4185677d3',
  'b3c1f6ec-ca4e-4d33-8af3-2464e5a98363','a2051190-e48f-4255-897e-203aee37927a','80077153-33b6-43fb-8812-055a6986ddee',
  'd62c872c-207f-4895-abcb-9d2a3f672f88','4790b2df-aeae-4969-8133-703c51771a96','fee8bb65-b69e-4489-a7db-c3489698c9bc',
  '0abe7dba-05d1-4b42-a4c7-8da6c680000d','998858ea-7e65-484c-adbf-18545ced5ec8','553a5bb8-3d0a-4286-8232-75abbd3bafe5',
  '48ba5ae2-6501-4e01-beb9-bf54c55f4dcf','3ebc607e-2575-4d4b-a2c6-4f67f53078e8','b89537fc-6319-4d12-85e6-8442a4fc4235',
  '40a9756d-0967-44d7-aa58-c9189379d5e7'
);

-- 2) Reset the 28 pre-existing child rows' line_profit to their original
--    value (0.00) before the forward migration corrected them.
update sale_items
set line_profit = 0.00
where id in (
  '2c61d09c-a462-4bd3-94bf-2b850e19ee30','b21e7b3a-3d5e-4107-a612-ad49f7e384ee','d1c8ef92-60f3-4c5f-a3f9-1f293e29726b',
  '5fe6e8b4-507d-4463-9e2b-01fefd77d5b6','8b15e9ed-6590-4a48-99ae-81211ec38477','ab15d75c-3be8-45aa-bf91-dc9f54efadd4',
  'da93f2d6-96b3-41d1-9695-6cc7f96eae6e','21d380fd-6c9a-4618-970b-d40a5dd9c1f4','fafea1df-f6ee-4853-9cc0-ee609dd1c983',
  '9990bce1-25c9-4c3e-a7ed-63ebc15924d1','dedfea0c-1cc1-46f9-9fcb-6a764f002573','088f4198-29f3-419b-8eab-1ec6d357ef60',
  'ed365507-c527-45bb-94cc-a3dbb3d9b942','1ba0ba50-4133-49fb-b65b-72be4d33757f','2b667188-67c1-4860-873e-4e706baa7309',
  '1622ddfe-c88b-4a2c-bfbc-239189f8e70c','bd82575d-65d2-43f5-ab7a-9a9815f104aa','c43396a9-bfad-46f7-8331-61f722ba1811',
  '5354b869-b6ee-4214-b0af-525ddbdcf2f8','8532870c-3d75-4e68-998a-906da18f63f0','f8ecee53-0086-4906-9d65-af24623305cb',
  '254a152f-7d6c-4e56-897c-de3dc3f54502','f14c4216-6ad9-412d-bf7e-0af2797c1d06','4c5c36c6-0ac3-4971-b0eb-f2fa281f0798',
  '5407e09a-33a2-4b60-baac-832fcf845b5c','7bd16462-91d2-4823-b756-5f3a4725ddc3','0bb951d6-92ec-4f0f-a2ac-3b8c65c02cf6',
  'f4dd83c5-c100-4704-bee7-54a44e6d11b0'
);

-- 3) Restore each sale's original profit (captured before the forward
--    migration ran).
update sales set profit = case id
  when 'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f' then -3.91
  when 'acc07673-c812-4937-9c34-481190dea042' then -3.90
  when '98e7a52b-4157-4593-a84e-2af6722e84bd' then -7.75
  when '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3' then -3.88
  when '244b48f8-4e50-4368-9661-d13306bb7c66' then 4.06
  when '9585be5e-e95f-4fbf-87c8-e596772347c2' then 0.19
  when '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9' then -3.88
  when '57bb97bc-96a6-4f60-ba65-dd2bba695ade' then 6.96
  when '378a22af-c033-4619-bf43-dd517cb9bb2c' then 8.76
  when 'ce484030-bb4c-419a-adeb-9565929de2f5' then -5.41
  when 'c28a5435-aef9-4109-a482-c806445097c9' then 4.04
  when 'deb53e6f-d3f0-48e1-b877-4f7aa67677be' then 0.14
  when '0c2be140-857f-46d8-99c1-eef63d440da3' then -23.44
  when 'bee8c664-625f-499d-9d59-e1b0b28657fc' then 10.56
  when 'c126d972-5103-4842-9d0a-b888a8e40320' then -6.83
  when '45158454-bb0b-4842-a552-affbd5663ff5' then 10.52
  when '50630b5a-e562-4689-b8cb-161132d6f29c' then -5.17
  when 'd06b4e30-3465-41f5-b66d-ab6d8739e6fa' then 2.77
end
where id in (
  'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
  '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
  '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
  'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
  '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
  '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
);

-- 4) Safety assertion: abort the whole rollback unless the 18 sales' total
--    profit is back to exactly its original, pre-backfill sum.
do $$
declare
  v_profit_sum numeric;
begin
  select sum(profit) into v_profit_sum from sales where id in (
    'b9ad6ec5-c7cf-4d35-8c89-0d3e006bd27f','acc07673-c812-4937-9c34-481190dea042','98e7a52b-4157-4593-a84e-2af6722e84bd',
    '5c15927a-f95e-4c6f-bf92-f5d19b5f7fc3','244b48f8-4e50-4368-9661-d13306bb7c66','9585be5e-e95f-4fbf-87c8-e596772347c2',
    '17b08886-4d2b-4e79-9b3d-8f97e6bd1fc9','57bb97bc-96a6-4f60-ba65-dd2bba695ade','378a22af-c033-4619-bf43-dd517cb9bb2c',
    'ce484030-bb4c-419a-adeb-9565929de2f5','c28a5435-aef9-4109-a482-c806445097c9','deb53e6f-d3f0-48e1-b877-4f7aa67677be',
    '0c2be140-857f-46d8-99c1-eef63d440da3','bee8c664-625f-499d-9d59-e1b0b28657fc','c126d972-5103-4842-9d0a-b888a8e40320',
    '45158454-bb0b-4842-a552-affbd5663ff5','50630b5a-e562-4689-b8cb-161132d6f29c','d06b4e30-3465-41f5-b66d-ab6d8739e6fa'
  );
  if v_profit_sum is distinct from -16.17 then
    raise exception 'Aborting rollback: profit sum for the 18 sales is %, expected exactly -16.17', v_profit_sum;
  end if;
end $$;

commit;
