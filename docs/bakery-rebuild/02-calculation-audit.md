# 02 — Calculation Audit

This document traces every place cost, price, yield, revenue, profit, margin, or inventory usage is calculated, and compares them against each other. File:line references are given so each claim can be checked directly.

## 0. The short version

**Update (2026-08-17): the live Supabase database was inspected directly and this section has been corrected accordingly.** The canonical cost source — the `recipe_costs` Postgres view — turns out to be well-built: it correctly walks sub-recipes recursively and correctly converts mass, volume, and count units. The client-side Inventory tab still duplicates this logic worse (ignores sub-recipes, mass-only conversion), but that gap is now confirmed **confined to that one tab's display** — it does not reach Menu, Sales, or Analytics. The genuinely serious, confirmed-in-production calculation problem is narrower and worse than it first appeared: the **Mix & Match revenue/profit gap (§5) is now empirically confirmed against real data — it currently affects 18 of the bakery's 34 completed sales (53%) and has removed €335.00 of revenue from the profit/margin figures shown on Sales and Analytics.** Three different currency-formatting conventions are still used across pages that all describe the same bakery's money, and the owner has now confirmed the intended rule (§4, §11). See `01-architecture-and-data-flow.md` §8 for the verification method.

## 1. Unit conversion — three incompatible client-side implementations, plus the (correct) database view

| Location | Mass (g/kg/lb/oz) | Volume (mL/L/tsp/tbsp/cup) | Count (each/item/piece) | Behavior when unsupported |
|---|---|---|---|---|
| `js/admin-inventory.js:1473-1495` `convertUnit()` | ✅ | ❌ | ❌ | returns `null` → caller treats cost as **0** |
| `js/admin-production.js:838` `convert()` | ✅ | ✅ | ✅ | returns `null` → caller surfaces a warning banner and blocks "Finish Production" |
| `js/admin-sales.js` (`calculateSaleCost`, unused — see §7) | inline division | N/A — **no conversion at all**, assumes purchase unit already equals recipe unit | | silently wrong if units differ |
| **`recipe_costs` (Postgres view — verified 2026-08-17)** | ✅ | ✅ | ✅ | Falls back to `NULL` (excluded from the sum) rather than silently costing as 0 for an unmapped unit pair |

**Database verification confirmed the view is the most complete of the four** — it independently implements the same three unit families as `admin-production.js`'s `convert()`, and it's the one actually used to price every sale.

**Live-data impact, confirmed by querying the real `ingredients` table:** every ingredient in production today uses `recipe_unit`/`purchase_unit` of only `g`, `kg`, `lb`, `oz`, or `each` — nothing uses mL, L, tsp, tbsp, or cups. Of the 11 ingredients whose purchase unit differs from its recipe unit, all 11 are mass-to-mass (`lb`→`g`, `oz`→`g`); every `each`-unit ingredient (eggs, bags, boxes, stickers, etc.) is purchased and used in the same unit, so it hits the trivial "already matching" branch in every implementation rather than exercising any lookup table. **Net effect: `admin-inventory.js`'s missing volume/count support is a real, latent gap in the code, but it is not currently corrupting any number, because the bakery's current ingredient list never triggers it.** It should still be fixed (the moment an ingredient like vanilla extract is purchased in fl oz and measured in tsp, or a liquid ingredient purchased in mass but measured by volume, this tab will silently show $0), but it is not urgent the way the Mix & Match gap (§5) is.

## 2. Recipe cost — the database view is correct; only the Inventory tab's display is wrong

| Location | Includes `recipe_ingredients`? | Includes `recipe_components` (sub-recipes)? | Divides by yield? | Result represents |
|---|---|---|---|---|
| `js/admin-inventory.js:1446-1452` `getRecipeCost(recipe)` | ✅ | ❌ **No** — sub-recipes are silently ignored | ❌ **No** | Total **batch** cost (not per-item) |
| `js/admin-production.js:416-584` `collectRecipeRequirements()` (recursive) | ✅ | ✅ Yes, recursively, with circular-reference detection | Effectively yes, via `multiplier` scaling per order | Ingredient **requirements** for a specific set of orders, priced via `calculateRequirementCost()` (`js/admin-production.js:624-659`) |
| `recipe_costs.cost_per_yield_item` (Postgres view — **verified 2026-08-17**) | ✅ | ✅ **Yes** — a recursive CTE expands `recipe_components` to arbitrary depth, with cycle protection (`WHERE NOT component_recipe.id = ANY(recipe_path)`), and converts mass/volume/count units at every level | ✅ Yes — `total_ingredient_cost / yield_quantity` | The canonical "cost of one yield unit of this recipe," consumed by `admin-menu.js` and `admin-orders.js` (sale creation) |

**This resolves the open question from the first pass of this audit.** `recipe_costs` correctly includes sub-recipes, so **Menu, sale creation, Sales, and Analytics all use the correct, complete recipe cost** — this defect never reached them.

**What's still wrong, quantified against real data:** the four recipes in the database that use a sub-recipe component (Cinnamon Rolls, Blueberry Rolls, Strawberry Rolls, and Nutella Rolls, each of which folds in a shared "Cream Cheese Frosting" recipe) show the following gap between the correct database figure and what the Inventory tab's `getRecipeCost()` would display for the same recipe:

| Recipe | `recipe_costs.ingredient_cost` (correct, includes frosting) | Inventory tab's `getRecipeCost()` (direct ingredients only) | Understated by |
|---|---|---|---|
| Cinnamon Rolls | $7.70 | $4.26 | 45% |
| Blueberry Rolls | $7.26 | $3.82 | 47% |
| Strawberry Rolls | $5.41 | $3.69 | 32% |
| Nutella Rolls | $5.83 | $4.11 | 29% |

So the "Estimated ingredient cost" shown on `admin/inventory.html`'s Recipes tab (`js/admin-inventory.js:856`) is confirmed wrong today, by 29–47%, for every recipe that uses a shared component — but this is a **display-only bug confined to that one tab**. It does not affect pricing, sale creation, or anything on Sales/Analytics.

## 3. Packaging cost — confirmed NOT a live bug; a code-style inconsistency only

Three places read `packaging_profile_costs`, keyed three different ways:

| File | Map construction | Lookup |
|---|---|---|
| `js/admin-menu.js:108-113, 1694-1701` | `new Map(data.map(p => [p.id, p]))` | `packagingCosts.get(Number(profileId))` |
| `js/admin-production.js:115-121` | `new Map(data.map(cost => [String(cost.id), cost]))` | looked up via `String(...)` |
| `js/admin-orders.js:775-781` | `new Map(data.map(p => [p.id, p]))` | looked up via raw `menuItem?.packaging_profile_id` (no cast) |

**Verified 2026-08-17: `packaging_profiles.id` and `packaging_profile_costs.id` are `bigint`, not UUIDs** (confirmed via `list_tables`, and via real row data — the five packaging profiles have IDs `2, 3, 4, 5, 6`, all well within JavaScript's safe-integer range). This overturns the original hypothesis: because these IDs are small integers, PostgREST serializes them as ordinary JSON numbers, `Number(2)` is a no-op, and `admin-menu.js`'s cast does not break the lookup. Directly confirmed by querying `packaging_profile_costs` and cross-referencing `menu_items.packaging_profile_id` for the same rows — every profile resolves to a real, non-zero `packaging_cost` (e.g. profile 2 "Bread Loaf" → $0.34, profile 5 "12 Pack" → $1.79).

**What remains true and worth fixing:** this is still three different, inconsistent conventions for casting the same kind of ID across three files, which is exactly the sort of thing that becomes a real bug the day someone changes a primary key type (e.g. if `packaging_profiles` were ever migrated to UUIDs, as most of the rest of the schema already is). Downgraded from a correctness bug to a consistency/robustness cleanup — see `03-bug-register.md` BUG-03 for the corrected severity.

## 4. Currency — three different conventions describing the same money

| Page/file | Formatting used |
|---|---|
| `admin-inventory.js` `usd()` | `Intl.NumberFormat("en-US", {currency:"USD"})` — **US Dollar** |
| `packaging.js` `usdPackaging()` | Same — **US Dollar** |
| `admin-menu.js` menu item cards | Literal `$` for recipe/packaging/total cost, literal `€` for price and profit **on the same card** (`js/admin-menu.js:288-352`) |
| `admin-production.js` `euro()` | `Intl.NumberFormat("de-DE", {currency:"EUR"})` — **Euro** |
| `admin-sales.js` / `admin-analytics.js` `euro()` | Same Euro formatter, duplicated verbatim in both files |
| `admin-dashboard.html`, `admin-orders.js`, public `cart.js`/`menu.js` | Literal `€` throughout |

The public-facing checkout, the dashboard KPIs, the orders queue, and the production/sales/analytics pages are all consistently **Euro**. **Inventory and Packaging are the outliers, formatted in USD**, and **Menu mixes both symbols on a single card**.

**Owner confirmed (2026-08-17), and this is more nuanced than "pick one currency" — three separate, correct rules apply to three different parts of the app:**
1. **Customers always see and pay in EUR** — this is a European bakery; the public site, cart, checkout, and `orders.subtotal` should stay EUR. No change needed here; this is already how it works.
2. **Inventory and Packaging being in USD is not a bug — it's currently mislabeled, not miscalculated.** The owner buys ingredients from both American suppliers (USD) and German suppliers (EUR), so individual ingredient purchase prices are genuinely in two different currencies today, and neither `ingredients` nor `purchases` has a currency column to say which is which (see §9, BUG-19). The immediate, correct fix is **not** "make Inventory show EUR" — it's adding a per-ingredient (or per-purchase) currency field so each ingredient's real purchase currency is recorded and displayed accurately, rather than the page defaulting to a blanket `usd()` formatter that's right for some ingredients and silently wrong for others.
3. **Sales and Analytics should report in USD** — confirmed as the owner's own internal reporting currency, independent of what customers are charged. This means `admin-sales.js`/`admin-analytics.js`'s existing `euro()` formatter is actually the wrong one to standardize on — **the fix is the reverse of what the first pass of this audit assumed.** See §11 for the exchange-rate mechanics this requires, since a straight relabel to `$` would be wrong — the underlying EUR revenue amounts need to be converted, not just redisplayed.

## 5. The Mix & Match ("builder") revenue/profit gap — highest-confidence finding

Traced end to end:

1. **Cart** (`js/cart.js:304-320, 993-1019`): a Mix & Match box is added to the cart as one line with its own `price`, plus a `builder_details.selections[]` array describing what was chosen. On checkout, `order_items` gets one row per box with `menu_item_id: null`, `price_at_purchase` = the box price, `line_total` = box price × quantity, and `builder_details` = the JSON breakdown. **`orders.subtotal` correctly includes the box's price.**
2. **Sale creation** (`js/admin-orders.js:648-958`, runs when an order is marked "completed"):
   - The `sales` row is first inserted with `revenue = orders.subtotal` (line 701) — **this is correct and includes the box price.**
   - Then, for each order item with `builder_details`, the code loops over `item.builder_details.selections` and inserts one `sale_items` row **per individual selection** — but every one of these rows is hard-coded with `unit_price: 0` and `line_revenue: 0` (`js/admin-orders.js:879, 887`). **The box's own line is never inserted into `sale_items` at all** — only its contents, each priced at zero.
   - The function then recomputes `foodCost`, `packagingCost` (both correct — they do include the builder items' real ingredient/packaging cost), and a **local** `revenue` variable as `saleItems.reduce(sum + item.line_revenue)` (line 927-930) — which, because every builder selection contributes `0`, **excludes the box's price entirely**.
   - `profit = revenue - totalCost` is computed from that undercounted `revenue` and written back to `sales.profit` (line 932-945).
   - **Critically, `sales.revenue` is never updated in this second step** — it keeps the correct value from step 1.
3. **Result:** for any completed order containing at least one Mix & Match box, the `sales` row ends up with `revenue` = correct (includes the box price) but `profit` = wrong (computed as if the box had €0 revenue, while its real ingredient/packaging cost is fully subtracted). **Profit and margin are understated by roughly the box's selling price**, for that order, everywhere `sales.profit` is read: `admin-sales.js`'s Gross Profit KPI, Profit Breakdown, and per-sale-card profit; `admin-analytics.js`'s Gross Margin, Profit Insights, Top Customers' profit, and Product Breakdown (where the box's own row doesn't exist at all, and its ingredients show €0 revenue with real cost, i.e. **negative profit** for products that were never actually sold at a loss).

This is a single root cause with a wide, mechanically traceable blast radius across Sales and Analytics — exactly the kind of "inventory/recipe cost not reaching sales/analytics correctly" issue the owner asked to have documented.

### Empirical confirmation against the live database (2026-08-17)

A read-only, non-PII aggregate query (selecting only sale IDs, revenue/cost/profit figures, and a `builder_details is not null` flag joined through `orders`/`order_items` — no customer name/email/phone was retrieved) was run directly against Supabase to check every one of the bakery's actual completed sales:

- **34 total completed sales**, of which **18 (53%) contain at least one Mix & Match item.**
- **All 18 of those 18** show `sum(sale_items.line_revenue) < sales.revenue` — a 100% hit rate, exactly as the code trace predicts.
- **Every one of the other 16 (non-builder) sales shows `sum(sale_items.line_revenue) = sales.revenue` exactly** — confirming standard-product sales are computed correctly and consistently.
- **€335.00 of real revenue is currently excluded from the profit/margin calculation** across those 18 sales, combined. Several individual sales currently display a *negative* profit in the database (e.g. one sale with €15.00 of real revenue and €5.17 of real cost shows `profit: -5.17`, because its entire revenue came from a builder box that contributed €0 to the profit calculation) — meaning Sales and Analytics have likely already shown the owner orders that looked like money-losers when they were not.

This moves BUG-01 from "confirmed by code tracing" to "confirmed by code tracing **and** directly measured against every affected row in production." See `03-bug-register.md` BUG-01 for the updated severity/confidence and the confirmed fix design below.

### Confirmed fix design (owner decision, 2026-08-17)

> Record the box as the parent sale line containing all revenue. Record its selected products as child components that contribute costs and quantities — but don't count their revenue again.

Concretely, this means `createSaleFromOrder()` in `admin-orders.js` should insert **one additional `sale_items` row per builder order line** — using the builder's own `menu_items` row (its `id`, `name`, the packaging cost of its own `packaging_profile_id`) — carrying the **real** `unit_price`/`line_revenue` (from `item.price_at_purchase`/`item.line_total`) and `food_cost: 0` (the builder product itself has no recipe; its food cost lives entirely in its child selections, which is already computed correctly today). The existing per-selection child rows stay exactly as they are now — cost and quantity only, `unit_price`/`line_revenue` at 0 — so nothing double-counts. Once the parent row exists, the existing `revenue = saleItems.reduce(sum + item.line_revenue)` calculation (`js/admin-orders.js:927-930`) will naturally include the box's price without any other change, and `sales.revenue` and `sales.profit` will agree again. This is a source-code change and is not made in this audit-only pass — flagged here as the specific, owner-approved design for Phase 1.

## 6. `orders.subtotal` vs `sales.revenue`/`sale_items.line_total` — same word, different meanings

- On `orders`, `subtotal` is a real stored column, set once at checkout as the literal sum of cart line totals (`cart.js:976`). Production planning (`admin-production.js:135`) also sums `order.subtotal` directly as "revenue" for a given bake date.
- On `sales`, there is **no `subtotal` column at all**. `admin-sales.js:136` manufactures one at load time as an alias: `subtotal: Number(sale.revenue) || 0`. Every KPI on the Sales page (Today/Week/Month/Year revenue, Average Order, Revenue Trend chart, Category Revenue, Monthly Revenue, CSV export) reads `order.subtotal` — which, after the mapping, is really just `sales.revenue` under a different name.
- **This is confusing but not itself incorrect** *if* `sales.revenue` is correct — which, per §5, it is only for orders without a builder product. The real risk is that a future edit to either page could reasonably assume `subtotal` means the same thing it means on `orders` (i.e., independently derived from line items) and "fix" one without touching the other, since the two `subtotal`s are computed by completely different code paths that happen to agree except in the builder case.

## 7. Duplicated/dead cost logic that should not survive a rebuild as-is

- `js/admin-sales.js:167-247` `calculateSaleCost(item)` — fully written, **never called**. Recomputes ingredient cost as `purchase_price / purchase_size` with **no unit conversion at all** (see §1), and it duplicates the packaging-cost loop too. It is not wired into the profit numbers actually shown on the page (those come straight from the stored `sales` columns). Dead code, and if ever revived as-is it would silently misprice any ingredient whose purchase unit differs from its recipe unit.
- Two leftover `console.log` debug statements ship in production code paths: `js/admin-sales.js:148-154` (dumps every sale's customer/revenue/date on every load) and `js/admin-sales.js:737` (`console.log("PROFIT INPUT:", orders)`, fires every time the profit breakdown re-renders).
- The ballot manager (unrelated to cost, but worth noting once here) is implemented **twice** at near-line-for-line parity: once (dead) in `js/admin.js`, once (live) in `js/admin-menu.js`. Same for the pending-reviews approve/delete flow: once in `js/admin-dashboard.js` (lines 242-328) and again, nearly verbatim, in `js/admin-reviews.js`.

## 8. Editing an order with a builder product silently strips it

`js/admin-orders.js`'s manual order editor (`editOrder`, `renderManualMenuItem`, `saveManualOrder`) has **no concept of builder products at all** — it only supports flat menu items at a fixed quantity. If an admin opens **Edit** on an order that was placed through the public site with a Mix & Match box in it:
- `editOrder` (line 1578-1592) reconstructs `manualOrderItems` from `order.order_items`, keyed by `menu_item_id` — but a builder line's `menu_item_id` is `null` (per §5, step 1), so that line is silently dropped from the edit form entirely.
- Saving the edit deletes and re-inserts `order_items` (lines 1353-1380) with no `builder_details` field ever written.
- The box, and everything the customer chose inside it, is gone from the order. If that order is later marked "completed," production planning will never see those ingredient/packaging requirements (they were never in `order_items` to begin with), and the sale will simply have less revenue and no trace it ever existed.

## 9. Rounding, missing values, and other smaller findings

- `admin-inventory.js` `formatQuantity()` (`js/admin-inventory.js:1545-1550`) strips trailing zeros in a way that can also strip a **significant trailing zero** (e.g. `2.50` → the regex `/0$/` removes the final `0` after the `.00$` pass already ran, so results like `1.20` become `1.2`, which is fine, but the two-pass regex approach is fragile and not obviously equivalent to a proper rounding/display function — flagged for cleanup, not a hard bug).
- `getIngredientCost`/`calculateRequirementCost`/`calculatePackagingItemCost` all divide by `purchase_size`; none of them guard against a `purchase_size` of exactly `0` consistently — `admin-inventory.js` and `admin-production.js` both check for it (`purchaseSizeInRecipeUnits <= 0`), but `packaging.js`'s `calculatePackagingItemCost` (`js/packaging.js:449-473`) checks `purchaseSize <= 0` too, so this one is actually consistent — noted only because it's the kind of check that's easy to lose in a rewrite.
- Every currency amount is carried as a raw JS `Number` (floating point) end-to-end — no fixed-point/integer-cents handling anywhere. For a small bakery's dollar amounts this is unlikely to cause visible drift today, but it's worth deciding deliberately in the rebuild rather than continuing by accident.
- **Discounts, taxes, fees, refunds, waste, and partial-batch adjustments are not represented anywhere in the schema or code.** `orders.subtotal` is simply the sum of line items; there is no tax/discount field on `orders`, `order_items`, `sales`, or `sale_items` in any query in this repo. If discounts/taxes exist as a business practice today, they are currently handled manually/outside the system.
- **Reporting dates/time zones:** all date grouping (`admin-sales.js` `isSameDay`/`isThisWeek`/`isSameMonth`, `admin-analytics.js` range filters) uses the **browser's local time zone** via native `Date`, and dates are read from `completed_at` (a timestamp) for sales/analytics but from `pickup_date`/`event_date` (a date, no time) for production. There is no explicit timezone handling anywhere — this is only a problem if the owner ever manages the bakery from a different time zone than the one the data was entered in, but it means "today's revenue" is defined by whatever device is viewing the page, not a fixed bakery-local day boundary.
- **Historical price/cost preservation:** this part of the design is actually sound where it isn't undermined by §5 — `sale_items.unit_price`/`food_cost`/`packaging_cost` are snapshotted at completion time from whatever `recipe_costs`/`packaging_profile_costs`/`price_at_purchase` were *at that moment*, so a later recipe or price change should not retroactively change a historical sale's numbers. This matches good practice and should be preserved in any rebuild.

## 9.5. Renamed/deleted ingredients & recipes

- Deleting an ingredient (`admin-inventory.js` `deleteIngredient`) issues a hard `DELETE` with no check for whether any `recipe_ingredients` or `packaging_profile_items` row still references it. If the database doesn't enforce a foreign key (unknown — cannot verify from this repo), any recipe using that ingredient would silently lose that line the next time it's costed; if a FK **is** enforced, the delete would instead fail with a raw Postgres error surfaced via `alert(error.message)` — not a friendly message. Either way, there is no "this ingredient is used in N recipes" warning before deleting.
- Deleting a recipe (`deleteRecipe`) has the same gap against `menu_items.recipe_id` and `recipe_components.component_recipe_id`.
- Renaming an ingredient or recipe is safe for cost math (everything is joined by ID, not name) but `sale_items.item_name`/`order_items.item_name` are copied at the time of the order, so historical order/sale displays correctly keep the old name — this is good, intentional behavior.

## 10. Summary table — resolved vs. still open (updated 2026-08-17)

| # | Item | Where | Status |
|---|---|---|---|
| 1 | Recipe cost ignores sub-recipes on the Inventory tab but not in `recipe_costs` | §2 | **Resolved.** DB-verified: `recipe_costs` is correct; only the Inventory tab's own display is wrong (29–47% understated for recipes with components), and it doesn't reach Menu/Sales/Analytics. |
| 2 | Packaging cost lookup casts to `Number()` in Menu but not elsewhere | §3 | **Resolved — not a live bug.** DB-verified `packaging_profiles.id` is `bigint`, not UUID; the cast is a harmless no-op. Still worth standardizing for consistency. |
| 3 | Site-wide currency should be EUR or USD | §4, §11 | **Resolved by owner.** Three-way rule confirmed: customers always EUR; Inventory/Packaging need a *currency field* (purchases are genuinely mixed USD/EUR), not a blanket relabel; Sales/Analytics should report in USD, converted from the underlying EUR amounts. |
| 4 | Builder-box revenue/profit gap | §5 | **Confirmed empirically** (18/34 sales, €335 missing revenue) and **fix design confirmed by owner**: parent line carries all revenue, child lines carry cost/quantity only. |
| 5 | Whether discounts/taxes/refunds/waste should exist at all | §9 | **Resolved by owner: none exist, none are wanted in this phase.** Confirmed absent from the schema too — no code or database change needed here. |

New items opened by database verification (not visible from source code alone) are in §12 below and in `03-bug-register.md` BUG-16 through BUG-20.

## 11. Currency conversion design — evaluation of the owner's proposed approach

The owner proposed:
> Preserve the original customer total in EUR. Capture the EUR-to-USD exchange rate when the sale is completed. Preserve the resulting USD reporting value. Never recalculate historical sales using today's exchange rate.

**This is the correct design**, and it's consistent with the one thing this codebase already does well: `sale_items` already freezes `unit_price`/`food_cost`/`packaging_cost` at completion time so a later recipe or price change can't retroactively alter a historical sale (see §9 of the original audit, confirmed still true — the database has no trigger that would ever re-touch a `sales`/`sale_items` row after insert). Adding a frozen exchange rate is the same pattern applied to currency, not a new one.

**What's needed to build it (schema-only sketch, not implemented in this audit-only pass):**
- `sales` needs new columns: an `exchange_rate` (EUR→USD, numeric, captured once at the moment `createSaleFromOrder()` runs) and either (a) stored `revenue_usd`/`total_cost_usd`/`profit_usd` columns computed and written at that same moment, or (b) just the rate, with USD values computed on read as `revenue * exchange_rate`. **(a) is recommended** — it means Sales/Analytics never need to know the conversion happened, they just read a USD column directly, and it protects against the conversion formula ever changing out from under historical data (the same reasoning that makes freezing `sale_items.food_cost` correct instead of recomputing it from current ingredient prices).
- The exchange rate itself needs a source. Nothing in this codebase currently fetches one (no exchange-rate API call exists anywhere in the repo). This has to be a deliberate decision: a manually-entered rate the owner updates periodically, or an automated fetch at sale-completion time. Not something this audit can decide — flagged as an open question below.
- `orders`/`order_items` do **not** need any currency change — they should stay EUR-only, since the customer-facing side of the business is correctly, entirely EUR today and the owner confirmed that's correct.

## 12. Remaining uncertainty after database verification

- **The exchange-rate source is not yet decided.** Manual entry vs. an automated FX API are both reasonable; this is a product decision, not something inferable from the existing code (there is no precedent for it anywhere in this repo).
- **Whether "today's rate" should ever be used for *unconfirmed/in-progress* orders** (i.e., is there a live USD-equivalent shown anywhere before a sale completes?) wasn't specified by the owner and isn't implied by the current code — flagged as a question for Phase 1 scoping, not answered here.
- Everything else opened by this pass of the audit is either fully resolved above or listed as a database/security finding in `01-architecture-and-data-flow.md` §9 and `03-bug-register.md`.
