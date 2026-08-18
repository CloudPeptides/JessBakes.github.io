/* ==========================================
   RESEND (SVIX) WEBHOOK SIGNATURE VERIFICATION

   Resend signs webhook deliveries using Svix's scheme:
     signed content = "{svix-id}.{svix-timestamp}.{raw body}"
     signature      = base64(HMAC-SHA256(base64-decode(secret after
                       "whsec_"), signed content))
   `svix-signature` can carry multiple space-separated `v1,<sig>`
   values (secret rotation); a match against ANY of them is valid.

   Pure/testable except for the two Web Crypto calls, which are a
   global standard API in both Deno and Node >= 19 -- no import
   needed, one implementation for both runtimes. No network or DB
   access happens in this file.
   ========================================== */

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = "";
    for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
    return btoa(binary);
}

async function hmacSha256Base64(secretBytes, message) {
    const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return bytesToBase64(signature);
}

/** Constant-time string comparison (equal-length check first, since
 * Svix signatures are always the same length once base64-decoded to
 * a fixed 32-byte digest -- an early-return on length mismatch here
 * leaks nothing an attacker doesn't already know from the public
 * algorithm). */
function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * @param {object} params
 * @param {string} params.secret the whsec_... signing secret from
 *   the Resend webhook dashboard
 * @param {string} params.svixId the `svix-id` header
 * @param {string} params.svixTimestamp the `svix-timestamp` header
 *   (unix seconds, as a string)
 * @param {string} params.svixSignature the `svix-signature` header,
 *   e.g. "v1,abc123== v1,def456=="
 * @param {string} params.body the raw (unparsed) request body
 * @param {number} [params.toleranceSeconds] reject timestamps older
 *   than this many seconds (replay protection). Default 300 (5 min).
 * @param {number} [params.nowSeconds] injectable for tests; defaults
 *   to the real current time.
 * @returns {Promise<{valid:boolean, reason?:string}>}
 */
export async function verifySvixSignature({
    secret, svixId, svixTimestamp, svixSignature, body,
    toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)
}) {
    if (!secret || !svixId || !svixTimestamp || !svixSignature) {
        return { valid: false, reason: "missing_headers" };
    }

    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) {
        return { valid: false, reason: "timestamp_out_of_tolerance" };
    }

    const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    let secretBytes;
    try {
        secretBytes = base64ToBytes(secretB64);
    } catch {
        return { valid: false, reason: "malformed_secret" };
    }

    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const expected = await hmacSha256Base64(secretBytes, signedContent);

    const candidates = String(svixSignature)
        .split(" ")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => (part.includes(",") ? part.split(",")[1] : part));

    const matched = candidates.some(sig => timingSafeEqual(sig, expected));

    return matched ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}

/** Maps a Resend webhook event type to the subscriber-status
 * transition it should cause (if any). Bounces and complaints make
 * a subscriber permanently ineligible for future campaigns;
 * deliveries/opens/clicks are informational only and cause no
 * status change. Unknown event types are treated as no-ops rather
 * than errors, since Resend may add new event types over time. */
export function classifyResendEvent(eventType) {
    switch (eventType) {
        case "email.bounced":
            return { subscriberStatus: "bounced", suppress: true };
        case "email.complained":
            return { subscriberStatus: "complained", suppress: true };
        case "email.delivered":
        case "email.delivery_delayed":
        case "email.opened":
        case "email.clicked":
        case "email.sent":
            return { subscriberStatus: null, suppress: false };
        default:
            return { subscriberStatus: null, suppress: false };
    }
}
