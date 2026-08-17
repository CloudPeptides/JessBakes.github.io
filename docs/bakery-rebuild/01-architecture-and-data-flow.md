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

All business logic — cost math, unit conversion, margin calculation, production planning — therefore lives **in the browser**, scattered across per-page JavaScript files, not in a shared library and not in the database (with one exception: `recipe_costs` and `packaging_profile_costs` appear to be **Postgres views or computed tables**, since nothing in the repo ever writes to them — they are only ever `select()`-ed). Because their definitions live in Supabase and not in this repository, **their exact formula cannot be verified from the code** — see the open questions in `02-calculation-audit.md`.

There are two Postgres RPC functions called from the client that also cannot be inspected from the repo:
- `prepare_new_ballot()` — called when starting a new ballot (`js/admin.js`, `js/admin-menu.js`)
- `complete_production()` — called when finishing a production run (`js/admin-production.js`), which is presumably what actually deducts ingredient quantities from inventory.

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

Inferred from every `supabaseClient.from(...)` call across the codebase (no schema file exists in the repo, so table shapes are reconstructed from usage):

| Table (inferred) | Written by | Read by | Role |
|---|---|---|---|
| `ingredients` | `admin-inventory.js` | inventory, packaging, production, menu, sales, orders | Purchase price, purchase size/unit, recipe unit, quantity on hand, minimum quantity, supplier, category. |
| `inventory_categories`, `suppliers` | `admin-inventory.js` | inventory, packaging | Lookup tables. |
| `recipes` | `admin-inventory.js` | inventory, menu, production, sales | Name, category, yield quantity/unit, notes. |
| `recipe_ingredients` | `admin-inventory.js` | inventory, production, sales | Recipe → ingredient → quantity (join row). |
| `recipe_components` | `admin-inventory.js` | inventory, production | Recipe → sub-recipe → quantity + unit (lets one recipe use another recipe as an ingredient, e.g. a filling). |
| `recipe_costs` | **Not written anywhere in this repo — a Postgres view/table** | menu, orders (sale creation), production references it too | Expected to expose `cost_per_yield_item` per recipe. **Formula not visible from the codebase.** |
| `packaging_profiles`, `packaging_profile_items` | `packaging.js` | menu, production, sales, orders | A named bundle (e.g. "Bread Loaf") of packaging/supply ingredients + quantities. |
| `packaging_profile_costs` | **Not written anywhere in this repo — a Postgres view/table** | menu, production, orders | Expected to expose `packaging_cost` per profile. **Formula not visible from the codebase.** |
| `menu_items` | `admin-menu.js` | everywhere | Public product: price, category, `recipe_id`, `recipe_units_used`, `packaging_profile_id`, or (for "builder" Mix & Match products) `builder_group`/`builder_size` instead of a recipe. |
| `orders`, `order_items` | public `cart.js` (customer checkout) and `admin-orders.js` (manual entry/edit) | orders, production, sales-creation | Live order queue. `orders.subtotal` is the order total at the time it was placed. `order_items.builder_details` (JSON) carries the Mix & Match breakdown for builder products. |
| `sales`, `sale_items` | **only** `admin-orders.js`, at the moment an order's status becomes `completed` | sales, analytics | A frozen snapshot meant to preserve the order's financial picture even if recipes/prices change later. |
| `production_runs` | `admin-production.js` (via `complete_production` RPC and a direct `upsert` for the checklist) | production | Per-date checklist + "inventory already deducted" flag. |
| `purchases` | `admin-inventory.js` (restock flow) | (not read back anywhere found) | Purchase log; doesn't appear to feed any report. |
| `ballot_settings`, `ballot_options`, `votes`, `ballot_history` | admin ballot manager, public `ballot.js` | dashboard, menu | Unrelated to cost flow — the "vote for next bread" feature. |
| `reviews`, `suggestions`, `subscribers` | public forms | admin equivalents | Unrelated to cost flow. |

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
- No means exists in this environment to inspect the live Supabase schema, RLS policies, views (`recipe_costs`, `packaging_profile_costs`), or RPC functions (`prepare_new_ballot`, `complete_production`) — everything reported about them here is inferred from how the client code calls them.
