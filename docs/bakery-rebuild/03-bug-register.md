# 03 — Bug Register

Severity: **Critical** (wrong money shown to the owner, or a live security exposure), **High** (wrong data reaches a report or breaks a workflow), **Medium** (real defect, contained impact), **Low** (cosmetic/cleanup).
Confidence: **High** (directly traced in code, and DB-verified where applicable), **Medium** (strongly implied, one unverifiable link), **Needs verification** (depends on live schema/data).

**Updated 2026-08-17** after directly inspecting the live Supabase project (read-only — schema, views, functions, triggers, RLS policies, grants, and the security/performance advisors; see `01-architecture-and-data-flow.md` §8 for method). Several findings below were corrected or quantified as a result; four new findings (BUG-16 through BUG-21) came directly from the database and were not visible from the application source code alone.

**Update 2026-08-17 (later the same day): BUG-16, BUG-17, and BUG-18 have been fixed, applied, and verified live.** Two migrations were applied — see `supabase/migrations/` and `08-security-repair-plan.md` Part I for the full applied SQL, verification tests, and one follow-up gap (a missing admin `INSERT` policy) found and fixed during verification.

---

### BUG-16 — Row Level Security is disabled on `orders` and `order_items`; all customer data and order data is publicly readable and writable — **RESOLVED (2026-08-17)**
- **Status: Fixed and verified live.** RLS enabled on both tables via `supabase/migrations/20260817092629_security_repair_bug16_17_18_orders_rls_admin_functions_cost_views.sql`. Verified: `anon` blocked from `SELECT`/`UPDATE`/`DELETE` on both tables (`42501 permission denied`, at the grant layer); the legitimate anon `INSERT`-only checkout flow still works; the real approved administrator retains full read access. Row counts unchanged before/after (35 orders, 60 order items).
- **Follow-up found during verification, also fixed:** the migration correctly preserved the pre-existing `SELECT`/`UPDATE`/`DELETE` admin policies but — matching the pre-RLS policy set exactly — never added an `INSERT` policy for `authenticated`, since none had ever been needed while RLS was disabled. This surfaced as a real failed checkout (`new row violates row-level security policy for table "orders"`), traced via Postgres logs to a request running as `authenticated` rather than `anon` (most likely an admin session already active in the same browser while testing checkout — determined by reasoning about the policy definitions themselves, without displaying any token or personal information). Fixed by a second migration, `supabase/migrations/20260817094213_restore_admin_insert_orders_order_items.sql`, adding `is_admin()`-gated `INSERT` policies for `authenticated` on both tables. Verified: the real admin can insert; a simulated authenticated non-admin is correctly rejected; anonymous checkout and the anon read/write blocks are unaffected. Full incident writeup in `08-security-repair-plan.md` Part I.
- **Affected pages:** Every page that touches orders (Orders, Production, Sales at one remove via `sales.order_id`) — but really, this affects the database directly, independent of any page.
- **Where:** `public.orders`, `public.order_items` (confirmed via Supabase security advisor + `pg_policies`)
- **Current behavior:** Both tables have admin-only RLS policies already defined and named correctly ("Admins can view/update/delete orders", "Public can create orders", and the equivalent for `order_items`) — but **Row Level Security itself was never enabled on either table**, so none of those policies are enforced. The site's public anon key is embedded in every visitor's browser (`js/supabase.js`). Right now, any internet visitor — logged in or not — can read every customer's name, email, phone number, and full order history directly from the Supabase REST API, and can insert, modify, or delete any order or order line, with no authentication at all.
- **Expected behavior:** RLS enabled on both tables so the existing policies actually take effect.
- **Severity:** **Critical** — this is a live, exploitable data exposure of customer PII and financial records, not a display bug. It is unrelated to every other finding in this audit and should be treated as urgent regardless of when the calculation fixes happen.
- **Confidence:** High — confirmed directly by the Supabase security advisor and by reading the actual RLS state and policy list.
- **Remediation (not applied — inspect-only per this audit's constraints):**
  ```sql
  ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
  ```
  The existing policies on both tables already look correctly scoped (admin-only for read/update/delete, public-insert-only for new orders) — turning RLS on should not require also rewriting the policies, but this should be verified in a safe/staging context before flipping it in production, since enabling RLS with no matching policy for a given operation blocks that operation entirely.
- **Dependencies:** None technical. This is a database change (not application source), and per this audit's scope was flagged for the owner's decision, not applied.
- **Recommended phase:** **Before Phase 1** — this should not wait for the calculation fixes.

---

### BUG-17 — Two `SECURITY DEFINER` functions are callable by unauthenticated users — **RESOLVED (2026-08-17)**
- **Status: Fixed and verified live**, via the same migration as BUG-16. Both functions now check `public.is_admin()` internally (raising an exception if the caller isn't the approved admin), have a fixed `search_path`, and had `EXECUTE` revoked from `anon`/`PUBLIC`. Verified: `anon` calling either function is rejected with `42501 permission denied` before the function body even runs; the real admin's `is_admin()` check (confirmed via their actual identity, not just a role switch) returns `true`, so their calls are unaffected. `prepare_new_ballot` and `rls_auto_enable` also received the fixed-`search_path`/grant hygiene fixes described in the plan.
- **Affected pages:** Production (`complete_production`), the ballot feature (`end_current_ballot`) — but exploitable directly via the API, bypassing any page.
- **Where:** `public.complete_production(p_production_date, p_snapshot, p_deductions)`, `public.end_current_ballot(ballot_uuid)`
- **Current behavior:** Both functions run with elevated database privileges (`SECURITY DEFINER`) and are exposed at `/rest/v1/rpc/...` to the `anon` role (confirmed via the security advisor). `complete_production` really does deduct `ingredients.quantity_on_hand` and mark a `production_runs` row completed (its own logic is correct and safe — row-locked, floors at zero, refuses to double-run — see `01-architecture-and-data-flow.md` §8) — but nothing stops anyone from calling it directly with fabricated deduction amounts for any date, with no login. `end_current_ballot` lets anyone archive the currently active ballot at will (its ID is publicly readable via `ballot_settings`' own public SELECT policy).
- **Expected behavior:** These functions should only be callable by authenticated admins.
- **Severity:** High — `complete_production` can corrupt real inventory records without any authentication; `end_current_ballot` is lower-stakes (a customer-facing voting feature) but has the same underlying gap.
- **Confidence:** High.
- **Remediation (not applied):** Revoke `EXECUTE` from `anon` (and, if these should only ever be called by the admin dashboard, from `authenticated` too, or add a caller check inside the function) — the exact fix is a database change and an owner decision on intended access, not made in this audit-only pass.
- **Recommended phase:** Before Phase 1, alongside BUG-16.

---

### BUG-18 — Internal cost data is publicly queryable — **RESOLVED (2026-08-17)**
- **Status: Fixed and verified live**, via the same migration as BUG-16/17. Both views converted to `security_invoker = true`, so they now run with the querying role's own privileges instead of the view owner's — they inherit the same `authenticated`-only restriction already correctly in place on the underlying `ingredients`/`recipes`/`packaging_profiles` tables. `anon`'s grant on both views was also revoked directly. Verified: `anon` querying either view is rejected with `42501 permission denied for view`; the real admin retains full access, confirmed reading a row count matching every real recipe/packaging profile in the database.
- **Affected pages:** None directly — exploitable via the API regardless of page.
- **Where:** `public.recipe_costs`, `public.packaging_profile_costs` (both views)
- **Current behavior:** Both views are flagged `SECURITY DEFINER` by the advisor and confirmed (via `information_schema.role_table_grants`) to grant `SELECT` to `anon`. The underlying `ingredients`/`recipes`/`recipe_ingredients` tables are correctly restricted to `authenticated` only — but because these views run with the view-owner's elevated privileges, that restriction doesn't apply to them. In practice, anyone can query the bakery's internal ingredient cost, recipe cost, and packaging cost — commercially sensitive numbers the owner would reasonably not want a competitor or the general public to see — without logging in.
- **Expected behavior:** These views should be restricted to `authenticated` (or rebuilt as `SECURITY INVOKER`, which Postgres supports for views, so they naturally inherit the caller's own RLS restrictions instead of the owner's).
- **Severity:** High (business-sensitive data exposure; not a customer-safety issue the way BUG-16 is, but still a real confidentiality gap).
- **Confidence:** High.
- **Recommended phase:** Before Phase 1, alongside BUG-16/17.

---

### BUG-19 — No currency or exchange-rate columns exist in the schema
- **Affected pages:** Sales, Analytics (once the owner's confirmed EUR→USD reporting design is implemented — see `02-calculation-audit.md` §11)
- **Where:** `sales`, `sale_items`, `orders`, `ingredients` — none have a currency or exchange-rate column today.
- **Current behavior:** All money columns are plain `numeric` with no currency tag. Confirmed by searching every column name in the schema for currency-related terms — no matches.
- **Expected behavior:** Per the owner's confirmed design: `sales` needs a frozen `exchange_rate` captured at completion time, plus USD-equivalent columns computed from it (see `02-calculation-audit.md` §11 for the recommended shape). Separately, `ingredients`/`purchases` need a currency field, since purchases are genuinely made in both USD (American suppliers) and EUR (German suppliers) today with no way to distinguish them.
- **Severity:** Medium — not corrupting anything today (no USD reporting exists yet to be wrong), but it's the blocking prerequisite for the owner's confirmed Sales/Analytics currency design.
- **Confidence:** High (schema search is exhaustive and conclusive).
- **Recommended phase:** Phase 1, as new schema, before any USD-reporting UI work.

---

### BUG-20 — Deleting a component recipe silently cascades, removing it from every recipe that uses it
- **Affected pages:** Inventory (Recipes tab)
- **Where:** `recipe_components_component_recipe_id_fkey` — confirmed via `pg_constraint` to be `ON DELETE CASCADE`.
- **Current behavior:** If a sub-recipe used as a component elsewhere (e.g. "Cream Cheese Frosting," currently used by 4 other recipes per live data) is deleted via `admin-inventory.js`'s `deleteRecipe()`, the database does **not** block the delete — it silently cascades, deleting the `recipe_components` rows that referenced it in every parent recipe. Those parent recipes' costs (and production ingredient requirements) would then silently drop, with no warning to the admin that anything downstream was affected. (By contrast, deleting an *ingredient* still in use, or a recipe still referenced by a `menu_items.recipe_id`, is correctly blocked by the database with a `RESTRICT`/`NO ACTION` foreign key — confirmed via the same query — so those two cases fail loudly via `alert(error.message)` rather than silently corrupting data.)
- **Expected behavior:** Either warn ("used as a component in N recipes") before deleting a recipe, or change the foreign key so deleting a still-used component recipe is blocked like the other two cases.
- **Severity:** Medium — narrower than originally suspected (only affects component recipes specifically, not ingredients or standalone recipes, both of which are already safely blocked by the database), but it is a confirmed, real, silent-data-loss path.
- **Confidence:** High (confirmed directly via `pg_constraint`).
- **Recommended phase:** Phase 2.

---

### BUG-21 — Minor Supabase hardening and performance items
- **Affected pages:** None directly.
- **Current behavior, per the Supabase advisors:**
  - Leaked-password protection is disabled in Supabase Auth (doesn't check new passwords against known-breached password lists).
  - `gallery_items` has RLS enabled but zero policies defined — currently fully locked to everyone, which is harmless today since the Gallery admin page is an unbuilt "Coming Soon" stub, but will need policies added the moment that page is built.
  - 13 foreign key columns have no covering index (`ingredients.category_id`/`supplier_id`, `menu_items.packaging_profile_id`/`recipe_id`, both `order_items` FKs, both `purchases` FKs, both `recipe_components` FKs, both `recipe_ingredients` FKs, both `sale_items` FKs, `sales.order_id`) — informational only at the current data volume (34–136 rows per table), but worth adding as the bakery's history grows.
  - `menu_items`, `reviews`, and `suggestions` each have two overlapping "permissive" RLS SELECT policies for the `authenticated` role, meaning Postgres evaluates both on every query — harmless but avoidable.
- **Severity:** Low across the board.
- **Confidence:** High.
- **Recommended phase:** Phase 3/4, opportunistic.

---

### BUG-22 — Completed orders can still be edited, letting live `orders`/`order_items` diverge from the frozen `sales`/`sale_items` record
- **Affected pages:** Orders (`admin-orders.js`'s manual order editor); downstream effect on Sales/Analytics for any sale whose order is later edited
- **Files/functions:** `js/admin-orders.js` `saveManualOrder()` (edit path) — deletes and re-inserts `order_items` for `editingOrderId` with no check on the order's `status`
- **Discovered:** 2026-08-17, during Phase 1A historical-data validation, while investigating two sales whose current `order_items` no longer matched their stored `sales.revenue`.
- **Current behavior, confirmed with direct evidence (not inferred):** Two real orders (`status: "completed"` in both cases) now have `orders.subtotal` reduced to €30.00 and €15.00 respectively — matching their *current*, shorter `order_items` list. Their corresponding `sales`/`sale_items` rows, frozen at original completion, still correctly total €45.00 and €30.00, and each `sale_items` snapshot still contains the exact line (a "6 Pack" cookie item, €15.00) that is now missing from the live order. There is no `status` guard anywhere in the edit flow preventing this — an admin can open **Edit** on any order, regardless of status, and `saveManualOrder()` will delete and re-insert its `order_items` and overwrite `orders.subtotal` unconditionally.
- **Expected behavior:** Editing an order that is already `completed` (i.e., has a linked `sales` row) should be blocked, or at minimum warned against, since the financial record for that sale has already been finalized and frozen elsewhere in the schema.
- **Severity:** Medium — the frozen `sales`/`sale_items` record itself stays correct (this is not a financial-accuracy bug the way BUG-01 was), but it does mean the live `orders`/`order_items` view of a completed order can silently stop matching the sale that was actually recorded, which is confusing for anyone reviewing order history and would compound if it happens more than the two known instances.
- **Confidence:** High for these two confirmed instances (direct evidence: `orders.subtotal` vs. frozen `sale_items` sum, both `status: "completed"`); the general "no status guard" mechanism is confirmed by reading `saveManualOrder()` directly.
- **Dependencies:** None technical.
- **Do not "fix" the two known instances by editing `sales`/`sale_items`** — those records are already correct and must be left exactly as they are (see `09-bug01-regression-report.md` §6c). Only the *edit-guard* itself needs fixing, for future orders.
- **Recommended phase:** Phase 2.

---

### BUG-01 — Builder ("Mix & Match") sales show correct revenue but understated profit/margin
- **Affected pages:** Sales, Analytics (both read the `sales`/`sale_items` tables this bug corrupts)
- **Files/functions:** `js/admin-orders.js:648-958` `createSaleFromOrder()`
- **Current behavior:** When an order containing a Mix & Match box is completed, `sales.revenue` is set from `orders.subtotal` (correct, includes the box price), but every `sale_items` row generated for the box's contents is hard-coded `unit_price: 0, line_revenue: 0`. `sales.profit` is then recomputed from the sum of `sale_items.line_revenue` (which excludes the box price) minus the box's real ingredient/packaging cost (which **is** included correctly). `sales.revenue` is never re-synced.
- **Confirmed against live data (2026-08-17):** of the bakery's **34 completed sales, 18 (53%) contain a builder item, and all 18 show the predicted gap** (a direct, non-PII aggregate query — sale IDs and money columns only). **€335.00 of real revenue is currently missing from the profit calculation** across those 18 sales; several individual sales currently show a negative `profit` in the database despite having real, positive revenue. The 16 non-builder sales all reconcile exactly (`sum(sale_items.line_revenue) = sales.revenue`), confirming the defect is specific to builder products, not a general revenue bug.
- **Expected behavior / confirmed fix (owner decision, 2026-08-17):** The builder box itself becomes the parent sale line and carries all of that line's revenue; its selected products remain child lines contributing cost and quantity only, with no revenue attributed to them (to avoid double-counting). Concretely: insert one additional `sale_items` row per builder order line, using the builder's own `menu_items` row, carrying the real `unit_price`/`line_revenue`; leave the existing per-selection child rows exactly as they are (cost/quantity only, revenue at 0). See `02-calculation-audit.md` §5 for the full mechanics.
- **Severity:** Critical — directly misstates gross profit/margin on the two pages whose entire purpose is showing the owner accurate profit, and is already actively affecting the majority of recorded sales history.
- **Confidence:** High — traced in code **and** empirically confirmed against every affected row in production.
- **Dependencies:** None remaining — fix design is confirmed by the owner.
- **Status (Phase 1A, 2026-08-17): code fix shipped, historical data not yet backfilled.** `js/sale-calculations.js` (new, shared, tested) plus a fixed `createSaleFromOrder()` in `js/admin-orders.js` now prevent this from happening to any order completed from here forward — verified by an 11-test suite (`tests/sale-calculations.test.js`, `node --test`, all passing) covering standard orders, single and multiple builder boxes, mixed orders, differing per-selection costs, malformed selection data, zero-revenue edge cases, and confirming Sales/Analytics can never independently drift again. **This code change does not retroactively correct the 18 already-affected historical sales** — Sales/Analytics only read already-stored `sales`/`sale_items` values, never recompute them, so those 18 rows display exactly as before until a separate backfill is applied. The verified, precise historical correction is **€335.00 of profit**, computed entirely from each sale's own already-correct stored `revenue`/`total_cost` (not from today's ingredient costs) — full detail, per-sale numbers, and the exact backfill plan (not yet applied) in `08-security-repair-plan.md`-adjacent `09-bug01-regression-report.md`. See also BUG-22, a separate, unrelated defect discovered while validating this fix.
- **Recommended phase:** Phase 1 code fix — **done**. Historical backfill — Phase 1B, only after the code fix above is deployed and verified live.

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

### BUG-03 — Inconsistent ID-casting for packaging cost lookups (confirmed NOT a live bug)
- **Affected pages:** Menu (Menu Manager cards' "Packaging" cost, "Total Cost", "Estimated Profit")
- **Files/functions:** `js/admin-menu.js:108-113, 1694-1701` `getPackagingCost()`
- **Current behavior:** `packagingCosts` map is built from `packaging_profile_costs` keyed by raw `id`, but looked up via `Number(profileId)`. Two other files read the same view with two other conventions (`String(...)` in `admin-production.js`, raw/no-cast in `admin-orders.js`).
- **Resolved 2026-08-17:** Directly confirmed via Supabase that `packaging_profiles.id`/`packaging_profile_costs.id` are `bigint`, not UUIDs, and that real IDs are small integers (`2`–`6`). Cross-checked every live packaging profile against `menu_items.packaging_profile_id` and every lookup resolves correctly with real, non-zero costs. **The original hypothesis (that this silently zeroes out every menu card's packaging cost) does not hold** — `Number()` on a small integer is a harmless no-op.
- **Expected behavior:** Still worth standardizing on one casting convention across the three files, purely for consistency and to avoid this becoming a real bug if `packaging_profiles` is ever migrated to UUIDs (as most of the rest of the schema already uses).
- **Severity:** Downgraded from Critical to **Low** — code-style inconsistency, not a functional defect.
- **Confidence:** High (directly verified against live schema and data).
- **Dependencies:** None.
- **Recommended phase:** Phase 2/3, opportunistic cleanup alongside other shared-utility consolidation.

---

### BUG-04 — Recipe cost on the Inventory tab silently ignores sub-recipe components (confirmed confined to that one tab)
- **Affected pages:** Inventory (Recipes tab, "Recipe Costing" panel) **only** — confirmed not to reach Menu, Sales, or Analytics.
- **Files/functions:** `js/admin-inventory.js:1446-1452` `getRecipeCost(recipe)`
- **Current behavior:** Sums only `recipe.recipe_ingredients`; never looks at `recipe.recipe_components` (sub-recipes).
- **Resolved 2026-08-17:** The canonical `recipe_costs` Postgres view (used by Menu and by sale creation) was inspected directly and **does** correctly and recursively include sub-recipe components, with cycle protection and full mass/volume/count unit conversion — better than any client-side implementation in the repo. Cross-checked against the 4 real recipes that use a shared component ("Cream Cheese Frosting"): the Inventory tab's display understates their true cost by **29–47%** (e.g. Cinnamon Rolls: DB-correct $7.70 vs. Inventory tab's $4.26).
- **Expected behavior:** The Inventory tab should either call the same view or replicate its recursive logic, so its displayed number matches reality.
- **Severity:** Downgraded from "affects costing everywhere" to **Medium** — confirmed display-only, confined to one tab, and confirmed not to affect pricing, sale creation, or Sales/Analytics.
- **Confidence:** High (verified against live view definition and real data).
- **Dependencies:** None remaining.
- **Recommended phase:** Phase 2 (correctness, but lower urgency than Phase 1 items now that the blast radius is confirmed narrow).

---

### BUG-05 — Ingredient/recipe unit conversion is incomplete on the Inventory tab (confirmed zero live impact today)
- **Affected pages:** Inventory (Recipes tab, "Recipe Costing" panel)
- **Files/functions:** `js/admin-inventory.js:1473-1495` `convertUnit()`
- **Current behavior:** Only converts between mass units (g/kg/lb/oz). Volume (mL/L/tsp/tbsp/cup) or count-unit-pair conversions return `null`, and the caller (`getIngredientCost`) treats that as **$0 cost**, with no warning shown. `admin-production.js`'s `convert()`, and the canonical `recipe_costs` database view, both correctly handle mass, volume, and count.
- **Resolved 2026-08-17:** Queried every ingredient's real `purchase_unit`/`recipe_unit`. **No ingredient in the live data uses a volume unit at all**, and every `each`-unit ingredient is purchased and used in the same unit (hitting the trivial same-unit branch, not the lookup table). The 11 ingredients with differing purchase/recipe units are all mass-to-mass (lb→g, oz→g), which this function already handles correctly. **The gap is real in the code but is not currently corrupting any number.**
- **Expected behavior:** One shared conversion utility (matching the database view's capability), used everywhere, so the gap can't become live the moment a new ingredient with a volume unit is added.
- **Severity:** Downgraded from High to **Low** (currently zero impact) — but should still be fixed proactively rather than waiting for it to break.
- **Confidence:** High (verified against every real ingredient row).
- **Dependencies:** None.
- **Recommended phase:** Phase 2/3.

---

### BUG-06 — Currency handling needs three different treatments, not one fix (owner confirmed 2026-08-17)
- **Affected pages:** Inventory, Packaging (USD), Menu (mixes `$` and `€` on the same card), vs. Dashboard, Orders, Production, Sales, Analytics, and the entire public site (EUR)
- **Files/functions:** `usd()` in `admin-inventory.js` and `packaging.js`; hard-coded `$`/`€` literals in `admin-menu.js:288-352`; `euro()` duplicated in `admin-production.js`, `admin-sales.js`, `admin-analytics.js`
- **Current behavior:** Same underlying numbers, displayed with different currency symbols/formats depending on which page you're on.
- **Owner-confirmed correct behavior (this is more nuanced than "pick one currency"):**
  1. Customers always see/pay EUR — already correct, no change.
  2. Inventory/Packaging showing USD is not simply wrong — ingredients are genuinely purchased in both USD (American suppliers) and EUR (German suppliers). The fix is a **per-ingredient currency field** (doesn't exist yet — see BUG-19), not a blanket relabel to EUR.
  3. Sales/Analytics should report in **USD** (the owner's own internal reporting currency) — the **opposite** of what the original pass of this audit assumed. This requires converting the underlying EUR sale amounts using a frozen, sale-time exchange rate (see `02-calculation-audit.md` §11), not just changing the formatter.
- **Severity:** Medium — doesn't corrupt underlying numbers yet, but Inventory currently mislabels genuinely-USD and genuinely-EUR purchase prices identically, and Sales/Analytics can't correctly show USD at all until BUG-19's schema exists.
- **Confidence:** High.
- **Dependencies:** BUG-19 (currency/exchange-rate schema) must land first for Sales/Analytics; the Inventory currency field is independent and can be done in parallel.
- **Recommended phase:** Phase 1 (schema), Phase 2 (UI/formatting rollout).

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

### BUG-14 — No safeguard when deleting an ingredient or recipe still in use (now precisely characterized)
- **Affected pages:** Inventory
- **Files/functions:** `js/admin-inventory.js` `deleteIngredient()` (661-676), `deleteRecipe()` (1308-1323)
- **Current behavior:** No client-side check or warning before deleting. **Resolved 2026-08-17** — the actual database behavior is now confirmed and is a mix of safe and unsafe:
  - Deleting an **ingredient** still referenced by `recipe_ingredients` or `packaging_profile_items` is **safely blocked** by the database (`NO ACTION`/`RESTRICT` foreign keys) — the delete fails and the admin sees a raw Postgres error via `alert()`. Data-safe, just an unfriendly error message.
  - Deleting a **recipe** still referenced by `menu_items.recipe_id` is likewise **safely blocked**.
  - Deleting a **recipe that is used as a component in another recipe** (`recipe_components.component_recipe_id`) is **not blocked — it cascades silently** (`ON DELETE CASCADE`), removing that component from every recipe that used it with no warning and no error. This is now tracked separately and more precisely as **BUG-20**, since it's a real, confirmed, silent-data-loss path rather than a hypothetical one.
- **Expected behavior:** A friendlier pre-delete warning ("used in N recipes/products") for the two blocked cases, and the same or a hard block for the unblocked (component-recipe) case.
- **Severity:** Medium (unfriendly-but-safe for ingredients/recipes; see BUG-20 for the one genuinely unsafe case).
- **Confidence:** High (directly verified via `pg_constraint`).
- **Recommended phase:** Phase 2.

---

### BUG-15 — Discounts, taxes, refunds, and waste — confirmed out of scope by the owner
- **Affected pages:** Orders, Sales, Analytics (anywhere revenue/COGS is shown)
- **Current behavior:** No field for tax, discount, fee, refund, or waste exists anywhere in `orders`, `order_items`, `sales`, or `sale_items` — confirmed both in the application code and directly against the live schema (no such columns exist on any table).
- **Owner confirmed (2026-08-17):** There are no discounts, no taxes, no refunds, and no waste in this business today. **Resolved — not in scope for this repair project.** No code or schema change is needed for this item.
- **Severity:** N/A — closed.
- **Confidence:** High.
- **Recommended phase:** None — closed, revisit only if the business practice changes in the future.

---

## Summary table (updated 2026-08-17 after live database verification; BUG-16/17/18 later resolved same day)

| ID | Summary | Severity | Confidence | Phase |
|---|---|---|---|---|
| BUG-16 | RLS disabled on `orders`/`order_items` — customer data publicly exposed | **RESOLVED** (was Critical) | High (fixed & verified live) | Done |
| BUG-17 | `complete_production`/`end_current_ballot` callable by anyone, unauthenticated | **RESOLVED** (was High) | High (fixed & verified live) | Done |
| BUG-18 | Internal cost data (`recipe_costs`/`packaging_profile_costs`) publicly queryable | **RESOLVED** (was High) | High (fixed & verified live) | Done |
| BUG-01 | Builder sales: revenue right, profit wrong — confirmed on 18/34 sales, €335 correction verified | **Code fix DONE (Phase 1A)**; historical backfill pending | High (verified live + 11/11 tests) | 1A done / 1B pending |
| BUG-22 | Completed orders can still be edited; live order data can drift from the frozen sale record | Medium | High (2 confirmed instances) | 2 |
| BUG-02 | Editing an order with a builder box deletes it | High | High | 1–2 |
| BUG-19 | No currency/exchange-rate columns exist | Medium | High | 1 |
| BUG-06 | Currency needs 3 different treatments (customer EUR, inventory per-purchase, reporting USD) | Medium | High | 1 (schema) / 2 (UI) |
| BUG-04 | Inventory tab recipe cost ignores sub-recipes — confirmed confined to that tab, 29–47% understated | Medium (was High) | High (verified) | 2 |
| BUG-20 | Deleting a component recipe silently cascades, dropping it from recipes that use it | Medium | High (verified) | 2 |
| BUG-14 | Ingredient/recipe delete: safe-but-unfriendly for 2 of 3 cases (see BUG-20 for the unsafe one) | Medium | High (verified) | 2 |
| BUG-03 | Packaging cost ID-cast inconsistency — confirmed **not** a live bug | Low (was Critical) | High (verified) | 2/3 |
| BUG-05 | Inventory unit conversion missing volume/count — confirmed zero live impact today | Low (was High) | High (verified) | 2/3 |
| BUG-21 | Minor Supabase hardening/performance items (advisors) | Low | High | 3/4 |
| BUG-07 | `admin.js` dead and broken | Low (latent) | High | 0/1 |
| BUG-08 | Dead markup in `admin.html` | Low | High | 0/1 |
| BUG-09 | Missing `production.css` | Low | High | 1 |
| BUG-10 | Duplicated pending-reviews logic | Low/Medium | High | 2 |
| BUG-11 | Duplicated ballot-manager logic | Low | High | resolved w/ BUG-07 |
| BUG-12 | Dead, unsafe cost function in Sales | Low (latent) | High | 0/1 |
| BUG-13 | Debug console.log left in Sales | Low | High | 1 |
| BUG-15 | No discount/tax/refund/waste support | **Closed — confirmed out of scope by owner** | High | none |
