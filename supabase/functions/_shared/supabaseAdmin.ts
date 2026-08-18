// Service-role Supabase client factory. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are automatically-provided Edge Function
// secrets (every Supabase project injects these into every function
// by default -- they are never set manually and never appear in
// this repo). This client bypasses RLS, which is exactly why every
// public-facing write in this system goes through a narrowly-scoped
// Edge Function using this client rather than a direct anon-role
// table grant.
import { createClient } from "npm:@supabase/supabase-js@2";

export function getAdminClient() {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    return createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

/** A client scoped to the CALLER's own JWT (from the Authorization
 * header), used only to ask "is this caller an admin" via the
 * existing is_admin() RPC -- the same check every other admin page
 * in this app already relies on. Never used for anything else. */
export function getCallerClient(req: Request) {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    return createClient(url, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } }
    });
}

/** True only for the platform-injected service-role JWT (used when
 * pg_cron/pg_net invokes this function on a schedule). */
export function isServiceRoleRequest(req: Request): boolean {
    const auth = req.headers.get("Authorization") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    return auth === `Bearer ${serviceRoleKey}`;
}

/** Resolves to true if the caller is either the service role (cron)
 * or a real authenticated admin. Never trusts a client-supplied
 * flag -- always re-derived from the JWT itself. */
export async function isServiceRoleOrAdmin(req: Request): Promise<boolean> {
    if (isServiceRoleRequest(req)) return true;

    try {
        const client = getCallerClient(req);
        const { data, error } = await client.rpc("is_admin");
        return !error && data === true;
    } catch {
        return false;
    }
}
