// Thin Resend API wrapper -- a plain fetch() call, no SDK dependency.
// RESEND_API_KEY is read from Deno.env only, inside this function's
// own runtime -- it is never accepted as a request parameter, never
// logged, and never returned in any response body.
export interface SendResult {
    ok: boolean;
    id?: string;
    status?: number;
    code?: string;
    message?: string;
}

export async function sendViaResend({
    from, to, subject, html, text, replyTo
}: {
    from: string; to: string; subject: string; html: string; text: string; replyTo?: string | null;
}): Promise<SendResult> {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
        return { ok: false, message: "RESEND_API_KEY is not configured" };
    }

    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject,
            html,
            text,
            reply_to: replyTo || undefined
        })
    });

    let data: any = {};
    try {
        data = await res.json();
    } catch {
        // Non-JSON error body -- fall through with an empty object.
    }

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            code: data?.name,
            // Resend's own message text -- short and provider-generated,
            // safe to store as the outbox row's sanitized last_error.
            message: data?.message || res.statusText
        };
    }

    return { ok: true, id: data?.id };
}
