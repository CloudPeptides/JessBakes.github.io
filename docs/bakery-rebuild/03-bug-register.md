# 03 — Bug Register

Severity: **Critical** (wrong money shown to the owner), **High** (wrong data reaches a report or breaks a workflow), **Medium** (real defect, contained impact), **Low** (cosmetic/cleanup).
Confidence: **High** (directly traced in code), **Medium** (strongly implied, one unverifiable link — usually the Supabase-side `recipe_costs`/`packaging_profile_costs` views), **Needs verification** (depends on live schema/data this audit couldn't access).

---

### BUG-01 — Builder ("Mix & Match") sales show correct revenue but understated profit/margin
- **Affected pages:** Sales, Analytics (both read the `sales`/`sale_items` tables this bug corrupts)
- **Files/functions:** `js/admin-orders.js:648-958` `createSaleFromOrder()`
- **Current behavior:** When an order containing a Mix & Match box is completed, `sales.revenue` is set from `orders.subtotal` (correct, includes the box price), but every `sale_items` row generated for the box's contents is hard-coded `unit_price: 0, line_revenue: 0`. `sales.profit` is then recomputed from the sum of `sale_items.line_revenue` (which excludes the box price) minus the box's real ingredient/packaging cost (which **is** included correctly). `sales.revenue` is never re-synced.
- **Expected behavior:** Revenue and profit should be computed from the same basis, and the box's price should appear somewhere in `sale_items` (or the profit calc should use `orders.subtotal`/`sales.revenue`, not the item-line sum).
- **Severity:** Critical — directly misstates gross profit/margin on the two pages whose entire purpose is showing the owner accurate profit.
- **Confidence:** High (fully traced from cart → order → sale → sales/analytics rendering).
- **Dependencies:** Needs a product decision on the correct fix (see `02-calculation-audit.md` §5/§10).
- **Recommended phase:** Phase 1 (core money-correctness fixes), after the owner confirms the intended behavior.

---

### BUG-02 — Editing an order containing a Mix & Match box silently deletes the box's contents
- **Affected pages:** Orders (edit flow); downstream effects on Production and Sales
- **Files/functions:** `js/admin-orders.js` `editOrder()` (1524-1597), `renderManualMenuItem()` (1114-1156), `saveManualOrder()` (1223-1394)
- **Current behavior:** The manual order editor has no builder-product support. Opening **Edit** on such an order drops the builder line (its `menu_item_id` is `null`, so it doesn't match anything in the flat item list); saving rewrites `order_items` without `builder_details`.
- **Expected behavior:** Editing an order should preserve every line, including builder selections, or the Edit action should be disabled/warn on orders it can't safely represent.
- **Severity:** High — silent, irreversible data loss on save; corrupts downstream production planning and sale revenue for that order.
- **Confidence:** High.
- **Dependencies:** None technical; needs UX decision on how builder editing should work in the admin UI (it doesn't exist there at all today, only on the public cart).
- **Recommended phase:** Phase 1–2.

---

### BUG-03 — Packaging cost may always compute to $0 on the Menu page
- **Affected pages:** Menu (Menu Manager cards' "Packaging" cost, "Total Cost", "Estimated Profit")
- **Files/functions:** `js/admin-menu.js:108-113, 1694-1701` `getPackagingCost()`
- **Current behavior:** `packagingCosts` map is built from `packaging_profile_costs` keyed by raw `id`, but looked up via `Number(profileId)`. Every other file in the codebase treats these IDs as strings (`String(...)`) when comparing.
- **Expected behavior:** Packaging cost lookups should use a consistent key type across all pages that read `packaging_profile_costs`.
- **Severity:** Critical if the ID is in fact a UUID (which the rest of the schema's conventions suggest) — would mean every product's displayed cost/profit on the Menu page has been wrong since this code shipped.
- **Confidence:** Medium (the mismatch in code is High-confidence; the real-world impact depends on the actual Postgres column type for `packaging_profiles.id`/`packaging_profile_costs.id`, which this audit cannot inspect).
- **Dependencies:** Confirm the column type in Supabase before touching this.
- **Recommended phase:** Phase 1 (quick to verify, quick to fix once confirmed).

---

### BUG-04 — Recipe cost on the Inventory tab silently ignores sub-recipe components
- **Affected pages:** Inventory (Recipes tab, "Recipe Costing" panel)
- **Files/functions:** `js/admin-inventory.js:1446-1452` `getRecipeCost(recipe)`
- **Current behavior:** Sums only `recipe.recipe_ingredients`; never looks at `recipe.recipe_components` (sub-recipes). `admin-production.js`'s `collectRecipeRequirements()` does walk components recursively and correctly.
- **Expected behavior:** Any recipe that uses another recipe as a component should have that cost included wherever "recipe cost" is displayed.
- **Severity:** High for any recipe that actually uses sub-recipes (undercounts real cost, which is what production and menu costing are supposed to protect against); no impact for recipes with no components.
- **Confidence:** High.
- **Dependencies:** Depends on whether `recipe_costs` (the DB view used elsewhere) already handles this correctly — if it does, Inventory is the only page that's wrong; if it doesn't, this understates cost everywhere.
- **Recommended phase:** Phase 1.

---

### BUG-05 — Ingredient/recipe unit conversion is incomplete on the Inventory tab
- **Affected pages:** Inventory (Recipes tab, "Recipe Costing" panel; also feeds the low-confidence recipe cost shown there)
- **Files/functions:** `js/admin-inventory.js:1473-1495` `convertUnit()`
- **Current behavior:** Only converts between mass units (g/kg/lb/oz). Volume (mL/L/tsp/tbsp/cup) or count ("each"/"item") conversions return `null`, and the caller (`getIngredientCost`) treats that as **$0 cost**, with no warning shown to the user. `admin-production.js`'s `convert()` handles mass, volume, and count, and surfaces a warning instead of silently zeroing.
- **Expected behavior:** One shared conversion utility, used everywhere, that either converts or clearly flags "can't convert" rather than silently returning 0.
- **Severity:** High — silently and invisibly undercounts recipe cost for any ingredient measured by volume or count (very common: eggs, vanilla extract, milk, oil).
- **Confidence:** High.
- **Dependencies:** None.
- **Recommended phase:** Phase 1.

---

### BUG-06 — Currency formatting is inconsistent across the admin dashboard
- **Affected pages:** Inventory, Packaging (USD), Menu (mixes `$` and `€` on the same card), vs. Dashboard, Orders, Production, Sales, Analytics, and the entire public site (EUR)
- **Files/functions:** `usd()` in `admin-inventory.js` and `packaging.js`; hard-coded `$`/`€` literals in `admin-menu.js:288-352`; `euro()` duplicated in `admin-production.js`, `admin-sales.js`, `admin-analytics.js`
- **Current behavior:** Same underlying numbers, displayed with different currency symbols/formats depending on which page you're on.
- **Expected behavior:** One currency, one formatting function, shared everywhere.
- **Severity:** Medium — doesn't corrupt the underlying numbers, but is confusing and looks unprofessional/untrustworthy for a financial dashboard, and increases the odds someone reads a USD-formatted number as EUR-equivalent when comparing pages.
- **Confidence:** High.
- **Dependencies:** Owner confirms the site's real currency (almost certainly EUR, given the majority of the app and the domain).
- **Recommended phase:** Phase 1 (easy, high-visibility fix once confirmed) or bundled with a shared-utilities cleanup pass.

---

### BUG-07 — `js/admin.js` is dead, unreachable, and does not even parse
- **Affected pages:** None currently rendered (it isn't loaded anywhere) — risk is latent
- **Files/functions:** `js/admin.js` (entire file, 837 lines)
- **Current behavior:** Not referenced by any `<script>` tag in the repository. Contains a duplicate, self-contained implementation of the login screen, dashboard, reviews, and ballot manager that predates the current multi-page admin structure. `node --check js/admin.js` fails with a syntax error at line 225.
- **Expected behavior:** Either deleted (once confirmed truly unused) or clearly archived, not left in the live `js/` folder where a future edit could re-link it.
- **Severity:** Low today (inert); would be a hard crash if ever re-linked.
- **Confidence:** High.
- **Dependencies:** None.
- **Recommended phase:** Phase 0/1 cleanup (removal is a source change and is out of scope for this audit phase; flagged for the owner's approval before anything is deleted).

---

### BUG-08 — Leftover dead markup in `admin.html`
- **Affected pages:** `admin.html` (the login gate)
- **Files/functions:** `admin.html:76-144` (`#dashboard` div, `#editOptionModal`, `#newBallotModal`)
- **Current behavior:** This HTML was built for `js/admin.js` (BUG-07) and is never used by the script that actually runs on this page (`login.js`, which only handles the login form and redirects). `admin-menu.js` independently rebuilds the same two modals from scratch at runtime for the real Menu page.
- **Expected behavior:** `admin.html` should contain only what its actual script (`login.js`) needs.
- **Severity:** Low.
- **Confidence:** High.
- **Recommended phase:** Phase 0/1 cleanup.

---

### BUG-09 — `css/production.css` is referenced but does not exist
- **Affected pages:** `admin/production.html`
- **Files/functions:** `admin/production.html:8`
- **Current behavior:** 404 on page load. The page still looks correct today only because the actual `.production-*` rules were, at some point, appended directly to the very end of `css/admin.css` instead — see `05-css-audit.md`.
- **Expected behavior:** Either the `<link>` should point at real CSS, or (more consistent with how the rest of the admin dashboard is structured, one shared `admin.css`) the reference should be removed once its rules are confirmed to live safely in `admin.css`.
- **Severity:** Low functional impact (masked by the fallback), but is exactly the kind of broken reference that causes real breakage the next time someone touches `admin.css`'s ending.
- **Confidence:** High.
- **Recommended phase:** Phase 1, bundled with the CSS cleanup (`05`).

---

### BUG-10 — Duplicated pending-reviews logic (Dashboard vs. Reviews page)
- **Affected pages:** Dashboard, Reviews
- **Files/functions:** `js/admin-dashboard.js:242-328` vs. `js/admin-reviews.js:7-97` (near-identical `loadPendingReviews`/`renderPendingReviews`/`approveReview`/`deleteReview`)
- **Current behavior:** Two independent copies of the same feature. Not currently inconsistent, but any future change (e.g. adding a rejection reason) has to be made twice and can easily be made once by mistake.
- **Expected behavior:** One shared function/module.
- **Severity:** Low (works today), Medium risk (future drift).
- **Confidence:** High.
- **Recommended phase:** Phase 2 (shared-utilities pass).

---

### BUG-11 — Duplicated ballot-manager logic (three copies)
- **Affected pages:** `admin.js` (dead, BUG-07), `admin-menu.js` (live)
- **Files/functions:** `js/admin.js:330-803` and `js/admin-menu.js:948-1604` are near-line-for-line identical.
- **Current behavior:** Same feature implemented twice; one copy is dead (BUG-07) so this isn't causing active inconsistency today, but it's evidence of the pattern that produced BUG-10 and should be cleaned up together.
- **Severity:** Low.
- **Confidence:** High.
- **Recommended phase:** Resolved automatically once BUG-07 is cleaned up.

---

### BUG-12 — Dead, unit-conversion-free cost function in `admin-sales.js`
- **Affected pages:** None currently (unused code), but a latent trap
- **Files/functions:** `js/admin-sales.js:167-247` `calculateSaleCost()`
- **Current behavior:** Fully implemented, never called. Computes ingredient cost as `purchase_price / purchase_size` with no unit conversion — would be wrong the moment purchase unit and recipe unit differ.
- **Expected behavior:** Removed, or if a "live recalculation" feature is wanted, rebuilt on the shared costing/conversion logic recommended elsewhere in this audit.
- **Severity:** Low today; would be a Critical-severity bug if ever wired up as-is.
- **Confidence:** High.
- **Recommended phase:** Phase 0/1 cleanup.

---

### BUG-13 — Debug `console.log` statements left in production code
- **Affected pages:** Sales
- **Files/functions:** `js/admin-sales.js:148-154` (dumps all sales' customer/revenue/date on every dashboard load), `js/admin-sales.js:737` (`console.log("PROFIT INPUT:", orders)` on every profit-breakdown render)
- **Current behavior:** Noisy console output on a real, customer-data-adjacent admin page.
- **Severity:** Low.
- **Confidence:** High.
- **Recommended phase:** Phase 1 (trivial, do alongside any other edit to this file).

---

### BUG-14 — No safeguard when deleting an ingredient or recipe still in use
- **Affected pages:** Inventory
- **Files/functions:** `js/admin-inventory.js` `deleteIngredient()` (661-676), `deleteRecipe()` (1308-1323)
- **Current behavior:** Hard delete with no check against `recipe_ingredients`/`packaging_profile_items` (for ingredients) or `menu_items`/`recipe_components` (for recipes). If the database has no FK constraint, this silently breaks recipe costing; if it does, the user sees a raw Postgres error via `alert()`.
- **Expected behavior:** Warn ("used in N recipes/products") before deleting, and/or a friendlier error message.
- **Severity:** Medium.
- **Confidence:** Needs verification (depends on whether FKs/constraints exist in the live schema).
- **Recommended phase:** Phase 2.

---

### BUG-15 — Discounts, taxes, refunds, and waste are entirely unrepresented
- **Affected pages:** Orders, Sales, Analytics (anywhere revenue/COGS is shown)
- **Current behavior:** No field for tax, discount, fee, refund, or waste exists anywhere in `orders`, `order_items`, `sales`, or `sale_items` per every query in this repo. Revenue is always the raw sum of line items.
- **Expected behavior:** Not necessarily a bug — flagged because the audit was specifically asked to check for it. If these exist as real business practices, they're currently handled entirely outside this system (manually), which means the numbers this dashboard shows are not the bakery's true net figures.
- **Severity:** Needs owner input to classify.
- **Confidence:** High (absence confirmed across all schema usage in the repo).
- **Recommended phase:** Scope decision before any phase.

---

## Summary table

| ID | Summary | Severity | Confidence | Phase |
|---|---|---|---|---|
| BUG-01 | Builder sales: revenue right, profit wrong | Critical | High | 1 |
| BUG-02 | Editing an order with a builder box deletes it | High | High | 1–2 |
| BUG-03 | Packaging cost possibly always $0 on Menu | Critical* | Medium | 1 |
| BUG-04 | Inventory recipe cost ignores sub-recipes | High | High | 1 |
| BUG-05 | Inventory unit conversion missing volume/count | High | High | 1 |
| BUG-06 | Currency formatting inconsistent (USD vs EUR vs mixed) | Medium | High | 1 |
| BUG-07 | `admin.js` dead and broken | Low (latent) | High | 0/1 |
| BUG-08 | Dead markup in `admin.html` | Low | High | 0/1 |
| BUG-09 | Missing `production.css` | Low | High | 1 |
| BUG-10 | Duplicated pending-reviews logic | Low/Medium | High | 2 |
| BUG-11 | Duplicated ballot-manager logic | Low | High | resolved w/ BUG-07 |
| BUG-12 | Dead, unsafe cost function in Sales | Low (latent) | High | 0/1 |
| BUG-13 | Debug console.log left in Sales | Low | High | 1 |
| BUG-14 | No delete safeguards for ingredients/recipes | Medium | Needs verification | 2 |
| BUG-15 | No discount/tax/refund/waste support | Unclassified | High | scope decision |

\* Severity marked Critical pending confirmation of the real column type (see Confidence).
