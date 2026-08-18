-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818134500_email_current_jwt_role_helper.sql
-- ============================================================
begin;

drop function if exists public.current_jwt_role();

commit;
