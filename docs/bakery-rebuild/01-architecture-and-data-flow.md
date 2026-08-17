# 01 — Architecture & Data Flow

## 1. Stack summary

| Layer | What it actually is |
|---|---|
| Framework | **None.** Hand-written static HTML files, one per page. No React/Vue/build step, no bundler, no `package.json`, no npm dependencies. |
| Language | Vanilla JavaScript (ES2020+ features: optional chaining, `??`, `replaceAll`), loaded via plain `<script src>` tags. No TypeScript. |
| Styling | Two hand-written CSS files: `css/style.css` (public site) and `css/admin.css` (entire admin dashboard, 5,106 lines). No preprocessor, no CSS framework. |
| Database / Backend | **Supabase** (hosted Postgres + PostgREST + Auth). Client talks to it directly from the browser via `@supabase/supabase-js@2`, loaded from a CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`) — pinned to no specific version. |
| Auth | Supabase email/password auth (`supabaseClient.auth.signInWithPassword`). A single admin user is implied ("Jess"). No role/permission system — anyone who authenticates has full admin access. |
| Hosting | Static hosting with a custom domain via `CNAME` (`jessbakessourdough.com`) — consistent with **GitHub Pages**. No server-side code anywhere. |
| Charts | Chart.js, lazy-loaded from CDN at runtime (`ensureChartJs()` in both `admin-sales.js` and `admin-analytics.js` — **duplicated loader logic**, see below). |
| Fonts | Google Fonts (`Cormorant Garamond`, `Inter`), loaded per-admin-page via `<link>`. |
| Tests / CI / Build tooling | **None found.** No `package.json`, no test framework, no linter config, no CI workflow files, no `.sql` migration files in the repo. |

### Database access model

There is no server-side API layer. Every admin page and every public page talks **directly to Supabase** using a publishable anon key hard-coded in `js/supabase.js`:

```js
const SUPABASE_URL = "https://fbfvqiuhwqfhhxufgmla.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bVAGi0NZtzqmICQ_RJ79IQ_Lvz-UVEb";
```

All business logic — cost math, unit conversion, margin calculation, production planning — therefore lives **in the browser**, scattered across per-page JavaScript files, not in a shared library, **except for `recipe_costs` and `packaging_profile_costs`, which are Postgres views**. Their definitions were verified directly against the live Supabase project on 2026-08-17 via the Supabase MCP tools (read-only inspection — see §8 for the full method and §9 for what this changed about the original, code-only version of this audit).

There are three Postgres RPC functions called from the client, plus one more used only by the database itself; all four were also verified directly:
- `prepare_new_ballot()` — called when starting a new ballot (`js/admin-menu.js`; the reference from `js/admin.js` is in dead code, see §5). Runs as the calling user (not `SECURITY DEFINER`), so it is correctly restricted to authenticated admins by the same RLS policies that protect the ballot tables.
- `end_current_ballot(ballot_uuid uuid)` — archives a ballot. Called by no client code found in this repo (unused today, but live and callable).
- `complete_production(p_production_date, p_snapshot, p_deductions)` — called when finishing a production run (`js/admin-production.js`). Confirmed correct and safe: it locks the `production_runs` row, refuses to run twice for the same date, and floors every `ingredients.quantity_on_hand` deduction at zero.
- `rls_auto_enable()` — an **event trigger** function (fires automatically on `CREATE TABLE`), not something the app calls. It auto-enables RLS on any *new* public table. Its existence explains, but does not excuse, the RLS gap found in §8: it protects tables created after this trigger was added, not the two legacy tables that predate it.

Both `complete_production` and `end_current_ballot` are declared `SECURITY DEFINER` **and are currently callable by the unauthenticated `anon` role** — see §8, this is a real security finding, not just a code-quality one.

## 2. Public-facing pages

| Page | Script(s) | Purpose |
|---|---|---|
| `index.html` | `supabase.js`, `suggestions.js`, `community-favorites.js`, `ballot.js`, `script.js`, `newsletter.js` | Homepage. Hero section, community favorites, the bakery "ballot" (customers vote on the next bread/cookie/dessert), a suggestion box, and a newsletter signup — all live Supabase-backed widgets. |
| `menu.html` | `supabase.js`, `cart.js`, `menu.js`, `script.js` | Public ordering menu. Reads `menu_items` (`available = true`), renders cards, and drives the cart/checkout flow that writes to `orders`/`order_items`. |
| `reviews.html` | `supabase.js`, `reviews.js`, `script.js` | Customer review submission + display of approved reviews. |
| `contact.html` | `script.js` only | Static contact info page, no Supabase calls. |
| `admin.html` | `supabase.js`, `login.js` | The **login gate**. Redirects to `admin/dashboard.html` on success. Contains leftover, unused markup — see §5. |

## 3. Admin pages & navigation

All 12 admin pages share the same hand-copied sidebar markup (not a shared template/include — there is no templating system, so the nav `<nav class="sidebar-nav">` block is duplicated verbatim into every HTML file). Order shown in the sidebar:

```
Dashboard → Orders → Menu → Suggestions → Reviews
──────────────────────────────────────────────────
Production → Sales → Analytics → Inventory → Packaging → Subscribers → Gallery
──────────────────────────────────────────────────
Settings
```

| Page | Script | Status | Notes |
|---|---|---|---|
| `dashboard.html` | `admin-dashboard.js` | Functional | KPI cards, recent orders, notifications, upcoming pickups, pending reviews. |
| `orders.html` | `admin-orders.js` | Functional | Order queue (pending/confirmed/ready/completed/cancelled), manual order entry, status transitions. **This is also where a `sales` row is created** when an order is marked completed. |
| `menu.html` | `admin-menu.js` | Functional | Menu item CRUD + the bakery ballot manager (duplicated again from `admin.js`/`admin.html`, see §5). |
| `suggestions.html` | `admin-suggestions.js` | Functional | Customer suggestion inbox, can promote a suggestion to a ballot option. |
| `reviews.html` | `admin-reviews.js` | Functional | Approve/delete pending reviews. **Identical logic already exists inline in `admin-dashboard.js`** — duplicated, not shared. |
| `production.html` | `admin-production.js` | Functional, most complex page | Per-pickup-date production plan: expands orders → recipes → ingredient/packaging requirements, checks against on-hand inventory, and can "Finish Production" to deduct inventory via the `complete_production` RPC. References a **missing** `css/production.css` (see §6). |
| `sales.html` | `admin-sales.js` | Functional but see calculation audit | Revenue/profit dashboards, Chart.js graphs, CSV export. Reads from the `sales`/`sale_items` snapshot tables, not `orders`. |
| `analytics.html` | `admin-analytics.js` | Functional but see calculation audit | Customer/product analytics, also reads `sales`/`sale_items`. |
| `inventory.html` | `admin-inventory.js` | Functional | Ingredient CRUD, restock, recipe CRUD (ingredients + sub-recipe "components"), shopping list, suppliers. |
| `packaging.html` | `packaging.js` | Functional | Packaging profile CRUD (bundles of packaging/supply ingredients consumed per order). |
| `subscribers.html` | `admin-subscribers.js` | Functional | Newsletter subscriber list + send test/broadcast newsletter. |
| `gallery.html` | `admin-gallery.js` | **Placeholder** | "Coming Soon" — the JS file only calls `requireAuth()`, no gallery functionality exists yet. Intentional, not broken. |
| `settings.html` | `admin-settings.js` | **Placeholder** | Same — "Coming Soon", stub script. |

## 4. Where the money-relevant data lives

Originally inferred from `supabaseClient.from(...)` calls; **now confirmed directly against the live Supabase schema** (2026-08-17). The real primary-key type of every table is included below because it resolves an open question from the first pass of this audit (§9, and see `02-calculation-audit.md` §3).

| Table | ID type | Written by | Read by | Role |
|---|---|---|---|---|
| `ingredients` | `bigint` | `admin-inventory.js` | inventory, packaging, production, menu, sales, orders | Purchase price, purchase size/unit, recipe unit, quantity on hand, minimum quantity, supplier, category. |
| `inventory_categories`, `suppliers` | `bigint` | `admin-inventory.js` | inventory, packaging | Lookup tables. |
| `recipes` | `bigint` | `admin-inventory.js` | inventory, menu, production, sales | Name, category, yield quantity/unit, notes. |
| `recipe_ingredients` | `bigint` | `admin-inventory.js` | inventory, production, sales | Recipe → ingredient → quantity (join row). |
| `recipe_components` | `bigint` | `admin-inventory.js` | inventory, production | Recipe → sub-recipe → quantity + unit (lets one recipe use another recipe as an ingredient, e.g. a filling). |
| `recipe_costs` | n/a (view, keyed on `recipes.id`) | **Postgres view — confirmed, not written by any app code** | menu, orders (sale creation), production references it too | Exposes `ingredient_cost` (total batch cost) and `cost_per_yield_item` per recipe. **Formula confirmed correct — see `02-calculation-audit.md` §2.** |
| `packaging_profiles`, `packaging_profile_items` | `bigint` | `packaging.js` | menu, production, sales, orders | A named bundle (e.g. "Bread Loaf") of packaging/supply ingredients + quantities. |
| `packaging_profile_costs` | n/a (view, keyed on `packaging_profiles.id`) | **Postgres view — confirmed** | menu, production, orders | Exposes `packaging_cost` per profile. **Formula confirmed — see `02-calculation-audit.md` §3.** |
| `menu_items` | `uuid` (its `recipe_id`/`packaging_profile_id` columns are `bigint`, referencing the tables above) | `admin-menu.js` | everywhere | Public product: price, category, `recipe_id`, `recipe_units_used`, `packaging_profile_id`, or (for "builder" Mix & Match products) `builder_group`/`builder_size` instead of a recipe. |
| `orders`, `order_items` | `uuid` | public `cart.js` (customer checkout) and `admin-orders.js` (manual entry/edit) | orders, production, sales-creation | Live order queue. `orders.subtotal` is the order total at the time it was placed. `order_items.builder_details` (`jsonb`) carries the Mix & Match breakdown for builder products. **RLS is disabled on both tables — see §8, this is a critical security finding.** |
| `sales`, `sale_items` | `uuid` | **only** `admin-orders.js`, at the moment an order's status becomes `completed` | sales, analytics | A frozen snapshot meant to preserve the order's financial picture even if recipes/prices change later. No currency/exchange-rate columns exist on either table — see §9. |
| `production_runs` | `uuid` | `admin-production.js` (via `complete_production` RPC and a direct `upsert` for the checklist) | production | Per-date checklist + "inventory already deducted" flag. |
| `purchases` | `bigint` | `admin-inventory.js` (restock flow) | (not read back anywhere found) | Purchase log; confirmed empty (0 rows) — doesn't appear to feed any report yet. |
| `ballot_settings`, `ballot_options`, `votes`, `ballot_history` | `uuid` | admin ballot manager, public `ballot.js` | dashboard, menu | Unrelated to cost flow — the "vote for next bread" feature. |
| `reviews`, `suggestions`, `subscribers`, `gallery_items` | `uuid` | public forms | admin equivalents | Unrelated to cost flow. `gallery_items` exists in the schema already (RLS enabled, no policies yet — matches the "Coming Soon" Gallery page). |

## 5. Dead / orphaned code discovered during this audit

- **`js/admin.js` (837 lines) is not loaded by any HTML page.** `admin.html` loads `login.js` (not `admin.js`); `admin/dashboard.html` loads `admin-dashboard.js` (not `admin.js`). `admin.js` is a complete, self-contained earlier implementation of the whole admin dashboard (login + KPI cards + reviews + ballot manager, building everything into a single `#dashboard` div) that has since been replaced by the current multi-page structure. It is currently unreachable. **It also fails to parse** — `node --check js/admin.js` reports a syntax error at line 225 (stray `);`), so it would crash immediately if it were ever re-linked.
- **`admin.html` still contains the leftover markup that `admin.js` used to drive**: a `<div id="dashboard">` and the `editOptionModal`/`newBallotModal` ballot modals (`admin.html:76-144`). None of this is used today — `admin.html` only runs `login.js`, which redirects to `admin/dashboard.html` on success. `js/admin-menu.js` independently **rebuilds the same two modals from scratch** at runtime (`ensureBallotModals()`), so the static copies in `admin.html` are pure dead weight.
- **`calculateSaleCost()` in `admin-sales.js`** (lines 167–247) is fully implemented but never called from anywhere in that file. The page actually displays cost/profit from the stored `sales` table columns. This dead function also uses a third, different (and unit-conversion-free) cost formula — see `02-calculation-audit.md`.
- **`css/production.css`**, linked by `admin/production.html`, does not exist anywhere in the repository. This is a 404 on load. It is not visually broken today only because the `.production-*` rules were separately (and only) appended to the end of `css/admin.css` (also loaded by that page) — see `05-css-audit.md`.

## 6. End-to-end data flow (narrative)

```
Ingredient purchase (admin-inventory.js "Restock")
   → ingredients.purchase_price / purchase_size / purchase_unit updated
   → recipe_ingredients.quantity (per recipe, in recipe_unit)
   → [unit conversion, purchase_unit → recipe_unit — three different implementations, see 02]
   → recipe batch cost (ingredients + optionally sub-recipe components)
   → recipe yield (recipes.yield_quantity/yield_unit)
   → cost per produced item — computed 3+ different ways depending on the page (see 02)
   → menu_items.price (set manually by the owner, NOT derived from cost)
   → customer places order (public cart.js) → orders + order_items (price frozen as price_at_purchase/line_total)
   → admin marks order "completed" (admin-orders.js) → sales + sale_items row created,
     snapshotting revenue from orders.subtotal and cost from the *current* recipe_costs/
     packaging_profile_costs at that moment
   → admin-sales.js / admin-analytics.js read only from sales/sale_items from then on
```

This is the intended design, and the "freeze cost and price at sale time" idea is sound. The calculation audit (`02`) documents where this pipeline actually breaks — most importantly, that **the frozen `sales.revenue` value and the frozen `sales.profit` value are computed from two different bases** whenever an order contains a Mix & Match "builder" product, so they silently disagree with each other from the moment the sale is created.

## 7. Diagnostics run during this audit

- No `package.json`/build/lint/test config exists, so no build, lint, type-check, or test command could be run.
- `node --check` (syntax-only, no execution) was run against every file in `js/*.js`: **all pass except `js/admin.js`**, which has a syntax error (see §5). This is a read-only static check; nothing was executed against the live database.
- Verified every local `<script src>`/`<link href>` reference across all HTML files resolves to a real file, except `css/production.css` (missing, see §5).
- The live Supabase project **was** subsequently inspected directly (read-only) via the Supabase MCP tools — schema, views, functions, triggers, RLS policies, grants, and the security/performance advisors. See §8.

## 8. Database verification (2026-08-17) — method and scope

Using the Supabase MCP tools connected to this project (`fbfvqiuhwqfhhxufgmla`), the following was inspected **read-only**: `list_tables` (full column/FK/PK detail), `information_schema.views` (full definitions of `recipe_costs` and `packaging_profile_costs`), `pg_proc`/`pg_get_functiondef` (full source of every `public` function), `information_schema.triggers`, `pg_policies` (every RLS policy), `information_schema.role_table_grants` (view-level grants), and both the `security` and `performance` advisors. A handful of aggregate, non-identifying queries were also run directly against `sales`/`sale_items`/`order_items` to empirically confirm the Mix & Match finding — every such query selected only IDs and money/quantity columns, never `customer_name`, `customer_email`, or `customer_phone`. **No writes, migrations, policy changes, or function deployments were made.**

### What this confirmed was already right in the first pass of this audit
- The overall architecture, page inventory, dead-code findings (§5), and the CSS/UX audits in `04`/`05` — nothing here required correction.
- The Mix & Match revenue/profit gap (`02-calculation-audit.md` §5) — confirmed **exactly** as described, and now quantified: see `03-bug-register.md` BUG-01.
- `complete_production`'s inventory-deduction logic — confirmed correct (row-locked, floors at zero, refuses to double-run).

### What this corrected
- **`recipe_costs` is a well-built, recursive view** that *does* correctly walk `recipe_components` (with cycle protection) and *does* correctly convert mass, volume, and count units. The client-side Inventory tab's cost display is still wrong (it only sums direct ingredients with mass-only conversion), but the canonical cost figure used everywhere else — Menu, sale creation, Sales, Analytics — was never affected by that gap. This substantially narrows BUG-04's blast radius; see `02-calculation-audit.md` §2 and `03-bug-register.md` BUG-04.
- **`packaging_profiles.id` is `bigint`, not a UUID.** The original hypothesis in BUG-03 (that `Number(profileId)` in `admin-menu.js` silently zeroes out every packaging cost) does not hold up — bigint IDs serialize as ordinary JSON numbers, so the cast is a harmless no-op, not a live bug. It remains a real, worth-fixing code-style inconsistency (three different ID-casting conventions for the same lookup across three files) — see `02-calculation-audit.md` §3 and the downgraded `03-bug-register.md` BUG-03.
- **The volume/count gap in `admin-inventory.js`'s `convertUnit()` (BUG-05) currently has zero live impact.** Every ingredient in the live data uses `recipe_unit`/`purchase_unit` of only `g`, `kg`, `lb`, `oz`, or `each` (with every `each`-unit ingredient purchased and used in the same unit, hitting the function's trivial same-unit branch). The gap is real and should still be fixed, but it is not corrupting any number today.

### New findings this pass surfaced (not visible from source code alone)

**Critical — Row Level Security is disabled on `public.orders` and `public.order_items`, despite admin-only policies existing for both.** Every other table in the schema correctly restricts writes/reads to the `authenticated` role. `orders` and `order_items` have policies defined with exactly that intent ("Admins can view/update/delete orders", "Public can create orders") — but RLS itself was never turned on for these two tables, so **those policies are not enforced at all**. Since the app's anon key is embedded in the public site's JavaScript (`js/supabase.js`, loaded by every visitor's browser), this means, right now, **any internet visitor can read every customer's name, email, phone number, and order history directly from the Supabase REST API, and can also modify or delete any order or order line — with no login required.** This is unrelated to the calculation bugs found earlier and needs to be treated as the single highest-priority item to come out of this entire audit. See `03-bug-register.md` BUG-16 for the full detail and the remediation SQL (not applied).

**High — two `SECURITY DEFINER` functions are callable by anyone, unauthenticated.** `complete_production(...)` (deducts real inventory and marks a production date complete) and `end_current_ballot(...)` (archives the active ballot) both run with elevated database privileges and are exposed at `/rest/v1/rpc/...` to the `anon` role. An anonymous visitor could call either directly, bypassing the admin login and the UI entirely — for `complete_production`, that means falsifying inventory levels or marking arbitrary dates "produced." See `03-bug-register.md` BUG-17.

**High — the `recipe_costs` and `packaging_profile_costs` views grant full `SELECT` (and, oddly, `INSERT`/`UPDATE`/`DELETE`, which have no effect against a view with no `INSTEAD OF` trigger but are still an unusual grant to see) to the `anon` role**, and both are flagged `SECURITY DEFINER` by the advisor. In practice this means anyone can query the bakery's internal ingredient cost, recipe cost, and packaging cost figures — commercially sensitive numbers — without logging in. See `03-bug-register.md` BUG-18.

**Medium — no currency or exchange-rate columns exist anywhere in the schema.** Directly relevant to the owner's confirmed design (customers pay in EUR, Sales/Analytics report in USD, historical sales must freeze their exchange rate). Nothing in the database supports this yet — it has to be added as new schema before that design can be implemented. See `02-calculation-audit.md` §11 for the evaluated design and `03-bug-register.md` BUG-19.

**Low — minor hardening items:** `gallery_items` has RLS enabled with zero policies (currently fully locked, consistent with the page being unbuilt); leaked-password protection is disabled in Supabase Auth; several foreign keys lack a covering index (informational, no current performance impact at this data volume — 34–136 rows per table); `menu_items`/`reviews`/`suggestions` each have two overlapping "permissive" SELECT policies for `authenticated`, which is a harmless but avoidable extra policy evaluation per query.

## 9. Remaining uncertainty after database verification

- **`sale_items`/`sales` currently have no server-side trigger preventing a client from re-editing them after creation.** Nothing does this today (confirmed via `information_schema.triggers` — the only trigger in the whole schema is an `updated_at` bookkeeping trigger on `packaging_profiles`), so historical-sale immutability is enforced entirely by *convention* in `admin-orders.js`, not by the database. This isn't a bug — nothing in the app currently edits a completed sale — but it's worth knowing it isn't structurally guaranteed if that ever changes.
- **Whether the two RPC-exposure gaps (BUG-17) have actually been exploited** cannot be determined from a schema/policy inspection alone — that would require reviewing Supabase's request logs, which was not part of this pass.
- **The exact PostgREST wire-format for `bigint` values could not be observed directly** (doing so would have required an authenticated REST call with custom headers, outside this tool's reach) — the "safe no-op" conclusion for BUG-03 rests on documented PostgREST behavior plus the confirmed fact that every real ID in this schema is a small integer well within safe-integer range, not on a byte-for-byte capture of the API response.
