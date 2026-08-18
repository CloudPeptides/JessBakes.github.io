-- ============================================================
-- Deterministic rollback for
-- supabase/migrations/20260818121500_email_newsletter_rate_limits.sql
--
-- NOT applied. No customer data lived in this table (bucket keys are
-- either a normalized email or a hashed IP, and rows are short-lived
-- by design) -- a plain drop is a complete, deterministic rollback.
-- ============================================================
begin;

drop table if exists public.newsletter_signup_attempts;

commit;
