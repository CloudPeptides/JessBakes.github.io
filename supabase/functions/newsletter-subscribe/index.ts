// Public endpoint: the ONLY way a subscriber row is ever created or
// reactivated. Deployed with JWT verification ON (the anon key
// satisfies it); real protection against abuse is the honeypot +
// rate limit + email format checks below, not the JWT.
import { getAdminClient } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { validateSignup, normalizeEmail, sanitizeName, isRateLimited } from "../_shared/validation.mjs";
import { newsletterWelcomeKey } from "../_shared/idempotency.mjs";

const PRIVACY_VERSION = "2026-08-18";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5;

async function hashIp(ip: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkAndRecordBucket(adminClient: any, bucketKey: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

    const { data: recent } = await adminClient
        .from("newsletter_signup_attempts")
        .select("attempted_at")
        .eq("bucket_key", bucketKey)
        .gte("attempted_at", cutoff);

    const limited = isRateLimited(
        (recent || []).map((r: any) => new Date(r.attempted_at).getTime()),
        Date.now(),
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX_ATTEMPTS
    );

    // Record this attempt regardless of outcome, and prune old rows
    // for this bucket -- self-cleaning, no separate job needed.
    await adminClient.from("newsletter_signup_attempts").insert({ bucket_key: bucketKey });
    await adminClient.from("newsletter_signup_attempts")
        .delete()
        .eq("bucket_key", bucketKey)
        .lt("attempted_at", cutoff);

    return limited;
}

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

    const email = normalizeEmail(body.email);
    const name = sanitizeName(body.name);
    const honeypot = body.website || body.honeypot; // hidden field name kept generic
    const consentChecked = body.consent === true;

    const validation = validateSignup({ email, honeypot, consentChecked });
    if (!validation.ok) {
        // A bot/invalid submission still gets a 200 with ok:false and no
        // detail beyond a generic reason -- never a 4xx that helps an
        // attacker distinguish "your bot got caught" from "bad input."
        return new Response(JSON.stringify({ ok: false, reason: validation.reason }), { status: 200, headers });
    }

    const adminClient = getAdminClient();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipBucket = "ip:" + (await hashIp(ip));
    const emailBucket = "email:" + email;

    const ipLimited = await checkAndRecordBucket(adminClient, ipBucket);
    const emailLimited = await checkAndRecordBucket(adminClient, emailBucket);
    if (ipLimited || emailLimited) {
        return new Response(JSON.stringify({ ok: false, reason: "rate_limited" }), { status: 200, headers });
    }

    const { data: existing } = await adminClient
        .from("subscribers")
        .select("id, status, consent_event_id")
        .eq("email", email)
        .maybeSingle();

    let subscriberId: string;
    let consentEventId: string;
    let shouldWelcome: boolean;

    if (!existing) {
        const { data: created, error } = await adminClient
            .from("subscribers")
            .insert({
                email, name,
                status: "active",
                consent_at: new Date().toISOString(),
                consent_source: "newsletter_form",
                privacy_version: PRIVACY_VERSION
            })
            .select("id, consent_event_id")
            .single();

        if (error || !created) {
            return new Response(JSON.stringify({ ok: false, reason: "server_error" }), { status: 200, headers });
        }

        subscriberId = created.id;
        consentEventId = created.consent_event_id;
        shouldWelcome = true;
    } else if (existing.status !== "active") {
        // Resubscribe after unsubscribe/bounce/complaint: fresh consent,
        // reactivated -- the subscribers trigger mints a new
        // consent_event_id automatically on this status transition.
        const { data: updated, error } = await adminClient
            .from("subscribers")
            .update({
                status: "active",
                name: name || undefined,
                consent_at: new Date().toISOString(),
                consent_source: "newsletter_form",
                privacy_version: PRIVACY_VERSION
            })
            .eq("id", existing.id)
            .select("id, consent_event_id")
            .single();

        if (error || !updated) {
            return new Response(JSON.stringify({ ok: false, reason: "server_error" }), { status: 200, headers });
        }

        subscriberId = updated.id;
        consentEventId = updated.consent_event_id;
        shouldWelcome = true;
    } else {
        // Already an active subscriber -- friendly no-op, no retroactive
        // welcome email, no consent record churn.
        subscriberId = existing.id;
        consentEventId = existing.consent_event_id;
        shouldWelcome = false;
    }

    if (shouldWelcome) {
        const { error: enqueueError } = await adminClient.from("email_outbox").insert({
            email_type: "newsletter_welcome",
            idempotency_key: newsletterWelcomeKey(consentEventId),
            recipient_email: email,
            recipient_ref_table: "subscribers",
            recipient_ref_id: subscriberId
        });
        // A 23505 unique-violation here just means this exact consent
        // event's welcome email was already enqueued (e.g. a retried
        // request) -- not an error worth surfacing to the caller.
        if (enqueueError && enqueueError.code !== "23505") {
            console.error("welcome enqueue failed", enqueueError.code);
        }
    }

    return new Response(JSON.stringify({ ok: true, alreadySubscribed: !shouldWelcome }), { status: 200, headers });
});
