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

/** True only for a genuine service-role JWT (used when pg_cron/pg_net
 * invokes this function on a schedule).
 *
 * Deliberately does NOT compare the caller's header against
 * Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") by string equality --
 * that was tried first and proved unreliable in practice (a live
 * Vault-stored service_role key that Postgres itself verifies as
 * carrying role=service_role still failed a raw string comparison
 * inside the function, most likely because the platform-injected env
 * var doesn't byte-for-byte match the dashboard-displayed key on
 * every project/key-system generation). Instead, this asks
 * PostgREST/Postgres directly what role the caller's OWN
 * already-signature-verified JWT carries, via the current_jwt_role()
 * SQL wrapper around the standard auth.role() function -- the same
 * verification path every RLS policy in this project already trusts,
 * so there is no second value that can drift out of sync. */
export async function isServiceRoleRequest(req: Request): Promise<boolean> {
    try {
        const client = getCallerClient(req);
        const { data, error } = await client.rpc("current_jwt_role");
        return !error && data === "service_role";
    } catch {
        return false;
    }
}

/** Resolves to true if the caller is either the service role (cron)
 * or a real authenticated admin. Never trusts a client-supplied
 * flag -- always re-derived from the JWT itself. */
export async function isServiceRoleOrAdmin(req: Request): Promise<boolean> {
    if (await isServiceRoleRequest(req)) return true;

    try {
        const client = getCallerClient(req);
        const { data, error } = await client.rpc("is_admin");
        return !error && data === true;
    } catch {
        return false;
    }
}
