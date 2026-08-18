-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818143411_tighten_order_email_trigger_grants.sql
--
-- Restores Postgres's implicit default (EXECUTE granted to PUBLIC),
-- which is what was in effect before that migration explicitly
-- revoked it. Harmless either way, since PostgREST never exposes a
-- trigger-return-type function as a callable RPC regardless of
-- grants -- see that migration's own comment for the live-verified
-- proof.
-- ============================================================
begin;

grant execute on function public.enqueue_order_received_email() to public;
grant execute on function public.enqueue_order_status_email() to public;

commit;
