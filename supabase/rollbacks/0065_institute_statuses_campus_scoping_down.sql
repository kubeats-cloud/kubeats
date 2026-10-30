-- =============================================================================
-- KUbeats - DOWN migration 0065
--
-- Reverses supabase/migrations/0065_institute_statuses_campus_scoping.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   institute_statuses_select, restored to `using (true)` - every signed-in
--   user sees every status again, exactly as 0027 left it.
--
--   institute_statuses.campus_id, dropped. Postgres drops its FK to campuses
--   and its partial index along with the column - neither is named
--   separately in the forward migration, so neither needs naming here.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any status an admin scoped to a campus while 0065 was in effect. Dropping
--   the column discards that value with no way back short of this file's own
--   history. If any row has been scoped, find it first and decide by hand
--   whether that matters:
--
--     select status, campus_id from public.institute_statuses
--      where campus_id is not null;
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0065 afterwards adds the
--   column and the campus-scoped policy back.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. institute_statuses_select, back to 0027's using (true).
-- -----------------------------------------------------------------------------
drop policy if exists institute_statuses_select on public.institute_statuses;
create policy institute_statuses_select on public.institute_statuses
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- 2. The column. Drops its FK and its partial index with it - both are
--    defined solely on this column, so Postgres removes them without CASCADE.
-- -----------------------------------------------------------------------------
alter table public.institute_statuses drop column if exists campus_id;


-- -----------------------------------------------------------------------------
-- 3. Prove it landed.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  qual     text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'institute_statuses'
       and column_name = 'campus_id'
  ) then
    problems := array_append(problems, 'institute_statuses.campus_id is still there');
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'institute_statuses'
       and indexname = 'institute_statuses_campus_idx'
  ) then
    problems := array_append(problems, 'institute_statuses_campus_idx is still there');
  end if;

  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'institute_statuses_select'
     and polrelid = 'public.institute_statuses'::regclass;

  if qual is distinct from 'true' then
    problems := array_append(problems,
      format('institute_statuses_select did not go back to using(true) - got: %s', coalesce(qual, 'NULL')));
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'institute_statuses_insert'
       and polrelid = 'public.institute_statuses'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'institute_statuses_insert lost its is_admin() gate');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0065 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0065 down applied: institute_statuses_select is using(true) again, and campus_id (with its FK and index) is gone.';
end $$;
