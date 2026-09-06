-- =============================================================================
-- KUbeats - migration 0012: the notification board (shared materials)
--
-- WHAT THIS ADDS
--
--   1. public.materials - one row per uploaded file: posters, brochures, fee
--      sheets, event letters, announcements.
--   2. A PRIVATE storage bucket, 'materials', with the size and type limits set
--      on the bucket itself.
--   3. RLS: every signed-in user reads; only an admin writes.
--
-- WHO CAN DO WHAT, AND WHY IT DIFFERS FROM visit-photos
--
-- visit-photos is owner-scoped: a rep reads their own, an admin reads all. This
-- bucket is the opposite shape - one library the whole team reads, that only an
-- admin may add to. So the SELECT policy is `true` and every write policy is
-- is_admin(). The path still starts with the uploader's id, exactly like
-- visit-photos, so a file can always be traced back to who put it there.
--
-- THREE LAYERS ON SIZE AND TYPE, ON PURPOSE
--
--   * the browser checks before uploading, so a rep is told immediately;
--   * the server action re-checks, because a form can be forged;
--   * the bucket itself carries file_size_limit and allowed_mime_types, which
--     is the one that holds against a direct call to the storage API with a
--     stolen anon key.
--
-- Materials are NOT compressed. A poster or a fee sheet has to stay
-- print-quality, so the only defence against a huge upload is the cap. Five
-- megabytes each against Supabase's 1 GB free tier is roughly 200 files if
-- every one is at the limit; in practice most are far smaller. There is no
-- retention job here - unlike visit photos, a material stays until an admin
-- deletes it, because a fee structure from last year is still a record.
--
-- STORAGE OBJECTS ARE NOT CASCADED
--
-- Deleting a materials row does NOT delete the file: storage.objects has no
-- foreign key to this table and Postgres cannot reach into the storage API. The
-- delete action removes the object first and the row second, so a failure
-- leaves a row pointing at a missing file (which the UI renders as unavailable)
-- rather than a file nobody can find. Anything orphaned is listed by the query
-- at the foot of this file.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- category is a CHECK rather than a lookup table. Unlike the institute statuses
-- in 0010, nothing is DERIVED from a category - it only groups a list - so
-- there is no mapping that could drift, and the vocabulary is mirrored in
-- src/lib/validation/material.ts with a test holding the two together.
-- -----------------------------------------------------------------------------
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  category    text not null,
  file_path   text not null,
  file_name   text not null,
  file_type   text not null,
  file_size   bigint not null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint materials_title_present check (length(btrim(title)) > 0),
  constraint materials_title_length check (length(title) <= 200),
  constraint materials_description_length check (
    description is null or length(description) <= 2000
  ),
  constraint materials_file_path_present check (length(btrim(file_path)) > 0),
  constraint materials_file_name_present check (length(btrim(file_name)) > 0),

  constraint materials_category_valid check (
    category in (
      'Poster',
      'Brochure',
      'Fee Structure',
      'Event Letter',
      'Announcement',
      'Other'
    )
  ),

  -- Images a rep can preview, plus PDF. Anything else is refused here as well
  -- as by the bucket, because a row claiming a type the file does not have
  -- would make the list lie about what it is offering.
  constraint materials_file_type_valid check (
    file_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),

  -- 5 MiB. Stated in bytes so it reads the same as the bucket limit below.
  constraint materials_file_size_valid check (
    file_size > 0 and file_size <= 5242880
  ),

  -- One row per stored object. Two rows pointing at one file would mean
  -- deleting either takes the file out from under the other.
  constraint materials_file_path_unique unique (file_path)
);

comment on table public.materials is
  'The shared content library. Everyone reads; only an admin writes. The file '
  'itself lives in the private "materials" storage bucket at file_path.';

comment on column public.materials.file_path is
  'Path inside the materials bucket: <uploader-id>/<uuid>.<ext>. Unique, so a '
  'stored object belongs to exactly one row.';

create index if not exists materials_category_idx on public.materials (category);
create index if not exists materials_created_at_idx on public.materials (created_at desc);


-- -----------------------------------------------------------------------------
-- 2. Who may read and write the rows
--
-- Privileges spelled out for the same reason as 0011: 0001's
-- `grant ... on all tables` was a one-time statement and cannot reach a table
-- created later, so relying on the Supabase project default would leave the
-- admin-only rule resting on policies alone.
-- -----------------------------------------------------------------------------
alter table public.materials enable row level security;

revoke all on public.materials from authenticated;
revoke all on public.materials from anon;
grant select, insert, update, delete on public.materials to authenticated;

drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated
  using (true);

drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials
  for insert to authenticated
  with check (public.is_admin() and uploaded_by = (select auth.uid()));

drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists materials_delete on public.materials;
create policy materials_delete on public.materials
  for delete to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 3. The bucket
--
-- PRIVATE. Fee structures and event letters are internal documents; they are
-- served through short-lived signed URLs, never a guessable public URL - the
-- same treatment visit photos get, for a different reason.
--
-- file_size_limit and allowed_mime_types are set here rather than only in the
-- app. This is the layer a forged form cannot reach: storage enforces them
-- before an object is ever written.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials',
  'materials',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only an admin uploads, and only beneath their own id, so every file is
-- traceable to who added it.
drop policy if exists materials_object_insert on storage.objects;
create policy materials_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materials'
    and public.is_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Everyone signed in may read. This is the library; that is the point of it.
drop policy if exists materials_object_select on storage.objects;
create policy materials_object_select on storage.objects
  for select to authenticated
  using (bucket_id = 'materials');

drop policy if exists materials_object_update on storage.objects;
create policy materials_object_update on storage.objects
  for update to authenticated
  using (bucket_id = 'materials' and public.is_admin())
  with check (bucket_id = 'materials' and public.is_admin());

-- An admin may remove any material, not only their own uploads: the library is
-- the team's, and the admin who added a file may have left.
drop policy if exists materials_object_delete on storage.objects;
create policy materials_object_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and public.is_admin());


-- -----------------------------------------------------------------------------
-- 4. Housekeeping query - files with no row, rows with no file
--
-- Run occasionally. The first list is objects to delete; the second is rows
-- whose file failed to upload or was removed outside the app.
--
--   -- orphaned objects (a file nobody has a row for)
--   select o.name, o.created_at
--     from storage.objects o
--     left join public.materials m on m.file_path = o.name
--    where o.bucket_id = 'materials' and m.id is null;
--
--   -- rows whose object is gone
--   select m.id, m.title, m.file_path
--     from public.materials m
--     left join storage.objects o
--       on o.bucket_id = 'materials' and o.name = m.file_path
--    where o.id is null;
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 5. Prove it landed the way it was meant to
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  bucket   record;
begin
  if to_regclass('public.materials') is null then
    problems := problems || 'the materials table is missing';
  end if;

  select * into bucket from storage.buckets where id = 'materials';
  if not found then
    problems := problems || 'the materials bucket is missing';
  else
    if bucket.public then
      problems := problems || 'the materials bucket is PUBLIC and must not be';
    end if;
    if bucket.file_size_limit is distinct from 5242880 then
      problems := problems || format(
        'the materials bucket size limit is %s, expected 5242880', bucket.file_size_limit);
    end if;
    if bucket.allowed_mime_types is null
       or not ('application/pdf' = any (bucket.allowed_mime_types)) then
      problems := problems || 'the materials bucket does not allow application/pdf';
    end if;
  end if;

  -- Everyone reads, nobody but an admin writes. Both halves matter.
  if to_regclass('public.materials') is not null then
    if not has_table_privilege('authenticated', 'public.materials', 'SELECT') then
      problems := problems || 'authenticated cannot read materials';
    end if;
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = 'materials' and policyname = 'materials_insert'
    ) then
      problems := problems || 'the materials_insert policy is missing';
    end if;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Materials are not correctly set up: %',
      array_to_string(problems, '; ');
  end if;

  raise notice 'Materials: table, private bucket (5 MiB cap) and policies in place.';
end $$;
