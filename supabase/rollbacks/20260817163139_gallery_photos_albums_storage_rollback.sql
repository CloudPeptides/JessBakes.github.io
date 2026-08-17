-- ============================================================
-- Rollback for 20260817163139_gallery_photos_albums_storage.sql
--
-- Deterministically reverses every statement in the forward migration, in
-- reverse dependency order, and restores public.gallery_items exactly as it
-- existed before (empty, RLS enabled, zero policies) so the schema returns
-- to its pre-migration shape. Safe to re-run (uses `if exists` throughout).
--
-- Deletes storage.objects rows for the 'gallery' bucket before dropping the
-- bucket itself -- if any real photos were uploaded before a rollback, this
-- intentionally removes their Storage objects along with the DB rows that
-- described them, so nothing is left orphaned either direction.
-- ============================================================

begin;

drop policy if exists "Admins can delete gallery objects" on storage.objects;
drop policy if exists "Admins can update gallery objects" on storage.objects;
drop policy if exists "Admins can upload gallery objects" on storage.objects;
drop policy if exists "Public can read published gallery objects" on storage.objects;
drop policy if exists "Admins can read gallery objects" on storage.objects;

delete from storage.objects where bucket_id = 'gallery';
delete from storage.buckets where id = 'gallery';

drop policy if exists "Admins can delete photos" on public.gallery_photos;
drop policy if exists "Admins can update photos" on public.gallery_photos;
drop policy if exists "Admins can insert photos" on public.gallery_photos;
drop policy if exists "Admins can view all photos" on public.gallery_photos;
drop policy if exists "Public can view published photos" on public.gallery_photos;

drop trigger if exists gallery_photos_set_updated_at on public.gallery_photos;
drop function if exists public.set_gallery_photos_updated_at();

drop table if exists public.gallery_photos;

drop policy if exists "Admins can delete albums" on public.gallery_albums;
drop policy if exists "Admins can update albums" on public.gallery_albums;
drop policy if exists "Admins can insert albums" on public.gallery_albums;
drop policy if exists "Public can view albums" on public.gallery_albums;

drop table if exists public.gallery_albums;

-- Restore the pre-migration dead table exactly as it was.
create table if not exists public.gallery_items (
    id uuid primary key default gen_random_uuid(),
    image_url text not null,
    caption text,
    visible boolean default true,
    created_at timestamptz default now()
);

alter table public.gallery_items enable row level security;
-- Intentionally zero policies, matching the original (pre-migration) state.

commit;
