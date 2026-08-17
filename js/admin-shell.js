/* ==========================================
   ADMIN SHELL — shared navigation (Phase 4)
   ==========================================

   Single source of truth for the admin sidebar navigation, previously
   hand-copied into all 13 admin/*.html files (docs/bakery-rebuild/
   04-admin-ux-audit.md §1) with real, confirmed drift between copies
   (admin/subscribers.html was missing Menu/Suggestions/Reviews/Gallery
   entirely). Renders the nav from one shared array into
   <nav class="sidebar-nav">, auto-detects the active page from the URL,
   and wires up a mobile off-canvas toggle.

   Groups navigation logically (Overview / Orders / Production / Catalog /
   Inventory / Sales / Community), per the rebuild's UX goals -- the
   previous flat list mixed customer-facing content, operational tooling,
   and site administration with no visual grouping beyond two <hr>s.

   Pure data/markup-building functions (NAV_GROUPS, currentPageFile,
   renderNavLink, buildNavHtml) have no dependency on the DOM and are
   exported UMD-style (window.AdminShell in the browser, module.exports
   under Node) so they're covered by tests/admin-shell.test.js without a
   real browser. The DOM-touching parts (rendering into a real <nav>,
   wiring the mobile toggle button/backdrop) only run when `document`
   exists, so this file is also safe to load as a plain <script> tag on
   every admin page (and the admin.html login gate, which simply has no
   matching element and no-ops).
   ========================================== */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AdminShell = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const NAV_GROUPS = [
        {
            label: "Overview",
            items: [
                { href: "dashboard.html", label: "Dashboard" }
            ]
        },
        {
            label: "Orders",
            items: [
                { href: "orders.html", label: "Orders" }
            ]
        },
        {
            label: "Production",
            items: [
                { href: "production.html", label: "Production" }
            ]
        },
        {
            label: "Catalog",
            items: [
                { href: "menu.html", label: "Menu" }
            ]
        },
        {
            label: "Inventory",
            items: [
                { href: "inventory.html", label: "Inventory" },
                { href: "packaging.html", label: "Packaging" }
            ]
        },
        {
            label: "Sales",
            items: [
                { href: "sales.html", label: "Sales" },
                { href: "analytics.html", label: "Analytics" }
            ]
        },
        {
            label: "Community",
            items: [
                { href: "reviews.html", label: "Reviews" },
                { href: "suggestions.html", label: "Suggestions" },
                { href: "subscribers.html", label: "Subscribers" },
                { href: "gallery.html", label: "Gallery" }
            ]
        }
    ];

    // Rendered as its own final group, not folded into one of the labeled
    // ones above -- account/system settings, not a workflow area.
    const SETTINGS_ITEM = { href: "settings.html", label: "Settings" };

    /** Extracts the page filename from a URL path, e.g.
     * "/admin/orders.html" -> "orders.html". Defaults to "dashboard.html"
     * for an empty/root path, matching this admin's actual entry point. */
    function currentPageFile(pathname) {
        const path = String(pathname || "");
        const file = path.substring(path.lastIndexOf("/") + 1);
        return file || "dashboard.html";
    }

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function renderNavLink(item, current) {
        const isActive = item.href === current;
        return (
            `<a href="${escapeHtml(item.href)}"` +
            (isActive ? ` class="active" aria-current="page"` : "") +
            `>${escapeHtml(item.label)}</a>`
        );
    }

    /** Builds the full inner HTML for <nav class="sidebar-nav">, given the
     * current page's filename. Pure -- takes a string, returns a string. */
    function buildNavHtml(current) {
        const groupsHtml = NAV_GROUPS.map(group => `
            <div class="sidebar-nav-group">
                <p class="sidebar-nav-group-label">${escapeHtml(group.label)}</p>
                ${group.items.map(item => renderNavLink(item, current)).join("")}
            </div>
        `).join("");

        const settingsHtml = `
            <div class="sidebar-nav-group">
                ${renderNavLink(SETTINGS_ITEM, current)}
            </div>
        `;

        return groupsHtml + settingsHtml;
    }

    /** Every {href, label} entry across every group, including Settings --
     * useful for tests/consistency checks without duplicating the list. */
    function allNavItems() {
        return NAV_GROUPS.flatMap(group => group.items).concat([SETTINGS_ITEM]);
    }

    // ---- DOM wiring (browser only) ----

    function renderNavInto(navEl) {
        const current = currentPageFile(
            typeof window !== "undefined" ? window.location.pathname : ""
        );
        navEl.innerHTML = buildNavHtml(current);
        if (!navEl.hasAttribute("aria-label")) {
            navEl.setAttribute("aria-label", "Admin navigation");
        }
    }

    // Mobile off-canvas toggle: a button + backdrop injected once, wired to
    // toggle a `sidebar-open` class on <body> (see css/admin.css's
    // "Grouped navigation + mobile toggle" section for the responsive CSS).
    // Both are appended to <body> (not .admin-shell, which is a CSS grid --
    // an extra direct child there would become an unwanted third grid
    // item) and are `position: fixed` in CSS, so their DOM placement
    // doesn't affect the shell's 2-column layout at all. The toggle state
    // lives on <body> specifically so body-level siblings (the backdrop,
    // the toggle button itself) and .sidebar (nested inside .admin-shell)
    // can all be styled from the same one ancestor selector.
    function setupMobileToggle(shellEl) {
        if (!shellEl || document.querySelector(".sidebar-toggle")) return;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sidebar-toggle";
        toggle.setAttribute("aria-label", "Toggle navigation menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = `<span class="sidebar-toggle-icon" aria-hidden="true">☰</span> Menu`;

        const backdrop = document.createElement("div");
        backdrop.className = "sidebar-backdrop";

        function setOpen(open) {
            document.body.classList.toggle("sidebar-open", open);
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
        }

        toggle.addEventListener("click", () => {
            setOpen(!document.body.classList.contains("sidebar-open"));
        });

        backdrop.addEventListener("click", () => setOpen(false));

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setOpen(false);
        });

        // Close automatically after following a nav link (mobile only --
        // harmless on desktop since the class has no effect there).
        shellEl.querySelectorAll(".sidebar-nav a").forEach(link => {
            link.addEventListener("click", () => setOpen(false));
        });

        document.body.appendChild(backdrop);
        document.body.appendChild(toggle);
    }

    function init() {
        const navEl = document.querySelector("nav.sidebar-nav");
        if (!navEl) return; // e.g. the login gate, which has no sidebar

        renderNavInto(navEl);

        const shellEl = document.querySelector(".admin-shell");
        setupMobileToggle(shellEl);
    }

    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }

    return {
        NAV_GROUPS,
        SETTINGS_ITEM,
        currentPageFile,
        renderNavLink,
        buildNavHtml,
        allNavItems
    };
});
