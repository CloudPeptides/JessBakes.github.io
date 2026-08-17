"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_PAGES = ["index.html", "menu.html", "reviews.html", "contact.html"];
const STYLE_CSS = path.join(ROOT, "css", "style.css");

/* ==========================================
   Phase 5 public-site regression tests.

   Structural/text-based (no real browser available in this environment --
   see the Phase 5 completion summary for the same honesty caveat used in
   Phase 4). Verifies the CSS cleanup didn't lose or break anything, and
   that the new accessibility additions (skip link, focus-visible,
   reduced-motion) are actually wired into every public page.
   ========================================== */

test("1. css/style.css has no duplicate top-level selector definitions remaining", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    const lines = css.split("\n");
    const seen = new Map();
    let depth = 0, buf = "", inComment = false;

    for (const line of lines) {
        let i = 0;
        while (i < line.length) {
            if (inComment) {
                const end = line.indexOf("*/", i);
                if (end === -1) { i = line.length; } else { inComment = false; i = end + 2; }
                continue;
            }
            const ch = line[i];
            if (ch === "/" && line[i + 1] === "*") { inComment = true; i += 2; continue; }
            if (ch === "{") {
                if (depth === 0) {
                    const sel = buf.trim().replace(/\s+/g, " ");
                    if (sel && !sel.startsWith("@")) seen.set(sel, (seen.get(sel) || 0) + 1);
                    buf = "";
                }
                depth++;
            } else if (ch === "}") {
                depth--;
                if (depth === 0) buf = "";
            } else if (depth === 0) {
                buf += ch;
            }
            i++;
        }
        if (depth === 0) buf += " ";
    }

    const dups = [...seen.entries()].filter(([, count]) => count > 1);
    assert.equal(dups.length, 0, `duplicate top-level selectors found: ${JSON.stringify(dups)}`);
});

test("2. css/style.css has balanced braces (no unclosed @media blocks)", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    let depth = 0, inComment = false;
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === "/" && css[i + 1] === "*") { inComment = true; i++; continue; }
        if (inComment) { if (ch === "*" && css[i + 1] === "/") { inComment = false; i++; } continue; }
        if (ch === "{") depth++;
        if (ch === "}") depth--;
    }
    assert.equal(depth, 0, `unbalanced braces (final depth ${depth})`);
});

test("3. css/style.css has no unresolved var() references", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    const definedTokens = new Set([...css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map(m => "--" + m[1]));
    const usedTokens = new Set([...css.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)].map(m => m[1]));

    for (const token of usedTokens) {
        assert.ok(definedTokens.has(token), `var(${token}) is used but never defined in :root`);
    }
});

test("4. css/style.css has no leftover malformed declarations (double property names, double semicolons)", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    assert.ok(!/\bbackground:\s*\n\s*background:/.test(css), "duplicated 'background:' property name");
    assert.ok(!css.includes(";;"), "double semicolon found");
    assert.ok(!/^\s*olor:/m.test(css), "truncated 'color:' property name ('olor:') found");
});

test("5. every public page loads only css/style.css, never css/admin.css (no admin/public CSS leakage)", () => {
    for (const page of PUBLIC_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), "utf8");
        assert.ok(html.includes("css/style.css"), `${page} should load css/style.css`);
        assert.ok(!html.includes("css/admin.css"), `${page} should not load css/admin.css`);
    }
});

test("6. no admin/*.html page loads css/style.css (no leakage the other direction)", () => {
    const adminDir = path.join(ROOT, "admin");
    const adminPages = fs.readdirSync(adminDir).filter(f => f.endsWith(".html"));
    for (const page of adminPages) {
        const html = fs.readFileSync(path.join(adminDir, page), "utf8");
        assert.ok(!html.includes("css/style.css"), `${page} should not load the public css/style.css`);
    }
});

test("7. every public page has a skip-to-content link targeting a real #main-content on that same page", () => {
    for (const page of PUBLIC_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), "utf8");
        assert.ok(html.includes('class="skip-link"'), `${page} should have a skip link`);
        assert.ok(html.includes('href="#main-content"'), `${page}'s skip link should target #main-content`);
        assert.ok(html.includes('id="main-content"'), `${page} should have an element with id="main-content"`);
    }
});

test("8. css/style.css defines a visible :focus-visible style and reduced-motion support", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    assert.ok(/:focus-visible\s*{/.test(css), "expected a global :focus-visible rule");
    assert.ok(/prefers-reduced-motion:\s*reduce/.test(css), "expected a prefers-reduced-motion media query");
});

test("9. every public page's <link>/<script> src/href attributes resolve to a real file (no broken references)", () => {
    const attrRe = /(?:href|src)="([^"]+)"/g;

    for (const page of PUBLIC_PAGES) {
        const filePath = path.join(ROOT, page);
        const html = fs.readFileSync(filePath, "utf8");
        let m;
        while ((m = attrRe.exec(html))) {
            const url = m[1];
            if (!url || url.startsWith("#") || /^https?:/.test(url) || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("data:")) continue;
            const resolved = path.normalize(path.join(ROOT, url));
            assert.ok(fs.existsSync(resolved), `${page} references missing file: ${url}`);
        }
    }
});

test("10. every class used anywhere in a public page still has a matching CSS rule (no accidental coverage loss from the dead-code cleanup)", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const html = PUBLIC_PAGES.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

    const classAttrRe = /class="([^"]*)"/g;
    const staticClasses = new Set();
    let m;
    while ((m = classAttrRe.exec(html))) {
        m[1].split(/\s+/).forEach(c => { if (c && !c.includes("${")) staticClasses.add(c); });
    }

    // These are pre-existing gaps, confirmed present in the original file
    // before this phase's cleanup (git history) -- not a regression.
    const knownPreexistingGaps = new Set(["logo-link", "newsletter-content", "section-label", "review-success"]);

    const missing = [];
    for (const cls of staticClasses) {
        if (knownPreexistingGaps.has(cls)) continue;
        const re = new RegExp("\\." + cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
        if (!re.test(css)) missing.push(cls);
    }

    assert.deepEqual(missing, []);
});

test("11. confirmed-dead selectors from the Phase 5 cleanup do not reappear", () => {
    const css = fs.readFileSync(STYLE_CSS, "utf8");
    assert.ok(!/\.secondary-btn\b/.test(css));
    assert.ok(!/\.jess-note\b/.test(css));
    assert.ok(!/\.builder-order-(details|line)\b/.test(css));
});
