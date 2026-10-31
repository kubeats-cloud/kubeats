-- =============================================================================
-- KUbeats - migration 0067: status_fields follows institute_statuses' campus
--
-- ✅ ADDITIVE in the same sense 0065/0066 were: no column is removed, no row
-- changes, and an admin's own view (every status, every field) is unchanged.
-- Part 4 of the campus-wise statuses feature - "a rep sees only their
-- campus's statuses, with the RIGHT dynamic fields" - surfaced this while
-- verifying that every status-consuming read actually goes through RLS.
--
-- THE BYPASS THIS FILE CLOSES:
--
--   0065 rewrote institute_statuses_select so a rep only sees their own
--   campus's (and the global) statuses. public.status_fields (migration
--   0054) is a SEPARATE table - one row per custom field a status asks for -
--   and its own select policy was never touched: still `using (true)` from
--   the day it was created. The two tables are linked only by a foreign key
--   (status_fields.status references institute_statuses.status), and a
--   foreign key is a write-time constraint, not a read-time filter - it does
--   nothing to stop a SELECT.
--
--   The result: `listStatusFields()` (src/lib/status-fields.ts) is read with
--   no filter of its own, exactly like `listStatusCatalogue()` - but unlike
--   that function, it was still backed by `using (true)`, so a status scoped
--   to Kolkata would correctly disappear from a Karnavati rep's status
--   PICKER while its custom field (name, dropdown options, required flag)
--   kept shipping to that same rep's browser - `/log` and `/log-call` both
--   fetch every status's fields up front and filter which to RENDER on the
--   client (DynamicStatusFields), so the hidden campus's field configuration
--   was sitting in the page's own data the whole time, visible to anyone who
--   opened dev tools, never gated by anything the rep could not just read.
--
-- WHAT THIS FILE DOES, AND NOTHING ELSE:
--
--   status_fields_select is rewritten from `using (true)` to "the status this
--   row belongs to is one the caller can see", asking institute_statuses_select's
--   own four clauses through the FK rather than re-deriving them: global
--   (campus_id is null), admin, the caller's own campus, or a campus holding a
--   rep the caller supervises(). A status_fields row with no matching
--   institute_statuses row (impossible under the FK, but checked anyway) is
--   refused by construction - no match, no clause can fire.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--
--   * It does not touch status_fields_insert, status_fields_update or
--     status_fields_delete - still admin-only (0054), untouched.
--   * It does not add a second predicate against public.target_statuses.
--     Dynamic fields (0054) were only ever built for institute_statuses;
--     target_statuses has no status_fields rows and no code path reads one
--     for it. Nothing to scope.
--   * It does not change `listStatusFields()` or either page that calls it
--     with no status filter (`/log`, `/log-call`). Both were already
--     "ask the database, trust the row set that comes back" - exactly
--     `listStatusCatalogue()`'s own stance - so once the table enforces its
--     own visibility, the no-change-needed app code is correct FOR FREE.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0067_status_fields_campus_scoping_down.sql restores
--   status_fields_select to `using (true)`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- status_fields_select - scoped through the status it belongs to.
--
-- Written against institute_statuses directly (not a shared function) for the
-- same reason 0065 and 0066 each wrote their own four clauses rather than
-- factoring one out: a status_fields row has no campus_id of its own to
-- compare - it has to ask the row it belongs to, and that row's visibility
-- rule already lives in institute_statuses_select. Copying the four clauses
-- here keeps this policy readable on its own; drifting from
-- institute_statuses_select is the risk, which is why the assertion block
-- below checks this policy's text for the same four landmarks 0065 checks on
-- that one.
-- -----------------------------------------------------------------------------
drop policy if exists status_fields_select on public.status_fields;
create policy status_fields_select on public.status_fields
  for select to authenticated
  using (
    exists (
      select 1
      from public.institute_statuses s
      where s.status = status_fields.status
        and (
          s.campus_id is null
          or public.is_admin()
          or s.campus_id = public.my_campus()
          or exists (
            select 1
            from public.profiles r
            where r.campus_id = s.campus_id
              and public.supervises(r.id)
          )
        )
    )
  );


-- -----------------------------------------------------------------------------
-- Prove it landed: the policy, and that nothing else on this table moved.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  qual     text;
begin
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'status_fields_select'
     and polrelid = 'public.status_fields'::regclass;

  if qual is null then
    problems := array_append(problems, 'status_fields_select is missing');
  else
    if qual = 'true' then
      problems := array_append(problems, 'status_fields_select is still using(true) - the rewrite did not apply');
    end if;
    if position('institute_statuses' in qual) = 0 then
      problems := array_append(problems, 'status_fields_select no longer joins institute_statuses');
    end if;
    if position('is_admin' in qual) = 0 then
      problems := array_append(problems, 'status_fields_select lost its admin clause');
    end if;
    if position('my_campus' in qual) = 0 then
      problems := array_append(problems, 'status_fields_select lost its own-campus clause');
    end if;
    if position('supervises' in qual) = 0 then
      problems := array_append(problems, 'status_fields_select lost its supervises() clause');
    end if;
    if position('campus_id is null' in lower(qual)) = 0 then
      problems := array_append(problems, 'status_fields_select lost its global (campus_id is null) clause');
    end if;
  end if;

  -- The write policies are untouched - still exactly admin-gated, same as 0054.
  if not exists (
    select 1 from pg_policy
     where polname = 'status_fields_insert'
       and polrelid = 'public.status_fields'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'status_fields_insert no longer gates on is_admin()');
  end if;
  if not exists (
    select 1 from pg_policy
     where polname = 'status_fields_update'
       and polrelid = 'public.status_fields'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'status_fields_update no longer gates both halves on is_admin()');
  end if;
  if not exists (
    select 1 from pg_policy
     where polname = 'status_fields_delete'
       and polrelid = 'public.status_fields'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'status_fields_delete no longer gates on is_admin()');
  end if;

  -- The FK into institute_statuses (0054) is untouched.
  if not exists (select 1 from pg_constraint where conname = 'status_fields_status_fkey') then
    problems := array_append(problems, 'status_fields_status_fkey has gone - this migration should not have touched it');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0067 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0067 applied: status_fields_select now asks institute_statuses_select''s '
    'own visibility for the status each field belongs to - global-or-admin-or-'
    'own-campus-or-supervised-rep''s-campus. Insert/update/delete policies, '
    'and the FK into institute_statuses, are untouched.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- day-one check: an admin and every rep still see every field, because
--   -- every status today is NULL (global)
--   select count(*) from public.status_fields;                -- unaffected
--
--   -- scope a status to a campus, add a field, and rehearse from each side
--   -- (continuing 0065's own worked example)
--   update public.institute_statuses
--      set campus_id = (select id from public.campuses where short_name = 'Karnavati')
--    where status = 'ZZ Test Status (delete me)';
--
--   insert into public.status_fields (status, field_name, field_type, options, is_required)
--   values ('ZZ Test Status (delete me)', 'ZZ test field', 'text', '{}', false);
--
--   -- as a Karnavati rep: one row.  as any other campus's rep: zero rows.
--   select field_name from public.status_fields where status = 'ZZ Test Status (delete me)';
--
--   -- undo both
--   delete from public.status_fields where status = 'ZZ Test Status (delete me)';
--   update public.institute_statuses set campus_id = null
--    where status = 'ZZ Test Status (delete me)';
-- =============================================================================
