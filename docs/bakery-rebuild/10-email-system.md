# 10 — Production Email System (Supabase Edge Functions + Resend)

**Status as of 2026-08-18: code, migrations (schema), templates, tests, and admin UI are complete and committed. Production sending is OFF by default. Edge Function deployment and the cron schedule are deliberately held until the manual Resend/DNS/secrets setup below is done — see "Activation" at the end of this document.**

## 1. What this system does

Five email types, all rendered fresh at send time (no rendered HTML is ever stored):

1. **Order request received** — enqueued by a database trigger the instant an order's items finish saving. Explicitly labeled "not final approval."
2. **Order confirmed** — enqueued by a trigger on `orders.status` transitioning to `confirmed`. Includes the pickup date/time and, only here, the private pickup location (see §4).
3. **Order cancelled** — enqueued by a trigger on `orders.status` transitioning to `cancelled`. Brief, with a Contact link.
4. **Newsletter welcome** — single opt-in. Enqueued by the `newsletter-subscribe` Edge Function the moment a subscriber becomes (or becomes-again) `active`. Informational only — no verification link, no second step.
5. **Weekly menu** — generated from the live `menu_items` table at send time by `weekly-scheduler`, sent Sunday 6:00 PM Europe/Berlin by default (admin-configurable), DST-safe.

## 2. Architecture

```
Browser (public site)          Postgres                          Edge Functions (Deno)
──────────────────────         ──────────────────────            ──────────────────────
checkout / order edit  ──insert──▶ orders / order_items
                                   │ triggers (AFTER INSERT/UPDATE)
                                   ▼
                                email_outbox  ◀────────────────── send-emails
                                (durable queue,                   (processes pending rows,
                                 idempotency_key                   renders via _shared/templates.mjs,
                                 UNIQUE)                            sends via Resend, records result)

newsletter form  ──invoke──▶ newsletter-subscribe ──insert──▶ subscribers, email_outbox

unsubscribe.html ──invoke──▶ newsletter-unsubscribe ──update──▶ subscribers.status

pg_cron (*/15min) ──invoke──▶ weekly-scheduler ──insert──▶ email_campaigns, email_outbox
                                                             (then sends immediately, in-line)

Resend ──webhook──▶ resend-webhook (Svix-verified) ──insert──▶ email_webhook_events
                                                       ──update──▶ subscribers (bounce/complaint)
```

Every public-facing write goes through a narrowly-scoped Edge Function using the **service-role** key — no table in this system grants `anon` anything at all (verified live; see §7). This is a deliberate simplification over anon-callable RPCs: the Edge Function boundary *is* the "narrowly scoped secure function" the security requirements call for.

## 3. Database (migrations)

- `20260818120000_email_system_schema.sql` — `subscribers` lifecycle columns (`status`, `consent_at`, `consent_source`, `privacy_version`, `consent_event_id`, bounce/complaint counters), `email_unsubscribe_tokens`, `email_campaigns`, `email_outbox`, `email_webhook_events`, `email_settings` (singleton), `bakery_settings` (singleton, private `pickup_location`), all RLS policies, and the two order-lifecycle enqueue triggers.
- `20260818121500_email_newsletter_rate_limits.sql` — `newsletter_signup_attempts`, a self-pruning rate-limit bucket table.
- `20260818130000_email_cron_schedules.sql` — **not yet applied** (see §9/§10). The `pg_cron` + `pg_net` jobs that drive `send-emails` and `weekly-scheduler` on a schedule.

All three have deterministic rollbacks in `supabase/rollbacks/`.

### Idempotency, end to end

| Event | Guaranteed-once by |
|---|---|
| Order received | `email_outbox.idempotency_key = 'order_received:<order_id>'`, unique constraint, `ON CONFLICT DO NOTHING` in the trigger |
| Order confirmed/cancelled | same pattern, keyed by the transition; the trigger only fires when `OLD.status IS DISTINCT FROM NEW.status` |
| Newsletter welcome | keyed by `consent_event_id`, which the `subscribers` trigger regenerates only on a genuine (re)activation — a duplicate form submit while already active never re-keys |
| Weekly campaign (overall) | `email_campaigns.campaign_key` unique constraint (`weekly_menu:<Berlin-local date>`) |
| Weekly campaign (per recipient) | `email_outbox.idempotency_key = '<campaign_key>:<subscriber_id>'` |

Verified live (rolled-back transactions, no residue): inserting an order + items enqueues exactly one `order_received` row; updating status to `confirmed` twice enqueues exactly one `order_confirmed` row; the case-insensitive `subscribers` email index correctly rejects a differently-cased duplicate.

## 4. Privacy/consent model

- Newsletter consent is **only** ever recorded by `newsletter-subscribe`, never by checkout. Placing an order never subscribes anyone.
- `bakery_settings.pickup_location` has admin-only RLS and zero `anon` grant — it can only ever be read by the `order_confirmed` render path (service-role, server-side) and by the admin Settings page (RLS-gated).
- Every newsletter/weekly email carries a **freshly minted** unsubscribe token (`email_unsubscribe_tokens`, hash-only storage, 32 random bytes) — never a reused or subscriber-derived value, and the unsubscribe URL never carries a subscriber ID or email.
- `privacy.html` documents what's collected, that Resend is the delivery provider, and that consent can be withdrawn at any time via the one-click link — no legal-compliance claims are made.

## 5. Anti-abuse (newsletter signup)

- Honeypot field (`#newsletterWebsite`), visually and programmatically hidden, never labeled — any non-empty value is treated as a bot.
- Server-side email format + consent-checkbox validation (`_shared/validation.mjs`).
- Rate limiting: up to 5 attempts per 10 minutes per bucket, checked against **both** the normalized email and a SHA-256 hash of the caller's IP (never the raw IP is stored) — either bucket tripping blocks the request. Self-pruning table, no separate cleanup job.

## 6. Weekly schedule (DST-safe)

`_shared/schedule.mjs` computes local wall-clock time via `Intl.DateTimeFormat` with an explicit `timeZone`, so the Europe/Berlin CET/CEST transition is handled by the JS engine's own ICU tz database — no hand-rolled UTC-offset table exists anywhere in this codebase. Verified in tests with the exact same UTC hour landing "due" in winter but "not yet due" in summer, proving the offset is genuinely being computed per-call rather than assumed.

`weekly-scheduler` polls every 15 minutes (rather than firing at a single fixed UTC cron hour) and checks a 30-minute due-window, so a cron tick landing anywhere from the target local time to +30 minutes catches it exactly once (the campaign-key uniqueness constraint guarantees "exactly once" even under overlap).

## 7. Security verification performed live (2026-08-18)

- `get_advisors('security')` re-run after the schema migration: no new findings introduced (the pre-existing `pg_net`-in-public-schema warning was fixed in the same pass by installing it into `extensions` instead).
- Confirmed via `pg_policies`/grants: every new table has admin-only (`is_admin()`) policies and zero `anon` grant.
- The pre-existing, unrestricted `"Anyone can subscribe"` policy on `subscribers` (which let anyone insert arbitrary rows with no validation) was removed as part of this migration.
- Webhook signature verification (`_shared/webhook.mjs`) is unit-tested against real HMAC-SHA256/Svix-format signatures built independently via Node's own `crypto` module — a genuine cross-implementation check, not a mocked assertion.

## 8. Test coverage

`tests/email-shared.test.js` — 38 tests, all against the exact `.mjs` files the Edge Functions import (zero duplication): idempotency key formats, DST-safe scheduling (including the cross-season proof above), signup validation/honeypot/rate-limiting, unsubscribe token generation+hashing, Svix signature verification (valid, tampered, stale, missing-header cases), bounce/complaint event classification, recipient batching, provider quota math, weekly menu content building + empty/failed-load skip detection, retry backoff + permanent-vs-transient failure classification, the test-mode recipient safety guard (`resolveSendRecipient` — proven to NEVER fall back to a real recipient), and every template's content/escaping/no-admin-data-leak/no-verification-link assertions.

Plus the full pre-existing suite (137 tests) re-run unchanged to confirm no regression to ordering, menu, currency, calculations, security, or gallery logic.

Not (and can't be) covered by `node --test`: the Deno-only plumbing in `supabase/functions/*/index.ts` (DB queries, Resend HTTP calls) — these were code-reviewed for correctness and will be smoke-tested for real against the configured test recipient during activation (§10), matching this project's established convention of verifying live-Postgres/live-Supabase behavior directly rather than mocking it.

## 9. What's intentionally NOT done yet

- Edge Functions are **written but not deployed** (`supabase functions deploy` requires the Supabase CLI to be linked to the project, and deploying now would just mean broken calls with no `RESEND_API_KEY`).
- The `pg_cron` schedule migration is **written but not applied** (no point scheduling calls to undeployed functions).
- `order_emails_enabled` and `newsletter_enabled` default to `false` in `email_settings` — even once deployed, nothing sends until an admin (or the activation pass below) explicitly turns them on.

## 10. Activation (after the manual setup steps)

Once Resend is set up (see the assistant's final report for the exact manual steps) and the secrets are entered directly into Supabase:

1. `supabase functions deploy send-emails newsletter-subscribe newsletter-unsubscribe weekly-scheduler` (JWT-verified) and `supabase functions deploy resend-webhook --no-verify-jwt` (Resend can't send a Supabase JWT; security is the Svix signature check instead).
2. Run `select vault.create_secret('<service_role_key>', 'project_service_role_key');` once (owner-entered, never seen by the assistant).
3. Apply `20260818130000_email_cron_schedules.sql`.
4. Send test emails (all 5 types) to the configured admin test recipient only; verify formatting, links, unsubscribe behavior, and idempotency (re-trigger the same order status change and confirm no duplicate).
5. Verify a real Resend webhook event round-trips into `email_webhook_events` with a valid signature (and that an invalid signature is rejected).
6. Only after all of the above pass: enable `order_emails_enabled`, and either enable `newsletter_enabled` or leave it off until the admin is ready — the Sunday 6 PM schedule only ever fires a real campaign once `newsletter_enabled` is on.
