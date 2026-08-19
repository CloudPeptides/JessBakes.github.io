"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SHARED = "../supabase/functions/_shared/";

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/* ---------------- manifest.webmanifest ---------------- */

test("manifest: valid JSON with the required installable-app fields", () => {
    const manifest = JSON.parse(read("manifest.webmanifest"));

    assert.equal(manifest.name, "Jess Bakes Admin");
    assert.equal(manifest.short_name, "Jess Bakes");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.orientation, "portrait");
    assert.match(manifest.start_url, /^\/admin\//);
    assert.equal(manifest.scope, "/");
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes("192x192"), "manifest must declare a 192x192 icon");
    assert.ok(sizes.includes("512x512"), "manifest must declare a 512x512 icon");

    for (const icon of manifest.icons) {
        assert.equal(icon.type, "image/png");
        assert.ok(fs.existsSync(path.join(ROOT, icon.src.replace(/^\//, ""))), `icon file must exist: ${icon.src}`);
    }
});

/* ---------------- icon files ---------------- */

function pngDimensions(relPath) {
    const buf = fs.readFileSync(path.join(ROOT, relPath));
    assert.equal(buf.toString("ascii", 1, 4), "PNG", `${relPath} must be a real PNG`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("icons: 192x192, 512x512, and apple-touch-icon are real, correctly-sized, SQUARE PNGs", () => {
    const icon192 = pngDimensions("images/icons/icon-192.png");
    assert.deepEqual(icon192, { width: 192, height: 192 });

    const icon512 = pngDimensions("images/icons/icon-512.png");
    assert.deepEqual(icon512, { width: 512, height: 512 });

    const appleIcon = pngDimensions("images/icons/apple-touch-icon.png");
    assert.deepEqual(appleIcon, { width: 180, height: 180 });
});

/* ---------------- service worker ---------------- */

test("service worker: registers push + notificationclick + install/activate/fetch handlers", () => {
    const sw = read("sw.js");
    assert.match(sw, /addEventListener\(\s*["']push["']/);
    assert.match(sw, /addEventListener\(\s*["']notificationclick["']/);
    assert.match(sw, /addEventListener\(\s*["']install["']/);
    assert.match(sw, /addEventListener\(\s*["']activate["']/);
    assert.match(sw, /addEventListener\(\s*["']fetch["']/);
    assert.match(sw, /skipWaiting\(\)/);
    assert.match(sw, /clients\.claim\(\)/);
});

test("service worker: the static cache allowlist never contains an HTML page, an admin/ path, or anything Supabase", () => {
    const sw = read("sw.js");
    const match = sw.match(/STATIC_ALLOWLIST\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(match, "sw.js must define STATIC_ALLOWLIST");

    const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(entries.length > 0, "allowlist should not be empty");

    for (const entry of entries) {
        assert.doesNotMatch(entry, /\.html?$/i, `must never cache an HTML document: ${entry}`);
        assert.doesNotMatch(entry, /^\/admin\//, `must never cache a private admin path: ${entry}`);
        // The allowlist may safely include the local js/supabase.js file
        // (just anon-key config, same as what's already in every page's
        // source) -- what must never appear is an actual Supabase API
        // request (a full URL to the project's *.supabase.co host).
        assert.doesNotMatch(entry, /supabase\.co/i, `must never cache a Supabase API URL: ${entry}`);
    }
});

test("service worker: fetch handler only intervenes for same-origin GET requests matched against the allowlist", () => {
    const sw = read("sw.js");
    // Structural guard: the fetch handler must check method/origin/
    // allowlist membership BEFORE ever calling respondWith.
    const fetchHandlerMatch = sw.match(/addEventListener\(\s*["']fetch["'][\s\S]*/);
    assert.ok(fetchHandlerMatch);
    const body = fetchHandlerMatch[0];
    assert.match(body, /req\.method\s*!==\s*["']GET["']/);
    assert.match(body, /STATIC_ALLOWLIST\.includes/);
    assert.match(body, /url\.origin\s*!==\s*self\.location\.origin/);
});

/* ---------------- admin-shell.js PWA bootstrap ---------------- */

test("admin-shell: registers the service worker at site scope and injects the manifest link", () => {
    const shell = read("js/admin-shell.js");
    assert.match(shell, /navigator\.serviceWorker\.register\(\s*["']\/sw\.js["']/);
    assert.match(shell, /scope:\s*["']\/["']/);
    assert.match(shell, /rel\s*=\s*["']manifest["']/);
    assert.match(shell, /\/manifest\.webmanifest/);
    assert.match(shell, /apple-touch-icon/);
    assert.match(shell, /apple-mobile-web-app-capable/);
});

/* ---------------- pushPayload.mjs (pure) ---------------- */

test("pushPayload: buildOrderPushPayload contains only the allowed fields -- no surname, email, phone, address, notes, or tokens", async () => {
    const { buildOrderPushPayload, FORBIDDEN_PUSH_FIELDS } = await import(SHARED + "pushPayload.mjs");

    const payload = buildOrderPushPayload({
        orderId: "abc-123-def",
        customerName: "Alex Johnson",
        totalEur: 18,
        orderType: "weekly",
        pickupDate: "2026-08-23"
    });

    assert.equal(payload.title, "🧁 New Jess Bakes order");
    assert.match(payload.body, /^Alex ·/);
    assert.doesNotMatch(payload.body, /Johnson/, "surname must never appear");
    assert.match(payload.body, /€18\.00/);
    assert.match(payload.body, /Weekly pickup/);
    assert.equal(payload.tag, "order-abc-123-def");
    assert.equal(payload.data.orderId, "abc-123-def");
    assert.match(payload.data.url, /\/admin\/orders\.html\?order=abc-123-def/);

    const serialized = JSON.stringify(payload).toLowerCase();
    for (const forbidden of FORBIDDEN_PUSH_FIELDS) {
        assert.doesNotMatch(serialized, new RegExp(forbidden.toLowerCase()), `payload must never mention "${forbidden}"`);
    }
});

test("pushPayload: firstNameOnly strips every word after the first, and has a safe fallback", async () => {
    const { firstNameOnly } = await import(SHARED + "pushPayload.mjs");
    assert.equal(firstNameOnly("Alex Johnson"), "Alex");
    assert.equal(firstNameOnly("  Priya   Patel  "), "Priya");
    assert.equal(firstNameOnly(""), "A customer");
    assert.equal(firstNameOnly(null), "A customer");
});

test("pushPayload: custom orders are labeled distinctly from weekly, and a missing pickup date degrades gracefully", async () => {
    const { buildOrderPushPayload } = await import(SHARED + "pushPayload.mjs");
    const custom = buildOrderPushPayload({ orderId: "1", customerName: "Sam", totalEur: 5, orderType: "custom", pickupDate: null });
    assert.match(custom.body, /Custom order/);
    assert.doesNotMatch(custom.body, /null|undefined/);
});

/* ---------------- idempotency.mjs ---------------- */

test("idempotency: pushOrderNewKey is independent from every email key for the same order", async () => {
    const idem = await import(SHARED + "idempotency.mjs");
    assert.equal(idem.pushOrderNewKey("order-1"), "push_order_new:order-1");
    assert.notEqual(idem.pushOrderNewKey("order-1"), idem.orderReceivedKey("order-1"));
    assert.notEqual(idem.pushOrderNewKey("order-1"), idem.adminNewOrderKey("order-1"));
    assert.notEqual(idem.pushOrderNewKey("a"), idem.pushOrderNewKey("b"));
});

/* ---------------- settings.html panel wiring ---------------- */

test("admin/settings.html has the App & Notifications panel with all required controls, and loads admin-push.js", () => {
    const html = read("admin/settings.html");
    assert.match(html, /id="pushEnableBtn"/);
    assert.match(html, /id="pushTestBtn"/);
    assert.match(html, /id="pushDisableBtn"/);
    assert.match(html, /id="pushStatInstalled"/);
    assert.match(html, /id="pushStatSupport"/);
    assert.match(html, /id="pushStatPermission"/);
    assert.match(html, /id="pushStatSubscription"/);
    assert.match(html, /Add to Home Screen/);
    assert.match(html, /src="\.\.\/js\/admin-push\.js"/);
});

test("admin-push.js never calls Notification.requestPermission outside of the Enable button handler", () => {
    const source = read("js/admin-push.js");

    // Only ONE real call site (comments mentioning the API name don't
    // count -- strip line comments before counting call expressions).
    const withoutComments = source.replace(/\/\/.*$/gm, "");
    const calls = withoutComments.match(/Notification\.requestPermission\(\)/g) || [];
    assert.equal(calls.length, 1, "requestPermission() should be CALLED exactly once, inside enableOrderNotifications");

    const enableFnMatch = source.match(/async function enableOrderNotifications\(\)\s*\{[\s\S]*?\n\}/);
    assert.ok(enableFnMatch, "enableOrderNotifications function must exist");
    assert.match(enableFnMatch[0], /Notification\.requestPermission\(\)/);

    // And it must never run on DOMContentLoaded / page load automatically.
    const loadHandlerMatch = source.match(/document\.addEventListener\(\s*["']DOMContentLoaded["'][\s\S]*?\}\);/);
    assert.ok(loadHandlerMatch);
    assert.doesNotMatch(loadHandlerMatch[0], /requestPermission/);
});

/* ---------------- order deep-linking ---------------- */

test("admin-orders.js: order cards carry a stable id for deep-linking, and a deep-link handler exists", () => {
    const source = read("js/admin-orders.js");
    assert.match(source, /id="order-\$\{escapeHtml\(order\.id\)\}"/);
    assert.match(source, /function handleOrderDeepLink/);
    assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("order"\)/);
});
