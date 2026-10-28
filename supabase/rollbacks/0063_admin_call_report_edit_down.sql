-- =============================================================================
-- KUbeats - DOWN migration 0063
--
-- Reverses supabase/migrations/0063_admin_call_report_edit.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   Drops public.admin_update_call_report() and public.call_report_edits
--   (with its trigger and function), and the reject_call_report_edit_mutation()
--   helper. Both are net-new in 0063 - nothing before it depends on either,
--   so there is no earlier body to restore.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any institutes.status change, institute_status_history row, or
--   cancel_upcoming_follow_ups() side effect already made through
--   admin_update_call_report() while it existed. Those are ordinary rows in
--   tables this file does not touch, and undoing them would mean guessing
--   what the institute's status would have been without the edit - which
--   is exactly the kind of invented data this schema avoids elsewhere.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice (drop ... if exists throughout).
-- =============================================================================

drop function if exists public.admin_update_call_report(
  uuid, text, date, date, text, text
);

drop trigger if exists call_report_edits_immutable on public.call_report_edits;
drop function if exists public.reject_call_report_edit_mutation();

drop policy if exists call_report_edits_admin_read on public.call_report_edits;
drop policy if exists call_report_edits_admin_insert on public.call_report_edits;

drop table if exists public.call_report_edits;


do $$
declare
  problems text[] := '{}';
begin
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_update_call_report'
  ) then
    problems := array_append(problems, 'admin_update_call_report() is still present');
  end if;

  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'call_report_edits'
  ) then
    problems := array_append(problems, 'call_report_edits is still present');
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'reject_call_report_edit_mutation'
  ) then
    problems := array_append(problems, 'reject_call_report_edit_mutation() is still present');
  end if;

  -- Everything 0063 promised not to touch is still standing.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'log_call'
  ) then
    problems := array_append(problems, 'log_call() has gone missing');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_cancel_follow_ups'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_cancel_follow_ups (0048) has gone');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0063 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0063 down applied: admin_update_call_report() and call_report_edits are gone. log_call() and institutes_cancel_follow_ups are untouched.';
end $$;
