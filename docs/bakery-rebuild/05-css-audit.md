# 05 — CSS Audit

Two stylesheets exist: `css/style.css` (public site, 1,724 lines) and `css/admin.css` (admin dashboard, 5,106 lines, loaded by all 12 admin pages plus `admin.html`). This audit focuses on `admin.css`, since the public site's styling is explicitly out of scope for changes (per `00-project-constraints.md`) — but see §5 for a brief note on `style.css` too.

## 1. Confirmed pattern: new rules appended to the end of the file instead of edited in place

This is exactly the failure mode the owner described, and it's directly visible at the tail of `css/admin.css`:

- Lines 1–5093 are conventionally formatted (one declaration per line, blank lines between rules, 67 section comment headers throughout).
- **Line 5094** is a single, ~9,000-character **minified** line containing the entire `.production-*` rule set (`.production-page`, `.production-hero`, `.production-kpi-grid`, `.production-card`, etc. — dozens of selectors) — visually and stylistically nothing like the rest of the file. This is the CSS that actually styles `admin/production.html`.
- **Immediately after that** (lines 5096–5106), two more `.production-category`/`.production-category-title` rules appear, back in normally-formatted (non-minified) style — a *second*, later addition stacked on top of the first.
- `admin/production.html` itself links to `css/production.css`, which **does not exist in the repository** (confirmed: `css/` contains only `admin.css` and `style.css`). The real styles for that page were pasted into the end of `admin.css` instead of into the file the page actually asks for. The page still renders correctly today only because it also loads `admin.css`, which happens to contain the rules anyway — this is fragile, not intentional.
- The final, appended `.production-category-title` rule references `border-bottom: 1px solid var(--border-color)` (`css/admin.css:5104`) — but `--border-color` **is never defined anywhere in `admin.css`**. The file's actual token is `--line: #e8ddd4` (`css/admin.css:25`). This declaration is silently invalid and the border does not render as intended.

## 2. Confirmed duplicate selector definitions (same class, defined twice, later one wins/partially overrides)

Grepping `admin.css` for repeated top-level selectors surfaces multiple concrete conflicts, not just the production block above:

| Selector | Defined at | Conflict |
|---|---|---|
| `.overview-card` | line 194 **and** line 1927 | First: `border-radius:20px; padding:28px; border:1px solid var(--line)`. Second (~1,700 lines later): `border-radius:22px; padding:24px; border:1px solid #ead9cd` (a literal hex color, not the `--line` token — and a *different* shade: `#e8ddd4` vs `#ead9cd`), plus a `:hover` transform effect the first definition never had. The second definition silently wins for every shared property. |
| `.dashboard-card` | line 2063 **and** line 4872 | First: `border-radius:22px`. Second (~2,800 lines later): `border-radius:18px` — a direct, silent conflict — plus a new `:hover` scale effect and `transition` the first block didn't define. |
| `.modal-card` | lines 539, 774, **and** 1058 | Defined three separate times. |
| `.primary-btn` | lines 830, 1122, **and** 1131 | Defined three separate times (one as part of a combined selector list, two standalone). |
| `.sidebar-nav a` | lines 1634 **and** 1786 | Defined twice. |
| `.logout-btn` | lines 272 **and** 1816 | Defined twice. |

This is not an exhaustive list — it's a representative sample obtained by spot-checking the most structurally important, most-reused class names (cards, buttons, nav, modals). **A full duplicate-selector census should be the first concrete step of any CSS cleanup phase** (mechanical, low-risk, and it will very likely surface more pairs like the ones above).

## 3. Design tokens vs. hard-coded values

- `:root` in `admin.css` defines five custom properties: `--background`, `--card`, `--accent`, `--line`, `--text` (`css/admin.css:17-27`).
- Large parts of the file (including, as shown above, some of the *duplicate* rules) bypass these tokens entirely and hard-code hex values instead — `#ead9cd`, `#7b2b22`, `#5d2018`, `#8d786b`, etc. appear directly in dozens of rules rather than through a variable. This means a future brand/color tweak (which the owner may want as part of "restrained polish") would require a find-and-replace across many hard-coded hex values instead of editing a handful of `:root` tokens — exactly the kind of thing CSS custom properties exist to prevent.
- `css/style.css` (public site) defines a **completely separate** token set with different names (`--background`, `--surface`, `--burgundy`, `--burgundy-light`, `--text`, `--muted`) and different values from `admin.css`'s tokens of similar names. This isn't inherently wrong — the admin dashboard and public site are allowed to look different — but it means there is currently no shared design-token layer between the two, which is worth deciding on deliberately if the rebuild wants the admin dashboard to feel like part of the same brand as the public site rather than a separate app bolted on.

## 4. Other observations

- Inline `style="..."` attributes are rare and mostly limited to simple `display:none`/`display:block` visibility toggles set from JavaScript (a handful in `admin/inventory.html`, `admin/orders.html`, `admin/subscribers.html`, `admin/reviews.html` (public), and `admin.html`) — not a significant source of specificity conflicts, and not something this audit recommends touching (per the "do not delete CSS" constraint, and because these are functional, JS-driven toggles, not leftover styling cruft).
- `!important` usage exists (at least one confirmed instance: `max-width:320px !important; max-height:320px !important;` immediately before the `.dashboard-card` redefinition at line 4872) — a common symptom of fighting an earlier, un-edited rule rather than fixing it at the source, consistent with the overall pattern in §1–2.
- No CSS preprocessor, no build step, no minifier is in use for the hand-formatted majority of the file — the one minified block (§1) was minified by whatever tool/process produced it, not by the project's own tooling (there isn't any), reinforcing that it was pasted in from somewhere else rather than authored in place.
- 67 section comment headers exist in `admin.css`, suggesting the file *was* originally organized by section — the duplicates and the appended block are drift away from that original structure, not evidence it was never organized at all. A cleanup pass should be able to re-home the appended/duplicate rules into their correct existing sections rather than starting from scratch.

## 5. `css/style.css` (public site) — brief note only

Per project constraints, no public-facing CSS changes are in scope right now. For completeness: `style.css` is smaller (1,724 lines), has fewer section comments (11) than `admin.css`, and does **not** show an obvious end-of-file minified dump the way `admin.css` does. A targeted duplicate-selector check on a handful of common class names (`.hero`, `.nav-links`, `.btn`, `.footer`) did not turn up the same pattern seen in `admin.css`. This should not be read as a full audit of `style.css` — it was intentionally not a focus of this pass — only as reassurance that the specific failure mode described by the owner appears to be concentrated in the admin stylesheet.

## 6. Recommended remediation approach (for the phased plan, not executed now)

1. Run a full duplicate-selector census across `admin.css` (mechanical — every top-level selector, every line it's defined on).
2. For each duplicate, determine which definition is actually "live" (the later one, per normal CSS cascade, assuming equal specificity) and fold the two into one correct rule in the original, correctly-organized location — rather than deleting either blindly, since some later blocks add legitimately new properties (like the `:hover` effects) that should be kept.
3. Move the appended `.production-*` block (§1) out of its dumped location and either merge it into the existing `.production-` adjacent sections in `admin.css`, or actually create `css/production.css` and point `admin/production.html` at real content — owner's call, documented as an open question in the final summary.
4. Fix the undefined `var(--border-color)` reference once its home is decided.
5. Only after the duplication is resolved, consider consolidating hard-coded hex values back onto the existing `:root` tokens.

No CSS was deleted, moved, or edited to produce this audit, per the phase-0 constraints.
