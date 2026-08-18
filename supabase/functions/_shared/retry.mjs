/* ==========================================
   RETRY BACKOFF, PERMANENT-FAILURE CLASSIFICATION, AND THE
   TEST-MODE RECIPIENT SAFETY GUARD

   Pure functions -- no DB/network access.
   ========================================== */

const BASE_DELAY_MS = 2 * 60 * 1000;   // 2 minutes
const MAX_DELAY_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Exponential backoff, capped, deterministic (no jitter) so it's
 * exactly reproducible in tests. `attempts` is the count AFTER the
 * failure just recorded (1 = first failure). */
export function computeBackoffMs(attempts) {
    const n = Math.max(1, Number(attempts) || 1);
    return Math.min(BASE_DELAY_MS * 2 ** (n - 1), MAX_DELAY_MS);
}

export function computeNextAttemptAt(nowMs, attempts) {
    return new Date(nowMs + computeBackoffMs(attempts));
}

/** A failure is permanent (never worth retrying) if the provider
 * rejected the request outright due to something that will never
 * change on its own -- a malformed/blocked recipient, an
 * authentication failure, etc. Rate limits (429), timeouts (408),
 * and any 5xx/network failure are transient and should be retried
 * (subject to max_attempts). */
export function isPermanentFailure({ status, code } = {}) {
    if (code === "invalid_recipient" || code === "validation_error") return true;
    if (status === 401 || status === 403) return true;
    if (typeof status === "number" && status >= 400 && status < 500) {
        return status !== 429 && status !== 408;
    }
    return false;
}

/** Given the outbox row's current attempts/max_attempts and whether
 * the failure just seen was permanent, decides the row's next
 * status: 'failed' with a future next_attempt_at (retry later), or
 * 'failed' terminally (attempts exhausted or permanent failure --
 * distinguished by next_attempt_at being null in that case). */
export function nextOutboxState({ attempts, maxAttempts, permanent, nowMs }) {
    const newAttempts = attempts + 1;

    if (permanent || newAttempts >= maxAttempts) {
        return { status: "failed", attempts: newAttempts, nextAttemptAt: null, terminal: true };
    }

    return {
        status: "failed",
        attempts: newAttempts,
        nextAttemptAt: computeNextAttemptAt(nowMs, newAttempts),
        terminal: false
    };
}

/**
 * Safety guard so an admin previewing or test-sending can never
 * accidentally reach a real customer/subscriber: when isTest is
 * true, the ONLY valid destination is the configured test
 * recipient -- if none is configured, sending is refused outright
 * rather than silently falling back to the real address.
 */
export function resolveSendRecipient({ isTest, testRecipientEmail, realRecipientEmail }) {
    if (!isTest) {
        return { ok: true, recipient: realRecipientEmail };
    }
    if (!testRecipientEmail) {
        return { ok: false, reason: "missing_test_recipient" };
    }
    return { ok: true, recipient: testRecipientEmail };
}
