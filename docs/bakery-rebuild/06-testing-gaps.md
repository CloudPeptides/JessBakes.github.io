# 06 — Testing Gaps & Diagnostics

## 1. What exists today

**Nothing automated.** Confirmed by direct inspection of the repository:

- No `package.json` anywhere in the repo → no npm scripts, no declared dependencies, no test runner, no linter, no formatter, no bundler/build step.
- No `.eslintrc*`, `tsconfig*`, or any `*.config.js` file.
- No files matching `*test*` anywhere in the repo.
- No `.github/` directory or any CI workflow file.
- No `.sql` migration files — the database schema exists only inside the live Supabase project and cannot be diffed, tested, or version-controlled from this repository as it stands.

All two "libraries" the app depends on (`@supabase/supabase-js@2`, Chart.js) are loaded from a CDN at runtime with **no version pin** (`@2` for Supabase means "latest v2.x", Chart.js has no version specifier at all) — meaning the app's behavior can change without any commit to this repository if either CDN package ships a new release. This is itself a testing/stability gap worth flagging even though it isn't a "test."

## 2. Diagnostics actually run during this audit (read-only)

| Diagnostic | Result |
|---|---|
| `node --check` (syntax-only parse, no execution) against every file in `js/*.js` | **All pass except `js/admin.js`**, which fails with a syntax error at line 225 (see `03-bug-register.md` BUG-07). This file is currently unreferenced by any HTML page, so the error has no live effect today. |
| Verified every local `<script src>` / `<link href>` in every HTML file resolves to a real file | **One broken reference found:** `admin/production.html` links `css/production.css`, which does not exist (BUG-09). |
| Attempted `npm`/build/lint/test commands | None exist to run — confirmed by absence of `package.json` and any config file. |
| Live Supabase schema/RLS/views/RPC inspection | **Completed 2026-08-17**, via the Supabase MCP tools connected to this project (read-only: `list_tables`, `information_schema.views`/`triggers`/`role_table_grants`, `pg_proc`/`pg_get_functiondef`, `pg_policies`, `pg_constraint`, plus the security and performance advisors). Findings folded into `01-architecture-and-data-flow.md` §8, `02-calculation-audit.md`, and `03-bug-register.md` (BUG-16 through BUG-21). No writes, migrations, policy changes, or function deployments were made. |
| Supabase security & performance advisors (`get_advisors`) | **Run 2026-08-17.** Surfaced BUG-16 (RLS disabled on `orders`/`order_items`), BUG-17 (two `SECURITY DEFINER` RPCs callable by `anon`), BUG-18 (cost-data views readable by `anon`), plus lower-priority hardening/performance notes (BUG-21). Per Supabase's own guidance, this should be run again after any schema change, and ideally on a recurring basis regardless — it is a genuine, low-effort diagnostic this project should use going forward, not a one-time audit artifact. |
| Browser rendering / visual QA / accessibility scan | **Not performed.** This audit is a static code review; no page was rendered in a browser, so CSS layout correctness, color contrast, and actual mobile behavior are not verified — only inferred from the source. |

No dependencies were installed, removed, or upgraded, and no database writes/migrations/policy changes were made, to produce any of the above, per the phase-0 (and this pass's inspect-only) constraints.

## 3. Missing tests that matter most

Given the calculation audit's findings, an automated test suite (even a minimal one) would have caught several of the highest-severity bugs immediately. In priority order, the rebuild should add coverage for:

1. **Unit conversion** (`convert`/`convertUnit` equivalents): every supported unit pair, every unsupported pair (should fail loudly, not silently return 0), and the currently-divergent behavior between `admin-inventory.js` and `admin-production.js` (BUG-05) — this alone would have caught the gap before it shipped.
2. **Recipe costing, including sub-recipes**: a recipe with only direct ingredients, a recipe with one level of sub-recipe, and a recipe with a circular component reference (the production page already detects and warns about cycles — that logic deserves a test) (BUG-04).
3. **Sale creation from an order** (`createSaleFromOrder`): the single most important function to test given BUG-01. A test asserting `sales.revenue === sum(sale_items.line_revenue) + (sum of any un-itemized revenue)` for every order shape — standard-only, builder-only, and mixed — would fail today and pinpoint exactly this bug.
4. **Profit/margin math**: `profit = revenue - cost`, `margin = profit / revenue`, computed once from a shared function and asserted identical across Production, Sales, and Analytics for the same underlying order set — today there is no such shared function, so there is nothing to even point a test at (this is itself a finding: the fix for BUG-01/BUG-06 should produce one function worth testing, not more copies).
5. **Currency formatting**: one shared formatter, one test, asserting every page that displays money uses it (would have caught BUG-06 immediately and would prevent regression).
6. **ID/key-type consistency** for map lookups like `packaging_profile_costs` (BUG-03) — a test that inserts a real (string/UUID-shaped) ID and asserts the lookup succeeds would have caught this before it shipped.
7. **Order editing round-trip**: save an order with a builder product, reload it into the edit form, save again, assert nothing was lost (BUG-02).
8. **Delete-with-dependents guard**: deleting an ingredient/recipe that's referenced elsewhere should either warn or be safely handled — currently untested and, per BUG-14, unverified even at the database level.

## 4. Testing infrastructure gap, not just test-case gap

Because there is no build step and everything is loaded via global `<script>` tags with implicit shared globals (functions attached to `window`, `supabaseClient` as a bare global), introducing a conventional test runner (Jest/Vitest) will require either:
- extracting the pure calculation logic (unit conversion, cost/profit math) into standalone modules that can be imported and tested without a DOM/Supabase connection, or
- standing up a lightweight integration-test harness against a Supabase test project.

The first approach is lower-risk and directly supported by the recommended "shared calculation utilities" consolidation in `07-phased-implementation-plan.md` — pulling the money math into pure, dependency-free functions is both the correctness fix and the thing that makes it testable.
