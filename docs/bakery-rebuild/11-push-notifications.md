# 11 — Installable Admin PWA + Web Push Order Notifications

**Status as of 2026-08-19: code complete, deployed to `main`, DB migrations live. `send-push` Edge Function NOT yet deployed. `push_settings.order_push_enabled` is `false` -- no real push notification can go out yet.** See §10 for the exact remaining manual steps.

## 1. What this is

The existing admin dashboard (`admin.html` + `admin/*.html`) becomes an installable iPhone Home Screen app:

- A Web App Manifest (`manifest.webmanifest`) and a service worker (`sw.js`), both at the site root, registered from every admin page (see `js/admin-shell.js`'s `injectPwaHeadTags()`/`registerServiceWorker()`).
- The existing logo (`images/jess-bakes-logo.png`), unmodified, centered on a cream (`#f7f3ee`) square background to produce proper 192×192/512×512/180×180 app icons (`images/icons/`, generated once via a PowerShell + System.Drawing script -- no new artwork).
- iOS Safari's "Add to Home Screen" launches it `display: standalone`, using `apple-mobile-web-app-capable`/`apple-touch-icon` meta tags (JS-injected on every admin page, not hand-copied into 14 HTML files).
- Standards-based Web Push (VAPID, RFC 8291/8292) delivers a notification to every approved admin's installed app the moment a genuine new order finishes saving. No paid push provider, no Telegram/SMS/Firebase/OneSignal.

## 2. Architecture

```
Browser (installed admin app)        Postgres                       Edge Function (Deno)
──────────────────────────────       ──────────────────────         ──────────────────────
checkout / manual order  ──insert──▶ orders / order_items
                                      │ trigger (AFTER INSERT, statement-level,
                                      │ same firing rule as order_received email:
                                      │ only once ALL of an order's items exist)
                                      ▼
                                   push_outbox  ◀──────────────────  send-push
                                   (durable queue, ONE row            (fans out to every
                                    per order, idempotency_key         active admin_push_
                                    UNIQUE)                            subscriptions row,
                                                                       encrypts + sends via
Settings page ──invoke──▶ send-push { action: "vapid_public_key" }    npm:web-push, records
                        ──subscribe──▶ browser PushManager             success/failure per
                        ──upsert (RLS)──▶ admin_push_subscriptions     device)

pg_cron (every 1 min) ──invoke──▶ send-push { action: "process" }

Apple/Google/Mozilla push service ──▶ delivered to the OS ──▶ sw.js `push` event
                                                             ──▶ notification tap
                                                             ──▶ sw.js `notificationclick`
                                                             ──▶ focus/open app, navigate to
                                                                 /admin/orders.html?order=<id>
```

Registration (subscribe/view/disable) never goes through an Edge Function at all -- it's a direct, RLS-protected `admin_push_subscriptions` table write from the browser's own authenticated Supabase client, exactly like every other admin-only table in this project. Only the VAPID **public** key (intentionally public) and the actual **sending** (which needs the private key and must fan out across every admin, i.e. can't be scoped by one admin's own RLS) go through `send-push`.

## 3. Database

- `supabase/migrations/20260819140000_web_push_notifications.sql` -- `admin_push_subscriptions` (admin-owns-own-rows RLS), `push_outbox` (admin-select-only RLS; all writes are service-role), `push_settings` (singleton, `order_push_enabled` defaults `false`), and a **separate** statement-level trigger (`enqueue_order_push_event`) on `order_items`, independent of and running alongside the existing email trigger -- a failure/disable of either can never affect the other, and neither can ever fail the order/order_items write itself (both are `SECURITY DEFINER` with an exception handler that logs and swallows, matching the proven-live fix in `20260818143142_fix_order_email_trigger_security_definer.sql`).
- `supabase/migrations/20260819140500_push_cron_schedule.sql` -- a `pg_cron` job (`* * * * *`, every minute -- vs. the email outbox's every 5 minutes, to meet the "~1 minute" delivery target) calling `send-push` with `{action:"process"}`. Reuses the **same** `project_service_role_key` Vault secret already created for the email system; no new manual Vault step.
- Deterministic rollbacks for both in `supabase/rollbacks/`.
- No backfill anywhere -- only a NEW `order_items` insert (from deployment forward) ever enqueues a `push_outbox` row, so deploying this cannot notify about any pre-existing order.

### Idempotency

`push_outbox.idempotency_key = 'push_order_new:<order_id>'`, unique constraint, `ON CONFLICT DO NOTHING` in the trigger -- verified live (rolled-back transaction) that a duplicate/retried `order_items` insert for the same order never creates a second row, and that the push trigger and the email trigger both fire independently and correctly from the exact same `order_items` insert.

Per-device duplicate protection: `admin_push_subscriptions.endpoint` is globally unique; enabling notifications on the same device twice `UPSERT`s the same row rather than creating a duplicate.

Per-notification duplicate protection on the device itself: every push payload carries `tag: "order-<id>"` (see `_shared/pushPayload.mjs`), so even a legitimate resend for the same order replaces rather than stacks the OS-level alert.

## 4. Web Push sending (`send-push` Edge Function)

Uses `npm:web-push` (a standards-based, free, open-source VAPID + RFC 8291 implementation -- not a paid provider) from `_shared/pushOutbox.ts`. Three secrets, Edge Function Secrets only, never in code/git/logs:

- `WEB_PUSH_VAPID_PUBLIC_KEY` -- safe to hand to the browser (that's the whole point of VAPID's public key); served via `{action:"vapid_public_key"}`, admin-authenticated only.
- `WEB_PUSH_VAPID_PRIVATE_KEY` -- Deno.env only, never returned by any action.
- `WEB_PUSH_VAPID_SUBJECT` -- a `mailto:` contact URI required by the VAPID spec.

Per-order-event processing (`processPushOutboxRow`): loads the order, builds a **privacy-conscious** payload (`_shared/pushPayload.mjs` -- first name only, stored EUR total, order type/pickup date, order id, safe admin URL; structurally incapable of including a surname, email, phone, address, pickup location, notes, or any token, since those fields simply aren't parameters the payload builder accepts), then fans out to every active (or, for a test send, only the requesting admin's own) `admin_push_subscriptions` row.

Per-subscription delivery: up to 2 short in-pass retries for a *transient* failure (never for a permanent one, and never spanning a later outbox-row retry -- see the code comment in `pushOutbox.ts` for why re-queuing the whole row would risk double-notifying a subscription that already succeeded). A `404`/`410` response (the browser/OS revoked the subscription) immediately and permanently disables that one subscription -- no further attempts, ever, until the admin re-enables from Settings.

## 5. The installed app

- `manifest.webmanifest`: name "Jess Bakes Admin", short name "Jess Bakes", `start_url: /admin/dashboard.html`, `scope: /` (covers both the root-level login gate `admin.html` and every `/admin/*` page -- the existing routing genuinely spans both), `display: standalone`, `orientation: portrait`, brand colors (`background_color:#f7f3ee`, `theme_color:#7b2b22`).
- `sw.js`: scope `/`. Caches ONLY an explicit allowlist of static assets (manifest, icons, `css/admin.css`, the small shared JS files) -- cache-first with a network refresh. Every HTML document, every `/admin/*` request, and every Supabase request is deliberately left untouched (no `respondWith()` call at all), so there is no stale-dashboard problem and no private data ever passes through the Cache API. `push`/`notificationclick` handlers show the notification and route a tap to `/admin/orders.html?order=<id>`, focusing an already-open window if there is one.
- Order deep-linking: `renderOrderCard()` now gives each order card `id="order-<id>"`; `admin-orders.js`'s `handleOrderDeepLink()` scrolls to and briefly highlights the matching card when the page loads with `?order=<id>`. If the admin is signed out when the notification is tapped, `requireAuth()` stashes the intended URL in `sessionStorage` before redirecting to the login gate, and `login.js` returns there after a successful sign-in (same-origin relative path only, checked with `startsWith("admin/")` -- never an open redirect, never a credential in the URL).
- Settings panel (`admin/settings.html` "App & Notifications", `js/admin-push.js`): install/support/permission/subscription status, Enable/Test/Disable buttons. `Notification.requestPermission()` is called from exactly one place in the whole app -- the Enable button's click handler -- verified by both a source-level Node test and a live Playwright/Chromium check that loading the page never elevates permission on its own.

## 6. Icons

`images/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180×180) -- all generated from the existing `images/jess-bakes-logo.png` via a one-time PowerShell + `System.Drawing` script (centered, aspect-preserving, no cropping/redesign, cream `#f7f3ee` background matching the site's own background color). No new or generated decorative graphics.

## 7. What was NOT changed

Order emails, the weekly newsletter, currency/sales/analytics/inventory/recipe calculations, existing RLS on any other table, public site styling/branding, and the checkout flow's own success path are all untouched. The push trigger is a wholly separate function/trigger from the email one, sharing only the same firing *rule* (statement-level, after all of an order's items exist).

## 8. Test coverage

- `tests/push-notifications.test.js` (Node, pure/source-level): manifest validity + icon files are real correctly-sized square PNGs; service worker declares the right event listeners and its cache allowlist never contains HTML/`/admin/`/a Supabase API URL; `admin-shell.js` registers the SW at scope `/` and injects the manifest link; `pushPayload.mjs`'s payload contains only allowed fields (explicit forbidden-field list checked against the serialized JSON); `firstNameOnly` never returns a surname; idempotency key uniqueness/independence from the email keys; the Settings panel has every required control; `Notification.requestPermission()` is only ever called from the Enable handler, never on page load; order cards carry a deep-linkable id.
- `tests/pwa.spec.js` (Playwright/Chromium, run manually -- see the file header for the exact commands, since this repo has no `package.json`/npm scripts by convention): manifest + icons are actually reachable over HTTP; the service worker actually registers at scope `/` from the login gate; the manifest link/apple-touch-icon tags are actually present in the live DOM after load; loading the page never elevates `Notification.permission` to `"granted"`; a static asset actually gets cached while an HTML page actually does not. **This proves real Chromium behavior, not real iPhone behavior** -- iOS Safari's installation UI, standalone launch experience, and Web Push delivery are NOT reproducible in Chromium and are confirmed only by the project owner's own iPhone (§10).
- Live-Postgres verification (rolled-back transactions, no residue): a real `order_items` insert fires both the push and email triggers independently, producing exactly one row each; a simulated duplicate insert for the same order creates no second row of either type; `anon` gets a hard permission-denied error (not just an empty result) querying `admin_push_subscriptions`/`push_outbox` directly.
- Full existing regression suite (`node --test "tests/*.test.js"`) passes -- 190 tests, including every pre-existing email/order/currency/sales test, unchanged.

## 9. Manual setup required (external actions only)

1. **Generate a VAPID keypair.** On your own machine: `node scripts/generate-vapid-keys.mjs`. It prints two values to your terminal only -- nothing is sent anywhere.
2. **Add three Edge Function secrets** in the Supabase Dashboard (Project Settings → Edge Functions → Secrets) -- paste directly there, never into a chat:
   - `WEB_PUSH_VAPID_PUBLIC_KEY` (from step 1)
   - `WEB_PUSH_VAPID_PRIVATE_KEY` (from step 1)
   - `WEB_PUSH_VAPID_SUBJECT` = `mailto:jessica.holsopple3@gmail.com` (or another contact address you prefer)
3. **Deploy the Edge Function**: GitHub → Actions → "Deploy Push Notification Edge Function" → Run workflow. (Uses the same `SUPABASE_ACCESS_TOKEN` repo secret already set up for the email functions -- no new GitHub secret needed.)
4. **On your iPhone**, in Safari: open the admin dashboard → Share → Add to Home Screen → open "Jess Bakes Admin" from the Home Screen → sign in → Settings → Enable Order Notifications → Send Test Notification.
5. Confirm the test notification arrived and tapping it opened the app correctly.
6. Only then: enable `push_settings.order_push_enabled` for real order alerts.

## 10. Activation status

- [x] Schema + trigger + cron migrations applied live.
- [x] `send-push` Edge Function code written, not yet deployed.
- [ ] VAPID secrets set (owner action, §9 steps 1-2).
- [ ] `send-push` deployed (§9 step 3).
- [ ] Real iPhone install + test notification confirmed (§9 steps 4-5).
- [ ] `push_settings.order_push_enabled` set to `true` (§9 step 6, after confirmation).
