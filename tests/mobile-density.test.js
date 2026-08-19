"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ADMIN_DIR = path.join(ROOT, "admin");
const ADMIN_PAGES = fs.readdirSync(ADMIN_DIR).filter((f) => f.endsWith(".html"));

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/* ---------------- viewport ---------------- */

test("every admin page (including the login gate) has a correct, zoom-preserving viewport declaration", () => {
    const pages = ["admin.html", ...ADMIN_PAGES.map((f) => `admin/${f}`)];

    for (const page of pages) {
        const html = read(page);
        const match = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
        assert.ok(match, `${page} is missing a viewport meta tag`);

        const content = match[1];
        assert.match(content, /width=device-width/, `${page} viewport must set width=device-width`);
        assert.match(content, /viewport-fit=cover/, `${page} viewport must set viewport-fit=cover for iPhone safe areas`);
        assert.doesNotMatch(content, /user-scalable=no/, `${page} must never disable pinch-zoom`);
        assert.doesNotMatch(content, /maximum-scale=1(\.0)?(?!\d)/, `${page} must never pin maximum-scale to 1 (also disables zoom)`);
    }
});

/* ---------------- text-size-adjust ---------------- */

test("admin.css sets text-size-adjust to 100% (iOS text inflation guard)", () => {
    const css = read("css/admin.css");
    assert.match(css, /-webkit-text-size-adjust:\s*100%/);
    assert.match(css, /(?<!-webkit-)text-size-adjust:\s*100%/);
});

/* ---------------- no zoom/transform hacks ---------------- */

test("admin.css never uses zoom or a page-wide transform as a mobile-scaling shortcut", () => {
    const css = read("css/admin.css");
    assert.doesNotMatch(css, /\bzoom\s*:/i, "must not use the non-standard zoom property to shrink the UI");
    // transform: scale(...) on .admin-shell/.admin-content/body would be
    // the page-wide-scaling anti-pattern the requirements explicitly
    // forbid; transforms on individual small elements (e.g. a hover
    // lift on a card) are fine and already used elsewhere in this file.
    assert.doesNotMatch(css, /(?:\.admin-shell|\.admin-content|^body)\s*{[^}]*transform\s*:\s*scale/ms);
});

/* ---------------- mobile density system exists and is consolidated ---------------- */

test("admin.css has one consolidated mobile density block at <=600px, not scattered new overrides", () => {
    const css = read("css/admin.css");
    assert.match(css, /MOBILE DENSITY SYSTEM/);
    assert.match(css, /@media \(max-width: 600px\)/);
});

test("the mobile density system no longer collapses order/status summaries to a single column", () => {
    const css = read("css/admin.css");
    const block = css.match(/MOBILE DENSITY SYSTEM[\s\S]*$/)[0];

    assert.match(block, /\.overview-grid,\s*\n?\s*\.orders-overview,\s*\n?\s*\.dashboard-home-kpis\s*{\s*\n?\s*grid-template-columns:\s*repeat\(2/);
    assert.match(block, /\.order-meta\s*{\s*\n?\s*grid-template-columns:\s*repeat\(2/);

    // Regression guard: the specific old rules that caused "several
    // screen lengths per order" must not still be forcing 1 column
    // for these at a phone breakpoint anywhere in the file.
    assert.doesNotMatch(css, /\.order-meta\s*{\s*\n?\s*grid-template-columns:\s*1fr;/);
    assert.doesNotMatch(css, /\.orders-overview\s*{\s*\n?\s*grid-template-columns:\s*1fr;/);
});

test("order item rows stay a row (not stacked to a column) at mobile widths", () => {
    const css = read("css/admin.css");
    assert.doesNotMatch(css, /\.order-item-row\s*{\s*\n?\s*flex-direction:\s*column/);
});

/* ---------------- sticky app bar, not a covering fixed button ---------------- */

test("the mobile menu control is a sticky in-flow app bar, not a floating fixed overlay covering content", () => {
    const css = read("css/admin.css");
    const appbarRule = css.match(/\.mobile-appbar\s*{[^}]*}/g).find((r) => r.includes("position"));
    assert.ok(appbarRule, ".mobile-appbar must declare a position");
    assert.match(appbarRule, /position:\s*sticky/);
    assert.doesNotMatch(appbarRule, /position:\s*fixed/);
});

test("js/admin-shell.js inserts the mobile app bar into normal document flow (.admin-content), not appended floating to <body>", () => {
    const source = read("js/admin-shell.js");
    assert.match(source, /appbar\.className\s*=\s*"mobile-appbar"/);
    assert.match(source, /contentEl\.insertBefore\(appbar/);
});

/* ---------------- 44px touch targets ---------------- */

test("mobile buttons and order actions meet the 44px minimum touch target", () => {
    const css = read("css/admin.css");
    const block = css.match(/MOBILE DENSITY SYSTEM[\s\S]*$/)[0];
    const minHeights = [...block.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    assert.ok(minHeights.length >= 2, "expected multiple min-height:44px touch-target rules");
    for (const h of minHeights) assert.ok(h >= 44, `touch target too small: ${h}px`);
});

test("mobile inputs are set to at least 16px to prevent iOS Safari's zoom-on-focus", () => {
    const css = read("css/admin.css");
    const block = css.match(/MOBILE DENSITY SYSTEM[\s\S]*$/)[0];
    assert.match(block, /input,\s*\n?\s*select,\s*\n?\s*textarea\s*{\s*\n?\s*font-size:\s*16px/);
});

/* ---------------- tables never force page-wide horizontal overflow ---------------- */

test(".table-wrapper contains table overflow instead of letting it blow out the page width", () => {
    const css = read("css/admin.css");
    assert.match(css, /\.table-wrapper\s*{[^}]*overflow-x:\s*auto/s);
});
