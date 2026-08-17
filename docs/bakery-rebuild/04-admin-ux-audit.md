# 04 — Admin UX Audit

## 1. Navigation

- The sidebar (`<nav class="sidebar-nav">`) is **hand-copied into all 12 admin HTML files** — there is no shared header/nav include, template, or component. Every future nav change (add a page, reorder, rename) has to be made 12 times by hand.
- **Concrete bug found from this duplication:** `admin/inventory.html`'s copy of the sidebar is out of sync with every other page:
  - Every other admin page orders the second nav group as `Production, Sales, Analytics, Inventory, Packaging, Subscribers, Gallery`.
  - `admin/inventory.html` instead orders it `Packaging, Production, Sales, Analytics, Inventory, Gallery` — **and the "Subscribers" link is missing entirely.** From the Inventory page, there is no way to reach the Subscribers page via the sidebar without first going back to Dashboard (or any other page) and clicking through from there.
- Only `admin/dashboard.html`'s nav has `aria-label="Admin navigation"` on the `<nav>` element; every other page's copy of the same nav omits it (inconsistent, minor accessibility gap — see §5).
- There is no breadcrumb, no "you are here" beyond the `.active` class on the current sidebar link, and no way to collapse the sidebar on smaller screens.
- The sidebar mixes operationally different kinds of pages with no visual grouping beyond two `<hr>` dividers: customer-facing content management (Menu, Reviews, Suggestions), financial/operational tooling (Production, Sales, Analytics, Inventory, Packaging), and site administration (Subscribers, Gallery, Settings) all read as one flat list. A rebuild should group these more legibly (this is the core of what the owner asked for — "major improvement in organization").

## 2. Page-level structure and consistency

- Every admin page rebuilds its own header (`<header class="admin-header">`), its own overview KPI cards (`.overview-grid` / `.overview-card`), and its own modal(s) from scratch in JavaScript. The **visual** language is shared (same CSS classes), but the **implementation** is not — seven separate `buildXModal()` functions exist across `admin-inventory.js`, `admin-menu.js`, `admin-production.js` (none, uses fixed sections instead), `packaging.js`. This is fine for the user experience today but makes consistent behavior (e.g. "Escape closes the modal") an accident of which page you're on rather than a guarantee: `admin-menu.js` explicitly wires `Escape` to close its modals (`js/admin-menu.js:21-27`); `admin-inventory.js` and `packaging.js` do not.
- Three separate, independently-written expand/collapse ("accordion") implementations exist for conceptually the same interaction:
  - `admin-inventory.js` `toggleInventoryCategory()` — animates `max-height`/`opacity` via `requestAnimationFrame`.
  - `admin-orders.js` `toggleOrderSection()` — instantly flips `display: none/block`, no animation.
  - `admin-suggestions.js` `toggleSuggestionSection()` — same instant-toggle pattern, written separately.
  This means the same kind of "expand this group" click feels different depending on which page it's on.
- "Estimated profit" color-coding exists only on the Menu page (`profitClass`: red under €5, yellow under €8, green above — `js/admin-menu.js:242-248`), with thresholds that are not explained anywhere in the UI and are not reused on Production's or Sales'/Analytics' own profit figures, even though those pages show conceptually the same "is this healthy" signal (Production's ingredient/packaging stock status: good/low/short/unknown). The visual vocabulary for "good vs. concerning" is not shared across the dashboard.

## 3. Tables and data display

- There are effectively **no semantic `<table>` elements** in the admin dashboard. Every list — ingredients, recipes, orders, sales, the Sales page's "Monthly Revenue"/"Product Breakdown" grids — is rendered as stacks of `<div>`s laid out with CSS Grid/Flexbox (`.sales-table-row`, `.customer-details`, card grids). This means:
  - No native table semantics for assistive technology (no `<th scope>`, no row/column relationships announced).
  - No column sorting, filtering by column, or resizing without custom-building it — none of that exists today.
- No list on any admin page is paginated. Orders, Sales' "Recent Sales" (client-side sliced to 10, but the whole dataset is still fetched), Subscribers, and Reviews all fetch and render their **entire** table in one request with no limit and no virtualization. This will get slow as the bakery accumulates history; today's data volume likely hides it.
- Search exists only on the Inventory page (`#inventorySearch`, filters by ingredient name only). No other list (orders, sales, subscribers, recipes) is searchable or filterable beyond the fixed status/date-range buttons that already exist on Orders/Sales/Analytics.

## 4. Forms and validation

- Validation is universally done **after** the user clicks Save, via sequential `alert()` calls (e.g. `saveIngredient()` in `admin-inventory.js:635-643`: checks name, then checks units, each with its own blocking `alert()`). There is no inline "this field is required" messaging, no field highlighting, and required fields are not visually marked in most forms (a few native `required` attributes exist on the public checkout form and login form, but almost none of the admin CRUD modals use HTML5 `required`).
- Every list-mutating action that can fail (save ingredient, save recipe, save menu item, save packaging profile, update order status, approve/delete review, etc.) reports failure via `alert(error.message)`, which surfaces the **raw Supabase/PostgREST error string** directly to the admin user (e.g. a raw constraint-violation message) instead of a friendly, actionable message. This is consistent at least (same pattern everywhere), but it's a consistent usability problem, not a consistent strength.
- Destructive actions (delete ingredient/recipe/menu item/order/review, remove ballot option) all use the native `confirm()` dialog. Consistent, but native confirm dialogs can't be styled to match the bakery's branding and read as jarring/generic, especially on mobile.

## 5. Accessibility

- `aria-label` usage is sparse and inconsistent: present on the dashboard's main nav and on some modal close buttons (e.g. `packaging.js`'s close button has `aria-label="Close"`), absent on others (`admin-menu.js`/`admin-inventory.js` modal close buttons are bare `✕` with no label — a screen reader announces only "button, cross mark" or similar, not "Close").
- No skip-to-content link on any admin page.
- KPI icon images (`../images/*_dino.png` on the dashboard) correctly use empty `alt=""`, consistent with them being decorative — this one is done right.
- Color contrast, focus order, and keyboard-only operability were **not verified** in this audit (no browser rendering was performed) — recommended as a follow-up pass once the CSS/organization work begins, not something to infer from source alone.
- Status/severity is communicated primarily through color (green/yellow/red badges for stock status, profit color-coding) with text labels alongside in most places (e.g. "Enough"/"Low after bake"/"Short" text next to the colored badge in Production) — this is good practice and should be preserved.

## 6. Loading, empty, and error states

- **Loading states:** present and reasonably consistent — most containers show literal `Loading...` text while a fetch is in flight (Dashboard panels, Inventory tabs, Menu manager, Production's `loading()` helper which blanks nine containers at once). Not a design system (no skeleton loaders/spinners), but functionally present everywhere that matters.
- **Empty states:** generally present and worded per-page ("No recipes yet.", "Everything is stocked.", "No pending reviews.", "No completed sales in this period.") — a genuine strength, this pattern is consistent and should be kept.
- **"Coming Soon" pages:** Gallery and Settings are both real nav destinations that lead to a single "Coming Soon" paragraph with no actual functionality (`admin/gallery.html`, `admin/settings.html`). This isn't a bug, but it does mean 2 of the 13 sidebar links currently lead nowhere functional — worth deciding whether to keep them visible in the nav pre-launch or hide them until built.
- **Error states:** as noted in §4, error handling defaults to `alert()` with a raw backend error message almost everywhere. A small number of pages (Sales, Analytics) do render an in-page error message instead of an alert (`showSalesError()`, `showAnalyticsError()`), which is the better pattern — it is simply not used consistently across the rest of the dashboard.

## 7. Mobile / responsive behavior

- `css/admin.css` does contain responsive breakpoints (`@media (max-width: 1250px/900px/600px)` were found in the Production section and elsewhere in the file), so some responsive behavior exists.
- This audit did not render any page in a browser, so actual mobile behavior (does the sidebar collapse usably, do the 4–5-column KPI grids reflow cleanly, are the card-grid "tables" usable at narrow widths) was **not visually verified** and should be spot-checked with real devices/DevTools before or during the rebuild rather than assumed from the CSS alone.
- The production, sales, and analytics pages in particular pack a lot of KPI cards and multi-column grids into a single view (`production-kpi-grid` at up to 5 columns, `production-main-grid` at 2 columns) — these are the pages most likely to need real mobile-specific layout work, given how dense they are even before considering a phone-width viewport.

## 8. What's working and should be preserved

- The empty-state and loading-state copy is genuinely good — friendly, specific, on-brand ("Everything is stocked.").
- The overall visual language (cream/burgundy palette, rounded cards, soft shadows) is coherent and consistent across the admin dashboard, even where the underlying code is duplicated.
- Historical sale data is (mostly, see BUG-01) frozen at completion time rather than recalculated live — the right instinct for a financial dashboard.
- Confirmation dialogs are used consistently before every destructive action.
