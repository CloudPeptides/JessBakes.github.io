-- ============================================================
-- Root-cause fix for a real bug found during activation testing:
-- Edge Functions' isServiceRoleRequest() compared the caller's raw
-- Authorization header against Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
-- by exact string equality. A live test proved the Vault-stored
-- service_role key IS genuine and privileged (it read email_settings
-- directly via PostgREST, which has zero anon grant and admin-only
-- RLS) and DOES pass Supabase's own API-gateway JWT verification
-- (confirmed via edge_logs: a 403 from inside the function, not a
-- 401 from the gateway) -- but the exact-string comparison inside
-- the function still failed, for reasons that can't be diagnosed
-- from outside the function's runtime (most likely the auto-injected
-- env var not matching byte-for-byte on this project).
--
-- Fix: stop guessing at an env var and instead ask Postgres/PostgREST
-- directly what role the CALLER'S OWN verified JWT carries --
-- auth.role() reads the already-signature-verified
-- request.jwt.claims Postgres already trusts (the same mechanism
-- every RLS policy in this project relies on), so there is nothing
-- left to get out of sync. Verified live: calling this RPC with the
-- Vault-stored key returns exactly "service_role".
-- ============================================================
begin;

create or replace function public.current_jwt_role()
returns text
language sql
stable
as $$
  select auth.role();
$$;

revoke all on function public.current_jwt_role() from public, anon;
grant execute on function public.current_jwt_role() to authenticated, service_role;

commit;
