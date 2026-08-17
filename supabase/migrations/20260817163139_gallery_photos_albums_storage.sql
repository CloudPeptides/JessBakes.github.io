-- ============================================================
-- Gallery feature: albums + photos + storage bucket + RLS.
--
-- Drops the old, dead `public.gallery_items` table first: 0 rows, RLS
-- enabled with zero policies (flagged by the security advisor as
-- rls_enabled_no_policy, meaning it was already completely unreachable via
-- the API), no foreign keys pointing at it from any other table, and a
-- schema (image_url/caption/visible) that doesn't match this feature's real
-- requirements. Superseded by gallery_albums + gallery_photos below.
--
-- Applied directly to the hosted Supabase project via the Supabase MCP
-- `apply_migration` tool, matching the convention established by
-- 20260817092629_security_repair_bug16_17_18_orders_rls_admin_functions_cost_views.sql
-- (see that file's header comment for the full rationale of that pattern).
-- Safe to re-run against a fresh/empty database: every statement uses
-- `if not exists` / `or replace` / `drop ... if exists` throughout.
--
-- Rollback: supabase/rollbacks/20260817163139_gallery_photos_albums_storage_rollback.sql
-- ============================================================

begin;

drop table if exists public.gallery_items;

-- ============================================================
-- 1. Albums
-- ============================================================

create table if not exists public.gallery_albums (
    id bigint generated always as identity primary key,
    name text not null unique check (btrim(name) <> ''),
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

alter table public.gallery_albums enable row level security;

drop policy if exists "Public can view albums" on public.gallery_albums;
create policy "Public can view albums" on public.gallery_albums
    for select to public
    using (true);

drop policy if exists "Admins can insert albums" on public.gallery_albums;
create policy "Admins can insert albums" on public.gallery_albums
    for insert to authenticated
    with check (public.is_admin());

drop policy if exists "Admins can update albums" on public.gallery_albums;
create policy "Admins can update albums" on public.gallery_albums
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Admins can delete albums" on public.gallery_albums;
create policy "Admins can delete albums" on public.gallery_albums
    for delete to authenticated
    using (public.is_admin());

-- ============================================================
-- 2. Photos
-- ============================================================

create table if not exists public.gallery_photos (
    id uuid primary key default gen_random_uuid(),
    title text not null check (btrim(title) <> ''),
    alt_text text,
    caption text,
    album_id bigint references public.gallery_albums(id) on delete restrict,
    published boolean not null default false,
    featured boolean not null default false,
    display_order integer not null default 0,
    original_filename text not null,
    storage_path text not null unique,
    width integer,
    height integer,
    file_type text not null check (file_type in ('image/jpeg','image/png','image/webp')),
    file_size_bytes integer not null check (file_size_bytes > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint gallery_photos_alt_text_required_when_published
        check (published = false or (alt_text is not null and btrim(alt_text) <> ''))
);

create index if not exists gallery_photos_album_id_idx     on public.gallery_photos(album_id);
create index if not exists gallery_photos_published_idx    on public.gallery_photos(published);
create index if not exists gallery_photos_featured_idx     on public.gallery_photos(featured);
create index if not exists gallery_photos_display_order_idx on public.gallery_photos(display_order);
create index if not exists gallery_photos_created_at_idx   on public.gallery_photos(created_at);

create or replace function public.set_gallery_photos_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists gallery_photos_set_updated_at on public.gallery_photos;
create trigger gallery_photos_set_updated_at
before update on public.gallery_photos
for each row execute function public.set_gallery_photos_updated_at();

alter table public.gallery_photos enable row level security;

drop policy if exists "Public can view published photos" on public.gallery_photos;
create policy "Public can view published photos" on public.gallery_photos
    for select to public
    using (published = true);

drop policy if exists "Admins can view all photos" on public.gallery_photos;
create policy "Admins can view all photos" on public.gallery_photos
    for select to authenticated
    using (public.is_admin());

drop policy if exists "Admins can insert photos" on public.gallery_photos;
create policy "Admins can insert photos" on public.gallery_photos
    for insert to authenticated
    with check (public.is_admin());

drop policy if exists "Admins can update photos" on public.gallery_photos;
create policy "Admins can update photos" on public.gallery_photos
    for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

drop policy if exists "Admins can delete photos" on public.gallery_photos;
create policy "Admins can delete photos" on public.gallery_photos
    for delete to authenticated
    using (public.is_admin());

-- ============================================================
-- 3. Storage bucket + object policies
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Admins can read gallery objects" on storage.objects;
create policy "Admins can read gallery objects" on storage.objects
    for select to authenticated
    using (bucket_id = 'gallery' and public.is_admin());

drop policy if exists "Public can read published gallery objects" on storage.objects;
create policy "Public can read published gallery objects" on storage.objects
    for select to public
    using (
        bucket_id = 'gallery'
        and exists (
            select 1 from public.gallery_photos gp
            where gp.storage_path = storage.objects.name
              and gp.published = true
        )
    );

drop policy if exists "Admins can upload gallery objects" on storage.objects;
create policy "Admins can upload gallery objects" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'gallery' and public.is_admin());

drop policy if exists "Admins can update gallery objects" on storage.objects;
create policy "Admins can update gallery objects" on storage.objects
    for update to authenticated
    using (bucket_id = 'gallery' and public.is_admin())
    with check (bucket_id = 'gallery' and public.is_admin());

drop policy if exists "Admins can delete gallery objects" on storage.objects;
create policy "Admins can delete gallery objects" on storage.objects
    for delete to authenticated
    using (bucket_id = 'gallery' and public.is_admin());

commit;
