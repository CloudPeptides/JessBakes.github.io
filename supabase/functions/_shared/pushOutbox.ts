// The push_outbox processor. One push_outbox row = one order event,
// fanned out to every active admin_push_subscriptions row (or, for a
// test send, only the requesting admin's own rows -- see
// target_admin_user_id) at send time. Mirrors _shared/processOutbox.ts's
// shape and safety properties (idempotent enqueue already guaranteed
// by push_outbox.idempotency_key's unique constraint; sanitized-only
// error storage; limited retries with backoff).
//
// Uses the standards-based `web-push` library (VAPID + RFC 8291
// message encryption) rather than a paid push provider -- no
// third-party service is involved beyond the browser vendors' own
// push endpoints (Apple/Google/Mozilla), which is how Web Push works
// for every site, free or not.
import webpush from "npm:web-push@3";
import { buildOrderPushPayload } from "./pushPayload.mjs";
import { computeNextAttemptAt } from "./retry.mjs";

const MAX_ERROR_LENGTH = 300;
const INNER_RETRY_DELAYS_MS = [300, 900]; // short in-pass retries for a single subscription's TRANSIENT failure only

function sanitizeError(message: unknown): string {
    return String(message || "Unknown error").slice(0, MAX_ERROR_LENGTH);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True only once, cached for the lifetime of this Edge Function
 * instance -- setVapidDetails() throws if the keys are malformed, so
 * this also doubles as the "are the three secrets present and valid"
 * check the /status action reports (see send-push/index.ts). */
let vapidConfigured: boolean | null = null;
function ensureVapidConfigured(): boolean {
    if (vapidConfigured !== null) return vapidConfigured;

    const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT");

    if (!publicKey || !privateKey || !subject) {
        vapidConfigured = false;
        return false;
    }

    try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapidConfigured = true;
    } catch {
        vapidConfigured = false;
    }
    return vapidConfigured;
}

export function isVapidConfigured(): boolean {
    return ensureVapidConfigured();
}

async function loadOrderForPush(adminClient: any, orderId: string) {
    const { data: order } = await adminClient
        .from("orders")
        .select("id, customer_name, subtotal, order_type, pickup_date")
        .eq("id", orderId)
        .maybeSingle();
    return order;
}

function testPayload(rowId: string) {
    return {
        title: "🧁 Test notification",
        body: "This is a test push from Jess Bakes Admin. No real order was created.",
        tag: `test-${rowId}`,
        data: { orderId: null, url: "https://jessbakessourdough.com/admin/orders.html" }
    };
}

/** Delivers to ONE subscription, with a couple of short in-pass
 * retries for a transient failure only (never for a permanent 404/410
 * -- and never more than this one pass, so a subscription that
 * already succeeded can never be notified twice by a later outbox-row
 * retry: once this function returns, the row is marked 'sent'
 * regardless of this specific subscription's outcome). */
async function deliverToSubscription(adminClient: any, sub: any, payloadJson: string) {
    let lastError: any = null;

    for (let attempt = 0; attempt <= INNER_RETRY_DELAYS_MS.length; attempt++) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
                payloadJson,
                { TTL: 60 }
            );

            await adminClient.from("admin_push_subscriptions").update({
                last_success_at: new Date().toISOString(),
                failure_count: 0,
                last_error: null,
                updated_at: new Date().toISOString()
            }).eq("id", sub.id);

            return { ok: true };
        } catch (err: any) {
            lastError = err;
            const status = err?.statusCode;

            if (status === 404 || status === 410) {
                // Permanent: the browser/OS revoked this subscription.
                // Disable it immediately -- no retry, in-pass or later.
                await adminClient.from("admin_push_subscriptions").update({
                    disabled: true,
                    disabled_at: new Date().toISOString(),
                    last_error: sanitizeError(err?.body || err?.message),
                    updated_at: new Date().toISOString()
                }).eq("id", sub.id);
                return { ok: false, permanent: true };
            }

            if (attempt < INNER_RETRY_DELAYS_MS.length) {
                await sleep(INNER_RETRY_DELAYS_MS[attempt]);
            }
        }
    }

    await adminClient.from("admin_push_subscriptions").update({
        failure_count: (sub.failure_count || 0) + 1,
        last_error: sanitizeError(lastError?.body || lastError?.message),
        updated_at: new Date().toISOString()
    }).eq("id", sub.id);

    return { ok: false, permanent: false };
}

export async function processPushOutboxRow(adminClient: any, row: any) {
    if (!ensureVapidConfigured()) {
        await adminClient.from("push_outbox").update({
            status: "failed",
            last_error: "vapid_not_configured",
            next_attempt_at: null,
            updated_at: new Date().toISOString()
        }).eq("id", row.id);
        return { success: false, terminal: true };
    }

    let payload;

    if (row.order_id) {
        let order;
        try {
            order = await loadOrderForPush(adminClient, row.order_id);
        } catch (err: any) {
            // A genuine systemic failure (e.g. DB unreachable) -- safe
            // to retry the WHOLE row later, since nothing was sent yet.
            const nextAttempt = computeNextAttemptAt(Date.now(), (row.attempts || 0) + 1);
            await adminClient.from("push_outbox").update({
                status: "failed",
                attempts: (row.attempts || 0) + 1,
                next_attempt_at: nextAttempt.toISOString(),
                last_error: sanitizeError(err?.message),
                updated_at: new Date().toISOString()
            }).eq("id", row.id);
            return { success: false, terminal: false };
        }

        if (!order) {
            await adminClient.from("push_outbox").update({
                status: "skipped",
                last_error: "order_missing",
                updated_at: new Date().toISOString()
            }).eq("id", row.id);
            return { success: false, skipped: true, reason: "order_missing" };
        }

        payload = buildOrderPushPayload({
            orderId: order.id,
            customerName: order.customer_name,
            totalEur: order.subtotal,
            orderType: order.order_type,
            pickupDate: order.pickup_date
        });
    } else {
        // Test send: no real order, no real customer data at all.
        payload = testPayload(row.id);
    }

    let query = adminClient.from("admin_push_subscriptions").select("*").eq("disabled", false);
    if (row.target_admin_user_id) {
        query = query.eq("admin_user_id", row.target_admin_user_id);
    }

    const { data: subs, error: subsError } = await query;

    if (subsError) {
        const nextAttempt = computeNextAttemptAt(Date.now(), (row.attempts || 0) + 1);
        await adminClient.from("push_outbox").update({
            status: "failed",
            attempts: (row.attempts || 0) + 1,
            next_attempt_at: nextAttempt.toISOString(),
            last_error: sanitizeError(subsError.message),
            updated_at: new Date().toISOString()
        }).eq("id", row.id);
        return { success: false, terminal: false };
    }

    if (!subs || subs.length === 0) {
        const reason = row.target_admin_user_id ? "no_active_subscription_for_admin" : "no_active_subscriptions";
        await adminClient.from("push_outbox").update({
            status: "skipped",
            last_error: reason,
            updated_at: new Date().toISOString()
        }).eq("id", row.id);
        return { success: false, skipped: true, reason };
    }

    const payloadJson = JSON.stringify(payload);
    let delivered = 0;

    for (const sub of subs) {
        const outcome = await deliverToSubscription(adminClient, sub, payloadJson);
        if (outcome.ok) delivered++;
    }

    // The row itself is 'sent' once delivery has been ATTEMPTED for
    // every eligible subscription -- individual subscription outcomes
    // (success, permanently disabled, or a transient miss after the
    // in-pass retries above) are recorded on admin_push_subscriptions
    // itself, never by re-queuing this row (which would risk a
    // duplicate notification to a subscription that already
    // succeeded).
    await adminClient.from("push_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        attempts: (row.attempts || 0) + 1,
        last_error: delivered < subs.length ? `delivered_${delivered}_of_${subs.length}` : null,
        updated_at: new Date().toISOString()
    }).eq("id", row.id);

    return { success: true, delivered, total: subs.length };
}
