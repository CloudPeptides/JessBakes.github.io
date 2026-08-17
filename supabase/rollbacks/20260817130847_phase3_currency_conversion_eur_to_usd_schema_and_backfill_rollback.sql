-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260817130847_phase3_currency_conversion_eur_to_usd_schema_and_backfill.sql
--
-- NOT applied. Every change made by the forward migration was strictly
-- additive (a new table, new nullable columns, column comments) -- nothing
-- pre-existing (sales.revenue/total_cost/profit, sale_items.line_revenue/
-- line_profit, or any other table) was ever modified in place. Reversing
-- it is therefore just dropping what was added -- no backup table, no
-- value restoration needed.
--
-- Idempotent: every statement uses IF EXISTS.
-- ============================================================
begin;

alter table public.sales
  drop column if exists exchange_rate,
  drop column if exists exchange_rate_date,
  drop column if exists exchange_rate_source,
  drop column if exists usd_revenue,
  drop column if exists usd_profit;

alter table public.sale_items
  drop column if exists usd_line_revenue,
  drop column if exists usd_line_profit;

drop table if exists public.exchange_rates;

commit;
