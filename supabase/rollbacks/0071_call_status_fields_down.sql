-- =============================================================================
-- KUbeats - DOWN migration 0071
--
-- Reverses supabase/migrations/0071_call_status_fields.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   public.call_status_fields, dropped whole. Its FK and its unique constraint
--   go with it. Nothing else in 0071 touched any other object.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any call-status field an admin added through Settings while 0071 was in
--   effect, and any call answer stored against one in
--   follow_up_tasks.custom_fields. The answers outlive the field definition
--   either way; the definitions do not survive the drop. Check first:
--
--     select call_status, field_name from public.call_status_fields
--      where not exists (
--        select 1 from public.status_fields f
--         where f.status = call_status_fields.call_status
--           and f.field_name = call_status_fields.field_name
--      );
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice.
-- =============================================================================

begin;

-- Refuse to drop while 0073's call RPCs still read this table.
do $$
declare
  body text;
begin
  foreach body in array array[
    'log_call', 'admin_update_call_report', 'call_activity_report'
  ] loop
    if exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = body
         and position('call_status_fields' in pg_get_functiondef(p.oid)) > 0
    ) then
      raise exception
        'roll back 0073 first: public.%() still reads call_status_fields', body;
    end if;
  end loop;
end $$;

drop table if exists public.call_status_fields;


-- Prove it landed.
do $$
declare
  problems text[] := '{}';
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'call_status_fields'
  ) then
    problems := array_append(problems, 'call_status_fields is still there');
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'status_fields'
  ) then
    problems := array_append(problems, 'status_fields has gone - 0071 down must not touch it');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0071 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0071 down applied: call_status_fields is gone; status_fields untouched.';
end $$;

commit;
