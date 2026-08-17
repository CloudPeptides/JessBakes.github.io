# 07 — Phased Implementation Plan

**Update 2026-08-17: Phase 1 (BUG-01), Phase 2, Phase 3 (currency), BUG-23, and Phase 4 (admin reorganization/CSS refactor) have all been executed and verified live** — see `03-bug-register.md` for per-bug status, `09-bug01-regression-report.md` for the Phase 1 backfill detail, `02-calculation-audit.md` §13 for the Phase 3 currency design detail, and `04-admin-ux-audit.md`/`05-css-audit.md` for the Phase 4 detail. Specifically done: BUG-01 (Phase 1A + 1B), BUG-02/03/04/05/12/13/14/20/22 (Phase 2), BUG-06/19 (Phase 3 currency design) and BUG-23 (Production currency fix), and BUG-07/08/09/11 (Phase 4 — the admin dashboard reorganization: one shared, grouped, mobile-responsive navigation module replacing 13 hand-copied nav blocks; a CSS refactor consolidating 108 duplicate selector groups, fixing a real unclosed-`@media` bug that had silently disabled ~1,100 lines of Dashboard CSS at desktop widths, and removing confirmed dead admin.js-era selectors; the stranded production CSS moved into a real `css/production.css`; `js/admin.js` deleted after confirming zero references). Deliberately **not** done: BUG-10 (a JS-level de-duplication, not a navigation/CSS concern), BUG-21 (minor Supabase hardening, unrelated), and the broader per-page component/JS-behavior rework §2-§4 of `04-admin-ux-audit.md` describe (modal/accordion unification, semantic tables, inline form validation) — those remain open for a future pass. The plan below is preserved as originally written for the remaining phases.

This was originally a proposed order of operations for a **future** phase, once the owner answered the open questions raised in the calculation audit. It was sequenced to fix the highest-confidence, highest-severity money problems first, with the smallest, most reversible changes before anything structural.

## Guiding principles for the repair phase

- Fix correctness before organization: get the numbers right before rearranging pages/CSS around them.
- Prefer **one shared function** over **fixing N copies** wherever this audit found duplicated logic — every duplication found here (unit conversion, cost calculation, currency formatting, ballot manager, pending-reviews) is an opportunity to delete code, not just patch it.
- Never touch public-facing design in the same pass as an admin fix, even when it's tempting (e.g. the currency-formatter consolidation should not accidentally restyle anything on `index.html`/`menu.html`).
- Every phase below should ship independently reviewable and, ideally, with the test coverage recommended in `06-testing-gaps.md` added alongside the fix it's protecting — not bolted on afterward.

## Phase 0 — Zero-risk cleanup (can happen anytime, essentially no behavior change)

1. Remove or archive `js/admin.js` (dead, unreachable, doesn't parse — BUG-07) and the leftover markup it drove in `admin.html` (BUG-08).
2. Remove the unused `calculateSaleCost()` from `admin-sales.js` (BUG-12), or explicitly repurpose it later as the "shared cost function" described in Phase 1 rather than leaving it as an unsafe, unused trap.
3. Remove the two leftover `console.log` debug statements in `admin-sales.js` (BUG-13).
4. Fix `admin/inventory.html`'s sidebar so it matches every other page's nav order and includes the missing Subscribers link.
5. Resolve the `css/production.css` 404 (BUG-09) — either create the file with the content currently stranded at the end of `admin.css`, or remove the broken `<link>` once that CSS's real home is confirmed safe in `admin.css`.

**Owner approval needed before deleting anything** — this phase is proposed as "safe" but still touches source files, which is out of scope for the current audit-only engagement.

## Phase 1 — Core money correctness (the highest-value work)

Blocked on the owner answering the open questions in `02-calculation-audit.md` §10. Once answered:

1. **Confirm the real column type** behind `packaging_profiles.id` / `packaging_profile_costs.id` (BUG-03) and standardize every lookup in the codebase on one consistent key type.
2. **Decide and implement the correct builder-box revenue/profit behavior** (BUG-01) — likely candidates: insert a synthetic `sale_items` row for the box itself carrying its own revenue, or change `sales.profit`'s calculation to derive from `sales.revenue` (already correct) rather than re-summing `sale_items.line_revenue`. Either fix should be paired with the "sale creation" test recommended in `06-testing-gaps.md` §3.
3. **Build one shared unit-conversion utility** (mass + volume + count, matching `admin-production.js`'s more complete `convert()`, with explicit "cannot convert" signaling rather than silent zeros) and point every current call site — `admin-inventory.js`, `admin-production.js`, `packaging.js` — at it (BUG-05).
4. **Build one shared recipe-costing function** that correctly walks `recipe_components` recursively (matching `admin-production.js`'s recursive logic, with cycle detection) and use it everywhere a recipe's cost is shown, including the Inventory tab (BUG-04). Decide, with the owner, whether this should live client-side or be reconciled against/replace the `recipe_costs` Postgres view so there is truly one source of truth instead of a client copy that has to agree with a hidden server copy.
5. **Pick one currency and one formatting function** (`euro()`, almost certainly, given it's already the majority convention) and replace every `usd()`/mixed-symbol usage (BUG-06).
6. Add the delete-safeguard checks for ingredients/recipes still in use (BUG-14), after confirming what the database actually does today (hard fail vs. silent orphan).

## Phase 2 — De-duplication and shared components

1. Consolidate the duplicated pending-reviews logic (`admin-dashboard.js` vs. `admin-reviews.js`, BUG-10) into one shared module used by both.
2. Consolidate the three independently-built expand/collapse implementations (`admin-inventory.js`, `admin-orders.js`, `admin-suggestions.js`) into one shared accordion behavior.
3. Consolidate the per-page modal-building pattern (`buildXModal()` repeated across `admin-inventory.js`, `admin-menu.js`, `packaging.js`) into a shared modal helper, so things like "Escape closes the modal" become guaranteed everywhere instead of accidental.
4. Add the order-editor support for Mix & Match builder products (BUG-02), or explicitly disable editing on orders containing them with a clear message, whichever the owner prefers as an interim step.
5. Decide the discounts/taxes/refunds/waste scope question (BUG-15) and, if in scope, design the schema/UI additions deliberately rather than bolting them onto the existing revenue math.

## Phase 3 — Admin organization, navigation, and CSS cleanup

This is the "major improvement in organization, appearance, usability" work the owner asked for, sequenced last because it's safest to do once the underlying numbers and shared logic (Phases 1–2) are stable — restructuring pages around numbers that are about to change is wasted effort.

1. Extract the sidebar/nav into one shared template/include (or at minimum one shared JS-rendered component) so it can never drift per-page again the way `admin/inventory.html` did.
2. Regroup the sidebar navigation around the workflow the owner actually uses (this needs the owner's input on how they think about their own workflow — this audit can describe the current structure but shouldn't presume the ideal one).
3. Run the CSS duplicate-selector census recommended in `05-css-audit.md` §6 and fold every duplicate/appended block back into its correct, organized location.
4. Consolidate hard-coded colors back onto the existing `:root` design tokens in `admin.css`.
5. Only after the above: visually verify mobile/responsive behavior on real devices and address any gaps found (not assumed from source alone, per `04-admin-ux-audit.md` §7).
6. Replace `alert()`-based error/validation messaging with consistent in-page messaging (the pattern `admin-sales.js`/`admin-analytics.js` already use for load errors is a reasonable model to extend).

## Phase 4 — Testing & guardrails

Ideally interleaved with Phases 1–2 rather than strictly after them, but called out separately because it's a different kind of work:

1. Extract the newly-shared calculation functions (unit conversion, recipe cost, sale creation, currency formatting) into standalone modules that don't require a live DOM/Supabase connection to test.
2. Add the specific test cases enumerated in `06-testing-gaps.md` §3, prioritizing the sale-creation and unit-conversion tests since those map directly to the two highest-confidence bugs found in this audit.
3. Pin the CDN dependencies (`@supabase/supabase-js`, Chart.js) to specific versions rather than "latest," so behavior can't change without a commit.

## What this plan deliberately does not include

- Any public-facing design change (explicitly out of scope per project constraints).
- Any new logo, illustration, or generated graphic (explicitly forbidden per project constraints).
- A framework migration (React, a bundler, TypeScript, etc.) — not recommended to bundle into a "repair" project; if desired, it should be its own deliberate, separately-scoped decision after the current architecture is at least internally consistent.
