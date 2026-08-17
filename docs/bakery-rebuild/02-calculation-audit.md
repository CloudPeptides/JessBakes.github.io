# 02 — Calculation Audit

This document traces every place cost, price, yield, revenue, profit, margin, or inventory usage is calculated, and compares them against each other. File:line references are given so each claim can be checked directly.

## 0. The short version

**There is no single source of truth for "how much does one product cost to make."** At least **five separate implementations** of ingredient/recipe/packaging costing exist across the codebase, they use **different unit-conversion capabilities**, at least one of them **ignores sub-recipes entirely**, and the one page that shows both a live and a historical cost figure for the same order (`sales.html`) can show **numbers that don't reconcile with the underlying line items**, specifically for Mix & Match "builder" products. Three different currency-formatting conventions are used across pages that all describe the same bakery's money.

## 1. Unit conversion — three incompatible implementations

| File | Function | Mass (g/kg/lb/oz) | Volume (mL/L/tsp/tbsp/cup) | Count (each/item/piece) | Behavior when unsupported |
|---|---|---|---|---|---|
| `js/admin-inventory.js:1473-1495` | `convertUnit()` | ✅ | ❌ | ❌ | returns `null` → caller treats cost as **0** |
| `js/admin-production.js:838` | `convert()` | ✅ | ✅ | ✅ | returns `null` → caller surfaces a warning banner and blocks "Finish Production" |
| `js/admin-sales.js` (`calculateSaleCost`, unused — see below) | inline division | N/A — **no conversion at all**, assumes purchase unit already equals recipe unit | | | silently wrong if units differ |

**Impact:** the "Recipe Costing" tab on `admin/inventory.html` (`getRecipeCost` → `getIngredientCost` → `convertUnit`, `js/admin-inventory.js:1446-1471`) will silently show **$0.00 cost** for any ingredient whose recipe is measured in mL, L, tsp, tbsp, cups, or "each"/"item" — this is common for a bakery (e.g. vanilla extract in tsp, eggs in "each"). The production page's `convert()` handles all three unit families and would compute a real number for the same ingredient. **These two pages will disagree about the same recipe's cost whenever a non-mass unit is involved**, and Inventory's version fails silently (no warning), while Production's fails loudly (a warning banner + a block on finishing production).

## 2. Recipe cost — at least three implementations, only one recursive

| Location | Includes `recipe_ingredients`? | Includes `recipe_components` (sub-recipes)? | Divides by yield? | Result represents |
|---|---|---|---|---|
| `js/admin-inventory.js:1446-1452` `getRecipeCost(recipe)` | ✅ | ❌ **No** — sub-recipes are silently ignored | ❌ **No** | Total **batch** cost (not per-item) |
| `js/admin-production.js:416-584` `collectRecipeRequirements()` (recursive) | ✅ | ✅ Yes, recursively, with circular-reference detection | Effectively yes, via `multiplier` scaling per order | Ingredient **requirements** for a specific set of orders, priced via `calculateRequirementCost()` (`js/admin-production.js:624-659`) |
| `recipe_costs` (Postgres view, referenced but never defined in this repo) `.cost_per_yield_item` | **Unknown — cannot verify from the codebase** | **Unknown** | Presumably yes, given the field name | Used as the canonical "cost of one yield unit of this recipe" by `admin-menu.js` and `admin-orders.js` |

**Consequence:** the number labeled "Estimated ingredient cost" per recipe on `admin/inventory.html`'s Recipes tab (`js/admin-inventory.js:856`) is:
- a **batch total**, not a per-item cost (so it's not directly comparable to a menu item's price), and
- **wrong for any recipe that uses a sub-recipe/component** (e.g. a filling, a base dough used in two products) — it simply omits that portion of the cost.

Meanwhile, the number actually used to price a sale (`recipe_costs.cost_per_yield_item`, consumed in `admin-menu.js:1686-1692` and `admin-orders.js:794-802`) lives entirely in Supabase and its formula cannot be confirmed from this repository. **Open question for the owner:** does the `recipe_costs` view account for `recipe_components` (sub-recipes)? If not, every product built from a sub-recipe is under-costed everywhere (menu cards, sale snapshots, and thus sales/analytics), not just in the Inventory tab.

## 3. Packaging cost — an ID type mismatch that plausibly zeroes out every menu card

Three places read `packaging_profile_costs`, keyed three different ways:

| File | Map construction | Lookup |
|---|---|---|
| `js/admin-menu.js:108-113, 1694-1701` | `new Map(data.map(p => [p.id, p]))` | `packagingCosts.get(Number(profileId))` |
| `js/admin-production.js:115-121` | `new Map(data.map(cost => [String(cost.id), cost]))` | looked up via `String(...)` |
| `js/admin-orders.js:775-781` | `new Map(data.map(p => [p.id, p]))` | looked up via raw `menuItem?.packaging_profile_id` (no cast) |

`admin-menu.js` is the odd one out: it explicitly casts the lookup key to `Number(...)`, while every other ID in the same file (`recipe_id`, `ingredient.id`, etc.) is compared as a string. If `packaging_profiles.id` / `packaging_profile_costs.id` is a UUID (which is consistent with how every other primary key in this schema is handled — `String(item.id)` comparisons are used throughout `admin-inventory.js`, `admin-production.js`, and elsewhere), then `Number("a1b2c3d4-...")` evaluates to `NaN`, and `Map.get(NaN)` never matches. **If that's the case, `getPackagingCost()` in `admin-menu.js` (line 1694) always returns 0**, meaning the "Packaging" cost box shown on every card in Menu Manager (`js/admin-menu.js:316-327`) is silently wrong for every product, every time. This does **not** affect the sale snapshot in `admin-orders.js` (which uses the raw, unconverted key) or production planning (which uses `String(...)`) — so this would be a case where the Menu page specifically under-reports cost/over-reports profit compared to every other page. **This needs to be confirmed against the actual Supabase column type** — flagged rather than assumed, per audit instructions.

## 4. Currency — three different conventions describing the same money

| Page/file | Formatting used |
|---|---|
| `admin-inventory.js` `usd()` | `Intl.NumberFormat("en-US", {currency:"USD"})` — **US Dollar** |
| `packaging.js` `usdPackaging()` | Same — **US Dollar** |
| `admin-menu.js` menu item cards | Literal `$` for recipe/packaging/total cost, literal `€` for price and profit **on the same card** (`js/admin-menu.js:288-352`) |
| `admin-production.js` `euro()` | `Intl.NumberFormat("de-DE", {currency:"EUR"})` — **Euro** |
| `admin-sales.js` / `admin-analytics.js` `euro()` | Same Euro formatter, duplicated verbatim in both files |
| `admin-dashboard.html`, `admin-orders.js`, public `cart.js`/`menu.js` | Literal `€` throughout |

The public-facing checkout, the dashboard KPIs, the orders queue, and the production/sales/analytics pages are all consistently **Euro**. **Inventory and Packaging are the outliers, formatted in USD**, and **Menu mixes both symbols on a single card**. Given the domain (`jessbakessourdough.com`) and the overwhelming majority of the app, EUR appears to be the intended currency everywhere — this audit is not fixing it, but it should be confirmed with the owner and corrected consistently in one pass rather than page by page.

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

## 10. Summary table — what to ask the owner

| # | Conflict | Where | Needs owner decision because |
|---|---|---|---|
| 1 | Recipe cost ignores sub-recipes on the Inventory tab but (presumably) not in `recipe_costs` | §2 | Can't inspect the DB view's formula from this repo |
| 2 | Packaging cost lookup casts to `Number()` in Menu but not elsewhere | §3 | Can't inspect the actual column type of `packaging_profiles.id` from this repo |
| 3 | Site-wide currency should be EUR or USD | §4 | Business decision, not inferable from code alone |
| 4 | Builder-box revenue/profit gap | §5 | Confirms the bug, but the *correct* fix (insert a synthetic "box" `sale_items` row? attribute box revenue proportionally to selections? something else?) is a product decision |
| 5 | Whether discounts/taxes/refunds should exist at all | §9 | Not present today; needs to be a deliberate scope decision, not silently added during a "repair" pass |
