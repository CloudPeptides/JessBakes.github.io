-- ============================================================
-- ALREADY APPLIED TO THE HOSTED SUPABASE PROJECT.
--
-- Applied directly via the Supabase MCP `apply_migration` tool on
-- 2026-08-17 (version `20260817130847`, matching
-- `supabase_migrations.schema_migrations` on the live project), NOT
-- deployed by running this file. Everything from the next "-- Phase 3:"
-- comment onward is byte-for-byte identical to the exact statement that
-- was submitted and applied (verified via MD5 checksum against
-- `supabase_migrations.schema_migrations.statements`).
--
-- Design (see docs/bakery-rebuild/02-calculation-audit.md and
-- 03-bug-register.md BUG-06/BUG-19 for full background):
--   * Customers always see/pay EUR. orders/order_items/the public site are
--     completely untouched by this migration.
--   * Ingredient/recipe/packaging costs are already USD-denominated (the
--     app's existing Inventory/Packaging convention) -- no conversion
--     needed for any *_cost column; only revenue (the EUR amount actually
--     paid) is converted.
--   * New, explicit, unambiguous columns only -- sales.revenue and
--     sale_items.line_revenue are never repurposed or converted in place.
--   * One rate snapshotted per sale (sales.exchange_rate), reused for
--     every one of that sale's sale_items rows -- never a per-line lookup.
--   * Rates are cached in a new exchange_rates table, sourced from
--     api.frankfurter.dev (ECB-derived, no API key) with a safe
--     administrator-entered manual fallback (source: 'manual') for when a
--     rate can't be retrieved live -- see js/currency-conversion.js.
--
-- Verified after applying: 34/34 sales backfilled, 0 missing rates; total
-- usd_revenue = 980.55, total usd_profit = 731.16 (independently
-- hand-verified beforehand and matched exactly by Postgres); every sale's
-- usd_revenue reconciles exactly against the sum of its own sale_items'
-- usd_line_revenue (0 mismatches, including the 10 real sales where
-- rounding each line independently would have disagreed with the sale
-- total by a cent -- resolved by assigning the rounding residual to the
-- line with the largest EUR line_revenue per sale, confirmed to never land
-- on a Mix & Match child: 0 zero-EUR-revenue lines ended up with a nonzero
-- USD revenue); orders/order_items/ingredients/recipes row counts
-- unchanged (35/60/48/17).
-- ============================================================

-- Phase 3: EUR customer-pricing vs. USD internal-reporting currency design.
-- Adds an exchange_rates cache table plus explicit, unambiguous USD columns
-- on sales/sale_items (never repurposing the existing EUR revenue/line_revenue
-- columns), then backfills the 34 existing historical sales using the EUR->USD
-- rate applicable to each completion date (ECB-derived via Frankfurter, no
-- API key -- see js/currency-conversion.js). Idempotent: additive-only
-- (new table, new nullable columns, ON CONFLICT DO NOTHING seed, and a
-- backfill UPDATE that deterministically recomputes from already-frozen
-- source columns, so re-applying produces identical results). Touches only
-- sales/sale_items/exchange_rates -- orders, order_items, inventory,
-- recipes, and customer data are untouched.
begin;

create table if not exists public.exchange_rates (
  rate_date date primary key,
  reference_date date not null,
  rate numeric not null check (rate > 0),
  source text not null check (source in ('ecb_frankfurter','manual')),
  fetched_at timestamptz not null default now()
);

alter table public.exchange_rates enable row level security;

drop policy if exists "Authenticated users can manage exchange rates" on public.exchange_rates;
create policy "Authenticated users can manage exchange rates"
  on public.exchange_rates
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.exchange_rates is 'Cached EUR->USD daily reference rates (ECB-derived via Frankfurter, no API key) plus safe administrator-entered manual fallbacks. rate_date is the date looked up FOR; reference_date is the actual ECB reference date used (earlier than rate_date on weekends/holidays).';

alter table public.sales
  add column if not exists exchange_rate numeric,
  add column if not exists exchange_rate_date date,
  add column if not exists exchange_rate_source text,
  add column if not exists usd_revenue numeric,
  add column if not exists usd_profit numeric;

comment on column public.sales.revenue is 'EUR -- the original amount the customer paid, frozen at completion. Never repurposed or converted in place; see usd_revenue for the USD-converted figure.';
comment on column public.sales.total_cost is 'USD -- ingredient/recipe/packaging costs are already USD-denominated; no conversion needed.';
comment on column public.sales.exchange_rate is 'EUR->USD rate snapshotted once at sale completion time from exchange_rates, and reused for every one of this sale''s sale_items rows. Frozen forever; never recalculated when rates later change.';
comment on column public.sales.usd_revenue is 'USD -- sales.revenue converted using the snapshotted exchange_rate.';
comment on column public.sales.usd_profit is 'USD -- usd_revenue - total_cost.';

alter table public.sale_items
  add column if not exists usd_line_revenue numeric,
  add column if not exists usd_line_profit numeric;

comment on column public.sale_items.line_revenue is 'EUR -- frozen customer-paid amount for this line. Never repurposed; see usd_line_revenue.';
comment on column public.sale_items.usd_line_revenue is 'USD -- line_revenue converted using the PARENT SALE''s snapshotted exchange_rate (sales.exchange_rate), never a separate per-line rate lookup.';
comment on column public.sale_items.usd_line_profit is 'USD -- usd_line_revenue - total_cost (already USD).';

-- Seed the 7 distinct completion dates actually needed by the 34 existing
-- sales, fetched from api.frankfurter.dev (base=EUR, symbols=USD) on
-- 2026-08-17. Weekend dates correctly returned the preceding business
-- day's reference rate (ECB's own convention, confirmed live).
insert into public.exchange_rates (rate_date, reference_date, rate, source)
values
  ('2026-07-12','2026-07-10',1.1430,'ecb_frankfurter'),
  ('2026-07-19','2026-07-17',1.1435,'ecb_frankfurter'),
  ('2026-07-26','2026-07-24',1.1377,'ecb_frankfurter'),
  ('2026-07-31','2026-07-31',1.1485,'ecb_frankfurter'),
  ('2026-08-02','2026-07-31',1.1485,'ecb_frankfurter'),
  ('2026-08-10','2026-08-10',1.1555,'ecb_frankfurter'),
  ('2026-08-16','2026-08-14',1.1567,'ecb_frankfurter')
on conflict (rate_date) do nothing;

-- Sale-level backfill: snapshot the rate and compute usd_revenue/usd_profit
-- from each sale's own already-frozen revenue/total_cost.
update public.sales s
set
  exchange_rate = er.rate,
  exchange_rate_date = er.rate_date,
  exchange_rate_source = er.source,
  usd_revenue = round(s.revenue * er.rate, 2),
  usd_profit = round(round(s.revenue * er.rate, 2) - s.total_cost, 2)
from public.exchange_rates er
where er.rate_date = date(s.completed_at);

-- Item-level backfill, using each row's PARENT sale's snapshotted rate.
-- Rounding every line independently can legitimately disagree with the
-- sale's own rounded total by a cent (confirmed against real data: 10 of
-- the 34 sales hit this). To guarantee sale-level and item-level figures
-- always reconcile exactly, any rounding residual is assigned to the line
-- with the largest EUR line_revenue per sale -- never a Mix & Match child
-- (always EUR line_revenue: 0, so it can never be "largest" while any line
-- has positive revenue, confirmed directly: 0 children received a nonzero
-- usd_line_revenue).
with naive as (
  select
    si.id,
    si.sale_id,
    si.line_revenue,
    si.total_cost,
    round(si.line_revenue * s.exchange_rate, 2) as naive_usd
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.exchange_rate is not null
),
sale_totals as (
  select sale_id, sum(naive_usd) as naive_sum
  from naive
  group by sale_id
),
residual_line as (
  select distinct on (n.sale_id)
    n.sale_id,
    n.id as residual_item_id
  from naive n
  order by n.sale_id, n.line_revenue desc, n.id asc
),
final as (
  select
    n.id,
    n.total_cost,
    n.naive_usd,
    (s.usd_revenue - st.naive_sum) as residual,
    (rl.residual_item_id = n.id) as gets_residual
  from naive n
  join sales s on s.id = n.sale_id
  join sale_totals st on st.sale_id = n.sale_id
  join residual_line rl on rl.sale_id = n.sale_id
)
update sale_items si
set
  usd_line_revenue = case when f.gets_residual then round(f.naive_usd + f.residual, 2) else f.naive_usd end,
  usd_line_profit = round((case when f.gets_residual then round(f.naive_usd + f.residual, 2) else f.naive_usd end) - f.total_cost, 2)
from final f
where f.id = si.id;

-- Safety assertion: abort the whole transaction unless every expected
-- condition holds exactly.
do $$
declare
  v_total_usd_revenue numeric;
  v_total_usd_profit numeric;
  v_null_sales int;
  v_null_items int;
  v_mismatches int;
  v_bad_children int;
begin
  select sum(usd_revenue), sum(usd_profit) into v_total_usd_revenue, v_total_usd_profit from sales;

  if v_total_usd_revenue is distinct from 980.55 then
    raise exception 'Aborting: total usd_revenue is %, expected exactly 980.55', v_total_usd_revenue;
  end if;

  if v_total_usd_profit is distinct from 731.16 then
    raise exception 'Aborting: total usd_profit is %, expected exactly 731.16', v_total_usd_profit;
  end if;

  select count(*) into v_null_sales from sales
  where usd_revenue is null or usd_profit is null or exchange_rate is null;
  if v_null_sales > 0 then
    raise exception 'Aborting: % sale(s) missing usd_revenue/usd_profit/exchange_rate', v_null_sales;
  end if;

  select count(*) into v_null_items from sale_items
  where usd_line_revenue is null or usd_line_profit is null;
  if v_null_items > 0 then
    raise exception 'Aborting: % sale_items row(s) missing usd_line_revenue/usd_line_profit', v_null_items;
  end if;

  select count(*) into v_mismatches from sales s
  where s.usd_revenue is distinct from (
    select coalesce(sum(si.usd_line_revenue), 0) from sale_items si where si.sale_id = s.id
  );
  if v_mismatches > 0 then
    raise exception 'Aborting: % sale(s) do not reconcile usd_revenue = sum(sale_items.usd_line_revenue)', v_mismatches;
  end if;

  select count(*) into v_bad_children from sale_items where line_revenue = 0 and usd_line_revenue <> 0;
  if v_bad_children > 0 then
    raise exception 'Aborting: % zero-EUR-revenue line(s) ended up with nonzero USD revenue', v_bad_children;
  end if;
end $$;

commit;
