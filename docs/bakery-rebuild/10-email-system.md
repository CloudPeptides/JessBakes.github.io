# 10 — Production Email System (Supabase Edge Functions + Resend)

**Status as of 2026-08-18 (updated): code, migrations, templates, tests, and admin UI are complete and committed. `jessbakessourdough.com` is verified in Resend; `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are set as Supabase Edge Function secrets; the `pg_cron` schedule (§10) is applied and running (harmlessly no-op until the functions below are deployed). Production sending is still OFF (`email_settings.order_emails_enabled`/`newsletter_enabled` both `false`). The one remaining step is deploying the Edge Functions themselves, which requires a credential this assistant does not have and should not be given directly — see §10.**

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

- Edge Functions are **written but not deployed**. Deploying requires the Supabase CLI to be authenticated against this project (`supabase link` + `supabase functions deploy`), which needs a Supabase **Personal Access Token** — a project-management credential, meaningfully more sensitive than the Resend API key, that this assistant does not have and should not be handed directly (unlike an Edge Function secret, a Personal Access Token isn't scoped to "send email" — it can manage the whole Supabase project). See §10 for how this gets deployed without ever sharing that token with the assistant.
- `order_emails_enabled` and `newsletter_enabled` remain `false` in `email_settings` — even once deployed, nothing sends until an admin explicitly turns them on (§10 step 5).

## 10. Activation

Already done (2026-08-18): domain verified in Resend; `RESEND_API_KEY`/`RESEND_WEBHOOK_SECRET` set as Supabase Edge Function secrets; `20260818130000_email_cron_schedules.sql` applied (the two `pg_cron` jobs exist and run every 5/15 minutes, but currently fail harmlessly inside `pg_net` — no deployed function to reach yet, and no data is touched by a failed HTTP call).

Remaining steps:

1. **Deploy the Edge Functions** via `.github/workflows/deploy-email-functions.yml` (added in this repo) — a manually-triggered GitHub Actions workflow, so deployment is a deliberate action, not an automatic side effect of a push. One-time setup: add a repository secret `SUPABASE_ACCESS_TOKEN` (GitHub repo → Settings → Secrets and variables → Actions → New repository secret), generated at https://supabase.com/dashboard/account/tokens — that token lives only inside GitHub's own encrypted secrets store and is used only by this workflow; it is never seen by, or passed through, any AI assistant. Then run the workflow from the repo's Actions tab (or `gh workflow run deploy-email-functions.yml`). It deploys `newsletter-subscribe`, `newsletter-unsubscribe`, `send-emails`, and `weekly-scheduler` JWT-verified, and `resend-webhook` with `--no-verify-jwt` (Resend can't send a Supabase JWT; security there is entirely the Svix signature check).
2. **Create the cron Vault secret** (if not already done) — in the Supabase SQL editor, run once: `select vault.create_secret('<Project API "service_role" key from Project Settings -> API>', 'project_service_role_key');`. Owner-entered only; never seen by the assistant. Once this exists AND the functions are deployed, the two cron jobs already scheduled in step 9 start working on their own — no further action needed.
3. Send test emails (all 5 types) to the configured admin test recipient only, via `/admin/email.html`'s Preview/Send Test; verify formatting, links, unsubscribe behavior, and idempotency (re-trigger the same order status change and confirm no duplicate row/send).
4. Verify a real Resend webhook event round-trips into `email_webhook_events` with a valid signature (and that a deliberately-wrong signature is rejected with 401).
5. Only after all of the above pass: enable `order_emails_enabled` and/or `newsletter_enabled` on `/admin/email.html` — the Sunday 6 PM Europe/Berlin schedule only ever fires a real campaign once `newsletter_enabled` is on.
