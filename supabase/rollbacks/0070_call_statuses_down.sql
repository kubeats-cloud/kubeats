-- =============================================================================
-- KUbeats - DOWN migration 0070
--
-- Reverses supabase/migrations/0070_call_statuses.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   public.call_statuses, its two indexes, its three policies and its grants.
--   public.call_status_category() and public.call_status_is_open().
--
-- WHAT IT REFUSES TO UNDO
--
--   Any call-status row an admin added or edited after 0070. They are dropped
--   with the table; re-applying 0070 re-copies institute_statuses and does not
--   bring them back. Find them first if that matters:
--
--     select c.status from public.call_statuses c
--      where not exists (select 1 from public.institute_statuses s
--                         where s.status = c.status);
--
-- SAFE ONLY BEFORE 0072 AND 0073. 0072 adds `institutes.call_status`
-- referencing this table and 0073 makes functions read it; this file checks
-- for both and refuses with a plain message rather than failing halfway.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice.
-- =============================================================================

begin;

do $$
declare
  n integer;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'institutes'
       and column_name = 'call_status'
  ) then
    raise exception
      '0070 down refused: institutes.call_status still references call_statuses. Roll back 0072 first.';
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('log_call', 'admin_update_call_report')
     and position('call_statuses' in pg_get_functiondef(p.oid)) > 0;
  if n > 0 then
    raise exception
      '0070 down refused: % RPC(s) still read call_statuses. Roll back 0073 first.', n;
  end if;
end $$;

drop function if exists public.call_status_is_open(text);
drop function if exists public.call_status_category(text);

-- No CASCADE: if anything unexpected still references this table, the drop
-- must fail loudly rather than take that object with it.
drop table if exists public.call_statuses;

do $$
declare
  problems text[] := '{}';
begin
  if to_regclass('public.call_statuses') is not null then
    problems := array_append(problems, 'public.call_statuses is still there');
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('call_status_category', 'call_status_is_open')
  ) then
    problems := array_append(problems, 'the call_status helpers are still there');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0070 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0070 down applied: call_statuses and its helpers are gone.';
end $$;

commit;
