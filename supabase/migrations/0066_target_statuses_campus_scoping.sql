-- =============================================================================
-- KUbeats - migration 0066: target_statuses gets a campus too
--
-- ✅ ADDITIVE, AND NOTHING ANYONE SEES CHANGES TODAY. Part 3 of the campus-wise
-- statuses feature, and the client's requirement 3: target statuses are their
-- own vocabulary (Part 0's investigation confirmed they are not
-- institute_statuses and not the call outcome), and the client asked for
-- campus scoping on this one too, in its own part with its own migration.
--
-- SAME SHAPE AS 0065, DELIBERATELY. public.target_statuses gets a nullable
-- campus_id (NULL = every campus, every existing row backfills to NULL) and
-- target_statuses_select is rewritten to the identical four-clause rule:
-- global, admin, own campus, or a campus holding a rep the caller
-- supervises(). Nothing here invents a second design for the same question.
--
-- ONE THING 0065 DID NOT NEED TO DO: target_statuses has never had an UPDATE
-- policy. 0047 built it insert-only on purpose — "renaming or removing a
-- target status was not asked for" — and that reasoning still holds for the
-- NAME. But the client's Part 3 ask is explicit: an admin must be able to
-- change an EXISTING target status's campus, and there is no row to change
-- without something granting UPDATE at all. So this file also adds
-- target_statuses_update, admin-gated on both halves exactly like
-- institute_statuses_update, and the matching GRANT. Nothing about NAME
-- becomes editable by policy alone — the application is the only caller, and
-- its own action (setTargetStatusCampus()) only ever sends campus_id.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--
--   * No change to institute_statuses, to any log-visit or call-log code, or
--     to follow_up_tasks.outcome. Part 0 confirmed all three are separate
--     vocabularies; this migration touches exactly one table.
--   * No re-scoping of any existing target status. The rehearsal data's one
--     row ("Rehearsal QA Status") backfills to NULL like every other row
--     would, and stays there until an admin changes it by hand.
--   * No change to target_statuses_insert - still admin-only, untouched.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0066_target_statuses_campus_scoping_down.sql drops the
--   column (with its FK and index), restores target_statuses_select to
--   `using (true)`, and removes target_statuses_update and its grant.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column. Same shape as institute_statuses.campus_id (0065): nullable,
--    RESTRICT on delete, no ON UPDATE clause, no default - so every existing
--    row is NULL with nothing further to back-fill.
-- -----------------------------------------------------------------------------
alter table public.target_statuses
  add column if not exists campus_id uuid references public.campuses (id) on delete restrict;

comment on column public.target_statuses.campus_id is
  'NULL = visible to every campus (every row seeded before this migration, and '
  'the default for a new one until an admin says otherwise). Set = visible '
  'only to that campus, its admins, and any team lead who supervises a rep '
  'there - see target_statuses_select. The PRIMARY KEY is still the bare name, '
  'so a target-status name stays globally unique even once campus-scoped.';

create index if not exists target_statuses_campus_idx
  on public.target_statuses (campus_id) where campus_id is not null;


-- -----------------------------------------------------------------------------
-- 2. target_statuses_select - the identical rewrite 0065 gave
--    institute_statuses_select. See that migration for why each clause is
--    there; nothing about the reasoning changes for a second table.
-- -----------------------------------------------------------------------------
drop policy if exists target_statuses_select on public.target_statuses;
create policy target_statuses_select on public.target_statuses
  for select to authenticated
  using (
    campus_id is null
    or public.is_admin()
    or campus_id = public.my_campus()
    or exists (
      select 1
      from public.profiles r
      where r.campus_id = target_statuses.campus_id
        and public.supervises(r.id)
    )
  );


-- -----------------------------------------------------------------------------
-- 3. target_statuses_update - new. 0047 never granted UPDATE at all; the
--    client's edit-the-campus requirement needs one admin-gated door, and
--    this is it. BOTH halves gated, same reasoning 0027 gives for
--    institute_statuses_update: scope only one and a non-admin has a way in
--    from the other side.
-- -----------------------------------------------------------------------------
grant update on public.target_statuses to authenticated;

drop policy if exists target_statuses_update on public.target_statuses;
create policy target_statuses_update on public.target_statuses
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- 4. Prove it landed.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  qual     text;
  n        integer;
begin
  -- 4a. The column, its FK, and its index.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'target_statuses'
       and column_name = 'campus_id' and is_nullable = 'YES'
  ) then
    problems := array_append(problems, 'target_statuses.campus_id is missing or not nullable');
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.target_statuses'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.campuses'::regclass
       and c.confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'target_statuses.campus_id has no RESTRICT-on-delete foreign key to campuses');
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'target_statuses'
       and indexname = 'target_statuses_campus_idx'
  ) then
    problems := array_append(problems, 'target_statuses_campus_idx is missing');
  end if;

  -- 4b. The backfill: every row that existed before this file is NULL.
  select count(*) into n from public.target_statuses where campus_id is not null;
  if n <> 0 then
    problems := array_append(problems,
      format('%s row(s) carry a campus_id - the backfill is supposed to leave every existing row NULL', n));
  end if;

  -- 4c. The select policy: the new shape, and using(true) gone.
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'target_statuses_select'
     and polrelid = 'public.target_statuses'::regclass;

  if qual is null then
    problems := array_append(problems, 'target_statuses_select is missing');
  else
    if qual = 'true' then
      problems := array_append(problems, 'target_statuses_select is still using(true) - the rewrite did not apply');
    end if;
    if position('is_admin' in qual) = 0 then
      problems := array_append(problems, 'target_statuses_select lost its admin clause');
    end if;
    if position('my_campus' in qual) = 0 then
      problems := array_append(problems, 'target_statuses_select lost its own-campus clause');
    end if;
    if position('supervises' in qual) = 0 then
      problems := array_append(problems, 'target_statuses_select lost its supervises() clause');
    end if;
    if position('campus_id is null' in lower(qual)) = 0 then
      problems := array_append(problems, 'target_statuses_select lost its global (campus_id is null) clause');
    end if;
  end if;

  -- 4d. target_statuses_update: new, admin-gated both halves, and the grant.
  if not exists (
    select 1 from pg_policy
     where polname = 'target_statuses_update'
       and polrelid = 'public.target_statuses'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'target_statuses_update is missing or not admin-gated on both halves');
  end if;
  if not has_table_privilege('authenticated', 'public.target_statuses', 'UPDATE') then
    problems := array_append(problems, 'authenticated has no UPDATE grant on target_statuses');
  end if;

  -- 4e. target_statuses_insert is untouched, and there is still no DELETE.
  if not exists (
    select 1 from pg_policy
     where polname = 'target_statuses_insert'
       and polrelid = 'public.target_statuses'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'target_statuses_insert no longer gates on is_admin()');
  end if;
  if exists (
    select 1 from pg_policy
     where polrelid = 'public.target_statuses'::regclass and polcmd = 'd'
  ) then
    problems := array_append(problems, 'a DELETE policy now exists on target_statuses - not asked for');
  end if;
  if has_table_privilege('authenticated', 'public.target_statuses', 'DELETE') then
    problems := array_append(problems, 'authenticated now holds DELETE on target_statuses - not asked for');
  end if;

  -- 4f. The name vocabulary is untouched: the PK and the case-insensitive
  --     unique index from 0059 are both still there.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.target_statuses'::regclass and contype = 'p'
  ) then
    problems := array_append(problems, 'target_statuses lost its primary key');
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'target_statuses'
       and indexname = 'target_statuses_name_normalized_unique'
  ) then
    problems := array_append(problems, 'target_statuses_name_normalized_unique (0059) has gone');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0066 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0066 applied: target_statuses has a nullable campus_id (% row(s), all '
    'NULL), backed by a RESTRICT-on-delete FK to campuses and a partial index. '
    'target_statuses_select reads NULL-or-admin-or-own-campus-or-supervised-'
    'rep''s-campus, matching institute_statuses_select (0065). '
    'target_statuses_update is new and admin-gated. Insert policy, the primary '
    'key and the case-insensitive unique index are untouched.',
    (select count(*) from public.target_statuses);
end $$;


-- =============================================================================
-- Afterwards
--
--   select count(*) from public.target_statuses;                        -- unaffected
--   select count(*) from public.target_statuses where campus_id is null; -- same number
--
--   -- scope one by hand, to rehearse the next part
--   update public.target_statuses
--      set campus_id = (select id from public.campuses where short_name = 'Karnavati')
--    where name = 'Rehearsal QA Status';
--
--   -- undo
--   update public.target_statuses set campus_id = null where name = 'Rehearsal QA Status';
-- =============================================================================
