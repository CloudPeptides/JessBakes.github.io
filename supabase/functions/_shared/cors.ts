// Shared CORS headers for the two public-facing endpoints
// (newsletter-subscribe, newsletter-unsubscribe). Restricted to the
// real production origin plus localhost for local development --
// not a wildcard, since these endpoints accept writes.
const ALLOWED_ORIGINS = new Set([
    "https://jessbakessourdough.com",
    "http://localhost:8090",
    "http://127.0.0.1:8090"
]);

export function corsHeaders(req: Request): HeadersInit {
    const origin = req.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://jessbakessourdough.com";

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin"
    };
}

export function handlePreflight(req: Request): Response | null {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders(req) });
    }
    return null;
}
