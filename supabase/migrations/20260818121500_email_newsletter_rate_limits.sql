-- ============================================================
-- Newsletter signup rate-limit bucket (bot/abuse protection).
--
-- The newsletter-subscribe Edge Function checks this table before
-- accepting a signup: it counts recent attempts for two bucket
-- keys -- the normalized email address, and a SHA-256 hash of the
-- caller's IP (never the raw IP) -- and rejects the request if
-- either bucket is over the configured threshold within the
-- configured window (see supabase/functions/_shared/validation.mjs
-- `isRateLimited`, unit tested independent of any network/DB call).
--
-- Self-pruning: the Edge Function deletes its own bucket's expired
-- rows on every check, so no separate cleanup job is needed for a
-- table this small and short-lived.
-- ============================================================
begin;

create table if not exists public.newsletter_signup_attempts (
  id bigint generated always as identity primary key,
  bucket_key text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_signup_attempts_bucket
  on public.newsletter_signup_attempts (bucket_key, attempted_at desc);

alter table public.newsletter_signup_attempts enable row level security;
revoke all on public.newsletter_signup_attempts from anon;

drop policy if exists "Admins can view signup attempts" on public.newsletter_signup_attempts;
create policy "Admins can view signup attempts" on public.newsletter_signup_attempts
  for select to authenticated using (is_admin());

commit;
