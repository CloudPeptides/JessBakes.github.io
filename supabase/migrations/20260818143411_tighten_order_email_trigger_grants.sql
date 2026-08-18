-- Defense-in-depth only: verified live that PostgREST does not expose
-- either function as a callable RPC regardless of grants (both return
-- type `trigger`, which PostgREST excludes from its schema cache --
-- confirmed with a direct anon-key POST to /rest/v1/rpc/..., which
-- 404s with PGRST202 "no matches found in the schema cache", not a
-- permission error). Revoking EXECUTE from PUBLIC/anon/authenticated
-- removes the security-advisor false positive and matches this
-- project's minimal-grants convention; trigger firing itself is
-- unaffected, since Postgres invokes triggers directly, independent
-- of the invoking role's EXECUTE privilege on the trigger function.
-- Re-verified live after this change: a real anon checkout still
-- succeeds and still enqueues its outbox row.
begin;

revoke all on function public.enqueue_order_received_email() from public, anon, authenticated;
revoke all on function public.enqueue_order_status_email() from public, anon, authenticated;

commit;
