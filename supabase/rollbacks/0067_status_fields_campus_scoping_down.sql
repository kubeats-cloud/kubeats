-- =============================================================================
-- KUbeats - DOWN migration 0067
--
-- Reverses supabase/migrations/0067_status_fields_campus_scoping.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   status_fields_select, restored to `using (true)` - every signed-in user
--   sees every status's dynamic fields again, exactly as 0054 left it.
--
-- WHAT IT REFUSES TO UNDO
--
--   Nothing - this migration never wrote any data, only a policy. There is
--   no row to recover.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0067 afterwards restores the
--   campus-scoped select policy.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- status_fields_select, back to 0054's using (true).
-- -----------------------------------------------------------------------------
drop policy if exists status_fields_select on public.status_fields;
create policy status_fields_select on public.status_fields
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Prove it landed.
-- -----------------------------------------------------------------------------
do $$
declare
  qual text;
begin
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'status_fields_select'
     and polrelid = 'public.status_fields'::regclass;

  if qual is distinct from 'true' then
    raise exception
      '0067 down did not apply cleanly: status_fields_select did not go back to using(true) - got: %',
      coalesce(qual, 'NULL');
  end if;

  raise notice '0067 down applied: status_fields_select is using(true) again.';
end $$;
