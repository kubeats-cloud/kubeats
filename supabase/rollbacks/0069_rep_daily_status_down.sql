-- =============================================================================
-- KUbeats - DOWN migration 0069
--
-- Reverses supabase/migrations/0069_rep_daily_status.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   The stamp trigger and its function, the three RPCs, and the table itself.
--   Dropping the table takes its primary key, CHECK, both foreign keys, the
--   (status_date, rep_id) index, all three RLS policies and every row with it.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   It does not touch profiles, daily_plans, visits or any other table. Nothing
--   outside rep_daily_status was changed by 0069.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: every statement is IF EXISTS.
-- =============================================================================

begin;

drop trigger if exists rep_daily_status_stamp on public.rep_daily_status;

drop function if exists public.rep_daily_status_report(date, date, uuid, integer);
drop function if exists public.admin_set_rep_daily_status(uuid, date, text);
drop function if exists public.set_my_daily_status(text);
drop function if exists public.stamp_rep_daily_status();

drop table if exists public.rep_daily_status;

do $$
declare
  problems text[] := '{}';
begin
  if to_regclass('public.rep_daily_status') is not null then
    problems := array_append(problems, 'rep_daily_status still exists');
  end if;

  if to_regprocedure('public.set_my_daily_status(text)') is not null then
    problems := array_append(problems, 'set_my_daily_status still exists');
  end if;
  if to_regprocedure('public.admin_set_rep_daily_status(uuid,date,text)') is not null then
    problems := array_append(problems, 'admin_set_rep_daily_status still exists');
  end if;
  if to_regprocedure('public.rep_daily_status_report(date,date,uuid,integer)') is not null then
    problems := array_append(problems, 'rep_daily_status_report still exists');
  end if;
  if to_regprocedure('public.stamp_rep_daily_status()') is not null then
    problems := array_append(problems, 'stamp_rep_daily_status still exists');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0069 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0069 down applied: rep_daily_status, its trigger and all four functions '
    'are gone. Nothing outside that table was touched.';
end $$;

commit;
