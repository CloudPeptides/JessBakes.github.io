// Public endpoint: the ONLY way a subscriber is ever unsubscribed
// from the public side. Takes an opaque, cryptographically random
// token (never a subscriber ID or email address); looks it up by
// its SHA-256 hash. No login, no second confirmation step -- one
// call, immediate effect, and idempotent (clicking an old link
// twice just re-confirms "unsubscribed", it never errors).
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { hashToken } from "../_shared/token.mjs";

Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

    if (req.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, reason: "method_not_allowed" }), { status: 405, headers });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_body" }), { status: 400, headers });
    }

    const token = String(body.token || "").trim();
    if (!token || token.length > 128) {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_token" }), { status: 200, headers });
    }

    const adminClient = getAdminClient();
    const tokenHash = await hashToken(token);

    const { data: tokenRow } = await adminClient
        .from("email_unsubscribe_tokens")
        .select("subscriber_id")
        .eq("token_hash", tokenHash)
        .maybeSingle();

    if (!tokenRow) {
        return new Response(JSON.stringify({ ok: false, reason: "invalid_token" }), { status: 200, headers });
    }

    await adminClient
        .from("subscribers")
        .update({ status: "unsubscribed" })
        .eq("id", tokenRow.subscriber_id);

    await adminClient
        .from("email_unsubscribe_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token_hash", tokenHash)
        .is("used_at", null);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});
