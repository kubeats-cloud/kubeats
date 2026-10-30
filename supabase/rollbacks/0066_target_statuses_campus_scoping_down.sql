-- =============================================================================
-- KUbeats - DOWN migration 0066
--
-- Reverses supabase/migrations/0066_target_statuses_campus_scoping.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   target_statuses_select, restored to `using (true)` - every signed-in user
--   sees every target status again, exactly as 0047 left it.
--
--   target_statuses_update and its UPDATE grant, both removed - back to the
--   insert-only shape 0047 built (no way to edit a row at all, campus or
--   otherwise).
--
--   target_statuses.campus_id, dropped. Postgres drops its FK to campuses
--   and its partial index along with the column.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any target status an admin scoped to a campus while 0066 was in effect.
--   Dropping the column discards that value with no way back short of this
--   file's own history. If any row has been scoped, find it first:
--
--     select name, campus_id from public.target_statuses where campus_id is not null;
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0066 afterwards adds the
--   column, the campus-scoped select policy and the update policy back.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. target_statuses_select, back to 0047's using (true).
-- -----------------------------------------------------------------------------
drop policy if exists target_statuses_select on public.target_statuses;
create policy target_statuses_select on public.target_statuses
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- 2. target_statuses_update and its grant, removed - back to insert-only.
-- -----------------------------------------------------------------------------
drop policy if exists target_statuses_update on public.target_statuses;
revoke update on public.target_statuses from authenticated;


-- -----------------------------------------------------------------------------
-- 3. The column. Drops its FK and its partial index with it.
-- -----------------------------------------------------------------------------
alter table public.target_statuses drop column if exists campus_id;


-- -----------------------------------------------------------------------------
-- 4. Prove it landed.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  qual     text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'target_statuses'
       and column_name = 'campus_id'
  ) then
    problems := array_append(problems, 'target_statuses.campus_id is still there');
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'target_statuses'
       and indexname = 'target_statuses_campus_idx'
  ) then
    problems := array_append(problems, 'target_statuses_campus_idx is still there');
  end if;

  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'target_statuses_select'
     and polrelid = 'public.target_statuses'::regclass;

  if qual is distinct from 'true' then
    problems := array_append(problems,
      format('target_statuses_select did not go back to using(true) - got: %s', coalesce(qual, 'NULL')));
  end if;

  if exists (
    select 1 from pg_policy
     where polname = 'target_statuses_update'
       and polrelid = 'public.target_statuses'::regclass
  ) then
    problems := array_append(problems, 'target_statuses_update is still there');
  end if;

  if has_table_privilege('authenticated', 'public.target_statuses', 'UPDATE') then
    problems := array_append(problems, 'authenticated still holds UPDATE on target_statuses');
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'target_statuses_insert'
       and polrelid = 'public.target_statuses'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'target_statuses_insert lost its is_admin() gate');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0066 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0066 down applied: target_statuses_select is using(true) again, '
    'target_statuses_update and its grant are gone, and campus_id (with its '
    'FK and index) is gone.';
end $$;
