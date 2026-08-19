// Web Push outbox processor + admin-facing actions. Mirrors
// send-emails/index.ts's shape:
//   { action: "status" }                -- config/subscription status
//   { action: "vapid_public_key" }      -- hand the (intentionally
//                                           public) VAPID public key
//                                           to an authenticated admin
//                                           browser, for pushManager
//                                           .subscribe()
//   { action: "process" }               -- work the pending queue
//                                           (cron / service-role)
//   { action: "test" }                  -- enqueue + immediately send
//                                           a synthetic test push to
//                                           ONLY the calling admin's
//                                           own device(s)
//   { action: "retry", outboxIds: [] }  -- requeue + immediately
//                                           reprocess specific failed
//                                           rows
import { getAdminClient, isServiceRoleOrAdmin, getCallerClient } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { processPushOutboxRow, isVapidConfigured } from "../_shared/pushOutbox.ts";

const BATCH_SIZE = 25;

async function loadSettings(adminClient: any) {
    const { data } = await adminClient.from("push_settings").select("*").limit(1).maybeSingle();
    return data || {};
}

async function processPending(adminClient: any) {
    const settings = await loadSettings(adminClient);
    const now = new Date().toISOString();

    const { data: rows } = await adminClient
        .from("push_outbox")
        .select("*")
        .in("status", ["pending", "failed"])
        .not("next_attempt_at", "is", null)
        .lte("next_attempt_at", now)
        .order("created_at", { ascending: true })
        .limit(BATCH_SIZE);

    const results = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    for (const row of rows || []) {
        // Test rows (is_test:true) are exempt from the enabled-flag
        // gate for the same reason as the email system's test sends --
        // verifying the pipeline works BEFORE turning real sending on.
        // target_admin_user_id already keeps a test row from ever
        // reaching another admin's device (see _shared/pushOutbox.ts).
        if (!row.is_test && !settings.order_push_enabled) {
            continue; // left pending, tried again next run once enabled
        }

        // Optimistic lock: only one processor run can claim a given row.
        const { data: claimed } = await adminClient
            .from("push_outbox")
            .update({ status: "sending", updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .in("status", ["pending", "failed"])
            .select()
            .maybeSingle();

        if (!claimed) continue; // lost the race to another invocation

        const outcome = await processPushOutboxRow(adminClient, claimed);
        results.processed++;
        if (outcome.success) results.sent++;
        else if (outcome.skipped) results.skipped++;
        else results.failed++;
    }

    return results;
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const headers = { ...corsHeaders(req), "Content-Type": "application/json" };
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

    if (req.method !== "POST") {
        return json({ ok: false, reason: "method_not_allowed" }, 405);
    }

    const authorized = await isServiceRoleOrAdmin(req);
    if (!authorized) {
        return json({ ok: false, reason: "forbidden" }, 403);
    }

    let body: any = {};
    try {
        body = await req.json();
    } catch {
        // process/no-body invocations (cron) are fine with an empty body
    }

    const action = body.action || "process";
    const adminClient = getAdminClient();

    if (action === "status") {
        // Never exposes the private key -- only whether all three
        // secrets are SET, same convention as send-emails' status
        // action for Resend.
        const settings = await loadSettings(adminClient);
        const { count: activeSubs } = await adminClient
            .from("admin_push_subscriptions")
            .select("id", { count: "exact", head: true })
            .eq("disabled", false);

        return json({
            ok: true,
            vapidConfigured: isVapidConfigured(),
            orderPushEnabled: Boolean(settings.order_push_enabled),
            activeSubscriptionCount: activeSubs ?? 0
        });
    }

    if (action === "vapid_public_key") {
        // Admin-only (enforced above by isServiceRoleOrAdmin), but the
        // value itself is intentionally public -- it's the exact bytes
        // every browser needs as pushManager.subscribe()'s
        // applicationServerKey. The private key never leaves Deno.env.
        const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY");
        if (!publicKey) {
            return json({ ok: false, reason: "vapid_not_configured" }, 503);
        }
        return json({ ok: true, publicKey });
    }

    if (action === "process") {
        const results = await processPending(adminClient);
        return json({ ok: true, ...results });
    }

    if (action === "test") {
        // Resolve the CALLING admin's own user id from their own JWT
        // (never trust a client-supplied admin id) so a test send can
        // only ever reach that admin's own device(s).
        const callerClient = getCallerClient(req);
        const { data: userData, error: userError } = await callerClient.auth.getUser();
        if (userError || !userData?.user?.id) {
            return json({ ok: false, reason: "no_authenticated_admin" }, 403);
        }

        const { data: row, error } = await adminClient.from("push_outbox").insert({
            event_type: "order_new",
            idempotency_key: `test:${crypto.randomUUID()}`,
            order_id: null,
            target_admin_user_id: userData.user.id,
            is_test: true
        }).select().single();

        if (error || !row) {
            return json({ ok: false, reason: "enqueue_failed" }, 500);
        }

        const outcome = await processPushOutboxRow(adminClient, row);
        return json({ ok: outcome.success && !outcome.skipped, ...outcome });
    }

    if (action === "retry") {
        const ids: string[] = Array.isArray(body.outboxIds) ? body.outboxIds : [];
        let retried = 0, sent = 0;

        for (const id of ids) {
            const { data: row } = await adminClient
                .from("push_outbox")
                .update({ status: "sending", updated_at: new Date().toISOString() })
                .eq("id", id)
                .eq("status", "failed")
                .select()
                .maybeSingle();

            if (!row) continue;
            retried++;
            const outcome = await processPushOutboxRow(adminClient, row);
            if (outcome.success) sent++;
        }

        return json({ ok: true, retried, sent });
    }

    return json({ ok: false, reason: "unknown_action" }, 400);
});
