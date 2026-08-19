/* ==========================================
   PLAYWRIGHT/CHROMIUM -- PWA BEHAVIOR

   Covers what a desktop Chromium browser CAN honestly verify: the
   manifest/icons are reachable and correct, the service worker
   registers at the right scope, its caching rule is safe (static
   assets cached, HTML never cached), and no notification permission
   prompt is ever triggered just by loading the page.

   This does NOT and CANNOT prove: real "Add to Home Screen"
   installation on iOS, the iOS standalone launch experience, or real
   Web Push delivery to a physical iPhone. Chromium's own push/
   notification stack differs from iOS Safari's, and there is no
   automated substitute for a real device. Those are confirmed only
   by the project owner's own iPhone, per the activation steps in
   docs/bakery-rebuild/11-push-notifications.md.

   Run manually (this repo has no package.json/npm scripts by
   convention): from the repo root,
     npx playwright install chromium   (first time only)
     npx playwright test tests/pwa.spec.js
   A local static server on http://localhost:8090 must be running
   first (see docs/bakery-rebuild/11-push-notifications.md §Testing).
   ========================================== */

const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.PWA_TEST_BASE_URL || "http://localhost:8090";

test("manifest.webmanifest is served, valid, and every icon it declares is reachable", async ({ page, request }) => {
    const manifestResponse = await request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(manifestResponse.ok()).toBeTruthy();

    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("Jess Bakes Admin");
    expect(manifest.display).toBe("standalone");

    for (const icon of manifest.icons) {
        const iconResponse = await request.get(`${BASE_URL}${icon.src}`);
        expect(iconResponse.ok(), `icon must be reachable: ${icon.src}`).toBeTruthy();
        expect(iconResponse.headers()["content-type"]).toContain("image/png");
    }
});

test("service worker registers at site scope from the login gate", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin.html`);

    const registration = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return { scope: reg.scope, active: Boolean(reg.active) };
    });

    expect(registration.active).toBeTruthy();
    expect(registration.scope).toBe(`${BASE_URL}/`);
});

test("manifest link and apple-touch-icon are present in the DOM after load (JS-injected)", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin.html`);
    await page.waitForFunction(() => document.querySelector('link[rel="manifest"]') !== null);

    const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
    expect(manifestHref).toBe("/manifest.webmanifest");

    const appleTouchIcon = await page.getAttribute('link[rel="apple-touch-icon"]', "href");
    expect(appleTouchIcon).toBe("/images/icons/apple-touch-icon.png");

    const capable = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', "content");
    expect(capable).toBe("yes");
});

test("loading the page never triggers a notification-permission prompt on its own", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin.html`);
    await page.waitForTimeout(500); // give the SW registration + any accidental auto-prompt code a moment to run

    const permission = await page.evaluate(() => ("Notification" in window ? Notification.permission : "unsupported"));
    // The property that actually matters: loading the page must never
    // auto-ELEVATE permission to "granted". Playwright's headless
    // Chromium reports "denied" by default for an unprompted origin
    // (its own test-environment default, not something this app's
    // code caused -- see tests/push-notifications.test.js for the
    // source-level proof that requestPermission() is only ever called
    // from the Enable button's click handler).
    expect(permission).not.toBe("granted");
});

test("safe caching: a static asset gets cached, but an HTML document never does", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin.html`);
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
    });

    // Trigger a fetch of an allowlisted static asset and of an HTML
    // page, then inspect the Cache Storage directly.
    await page.evaluate(async (base) => {
        await fetch(base + "/css/admin.css");
        await fetch(base + "/admin/dashboard.html");
    }, BASE_URL);

    await page.waitForTimeout(300); // let the SW's cache.put() settle

    const cacheContents = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        const urls = [];
        for (const name of cacheNames) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            urls.push(...keys.map((k) => new URL(k.url).pathname));
        }
        return urls;
    });

    expect(cacheContents).toContain("/css/admin.css");
    expect(cacheContents.some((u) => u.endsWith(".html"))).toBeFalsy();
    expect(cacheContents.some((u) => u.startsWith("/admin/"))).toBeFalsy();
});
