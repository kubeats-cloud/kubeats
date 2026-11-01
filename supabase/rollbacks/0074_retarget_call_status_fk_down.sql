-- =============================================================================
-- KUbeats - DOWN migration 0074
--
-- Puts follow_up_tasks.status_set_to back on the VISIT vocabulary:
--
--   call_statuses(status)  ->  institute_statuses(status)
--
-- Same constraint name (follow_up_tasks_status_set_to_fk) and the same
-- ON UPDATE RESTRICT / ON DELETE RESTRICT.
--
-- =============================================================================
-- THIS ROLLBACK IS ONLY CLEAN WHILE call_statuses HAS NOT DIVERGED FROM
-- institute_statuses.
--
-- It works before any admin adds a status that exists only in call_statuses
-- and a filed call carries it. Once such a call exists, rebuilding this key
-- against institute_statuses fails with 23503 (foreign_key_violation) on
-- validation, and THAT IS EXPECTED: the fork is one-way past that point. Do
-- not work around it by deleting the call's status or rewriting history - the
-- call already means something the visit vocabulary cannot express.
--
-- The whole file runs in one transaction. When the 23503 fires, the DROP is
-- rolled back with it and the database stays on 0074's key, so a failed
-- rollback is safe: no half-applied state.
--
-- WHAT IT DOES NOT UNDO
--   * The data: call_statuses, call_status_fields, institutes.call_status,
--     institute_call_status_history and every 0073 read path stay as they are.
--     This file moves the key and nothing else. To go further back, run 0073's
--     down, then 0072's, then 0071's, then 0070's - in that order, and only if
--     the vocabularies are still copies.
--   * No function body, view, policy or index is touched here.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Deliberately NOT pre-checked with a custom error: the native 23503 is the
--   evidence this one-way warning is real. The transaction wrapper makes it
--   atomic.
-- =============================================================================

begin;


-- 1. Drop the 0074 key and rebuild it against the visit table. Existing rows
--    are validated here, which is where a diverged call raises 23503.
alter table public.follow_up_tasks
  drop constraint if exists follow_up_tasks_status_set_to_fk;

alter table public.follow_up_tasks
  add constraint follow_up_tasks_status_set_to_fk
  foreign key (status_set_to) references public.institute_statuses (status)
  on update restrict on delete restrict;


-- 2. Prove the key is back.
do $$
declare
  problems text[] := '{}';
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'follow_up_tasks_status_set_to_fk'
       and conrelid = 'public.follow_up_tasks'::regclass
       and confrelid = 'public.institute_statuses'::regclass
       and contype = 'f'
       and confupdtype = 'r'
       and confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'follow_up_tasks_status_set_to_fk is not back on public.institute_statuses');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0074 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0074 down applied: follow_up_tasks.status_set_to references institute_statuses again.';
end $$;

commit;
