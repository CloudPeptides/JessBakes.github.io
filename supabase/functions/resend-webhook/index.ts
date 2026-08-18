// Public endpoint (deployed with --no-verify-jwt, since Resend
// cannot send a Supabase-signed JWT). Security is entirely the Svix
// signature check below -- every request is rejected before any DB
// write unless it verifies against RESEND_WEBHOOK_SECRET.
//
// Logs only sanitized fields (event type, provider message ID, a
// short reason string) -- never the full raw payload, which
// contains the recipient's email address.
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { verifySvixSignature, classifyResendEvent } from "../_shared/webhook.mjs";

const MAX_DETAIL_LENGTH = 200;

Deno.serve(async (req) => {
    if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
    }

    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    const rawBody = await req.text();

    const verification = await verifySvixSignature({
        secret: secret || "",
        svixId: req.headers.get("svix-id") || "",
        svixTimestamp: req.headers.get("svix-timestamp") || "",
        svixSignature: req.headers.get("svix-signature") || "",
        body: rawBody
    });

    if (!secret || !verification.valid) {
        // Deliberately generic -- never echoes back which check failed.
        return new Response("unauthorized", { status: 401 });
    }

    let payload: any;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return new Response("bad request", { status: 400 });
    }

    const eventType: string = payload?.type || "unknown";
    const messageId: string | null = payload?.data?.email_id || null;
    const classification = classifyResendEvent(eventType);

    const adminClient = getAdminClient();

    const { data: outboxRow } = messageId
        ? await adminClient.from("email_outbox").select("id, recipient_ref_table, recipient_ref_id").eq("provider_message_id", messageId).maybeSingle()
        : { data: null };

    const subscriberId = outboxRow?.recipient_ref_table === "subscribers" ? outboxRow.recipient_ref_id : null;

    // Sanitized detail only -- e.g. a bounce sub-type if Resend
    // includes one, truncated, never the full payload/recipient.
    const detail = String(payload?.data?.bounce_type || payload?.data?.reason || "").slice(0, MAX_DETAIL_LENGTH);

    await adminClient.from("email_webhook_events").insert({
        provider: "resend",
        event_type: eventType,
        provider_message_id: messageId,
        outbox_id: outboxRow?.id || null,
        subscriber_id: subscriberId,
        detail: detail || null,
        processed: true
    });

    if (classification.suppress && subscriberId) {
        const column = classification.subscriberStatus === "bounced" ? "bounce_count" : "complaint_count";

        const { data: current } = await adminClient
            .from("subscribers")
            .select(column)
            .eq("id", subscriberId)
            .maybeSingle();

        await adminClient.from("subscribers").update({
            status: classification.subscriberStatus,
            suppressed_at: new Date().toISOString(),
            [column]: ((current as any)?.[column] || 0) + 1
        }).eq("id", subscriberId);
    }

    return new Response("ok", { status: 200 });
});
