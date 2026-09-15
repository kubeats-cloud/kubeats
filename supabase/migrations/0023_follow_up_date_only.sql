-- =============================================================================
-- KUbeats - migration 0023: a follow-up needs a DATE, and no longer a time
--
-- ✅ SAFE TO APPLY AT ANY TIME, BEFORE OR AFTER THE CODE SHIPS.
--
-- This file only ever LOOSENS. It drops half of a requirement and adds nothing,
-- so there is no window in which the database and the app disagree in a way
-- that can refuse a visit:
--
--   apply first, deploy later   the live app still sends a date AND a time.
--                               Both are still stored. The rule simply stops
--                               insisting on the second one.
--   deploy first, apply later   the new app sends a date and no time, and
--                               FO016 refuses every open-status visit until
--                               this is run. So prefer applying first, but
--                               nothing is corrupted either way.
--
-- Contrast 0018, 0019 and 0022, each of which had to be applied immediately
-- before its deploy because it tightened something.
--
-- WHAT CHANGES
--
-- enforce_follow_up_when_open() (0018, FO016) currently demands BOTH a
-- follow_up_date and a follow_up_time whenever the status just set leaves the
-- institute open. The client's spec asks for a date only. So the trigger
-- function is replaced with one that asks for the date alone.
--
-- Nothing else moves:
--
--   * the TRIGGER is not touched. visits_follow_up_when_open still fires
--     BEFORE INSERT ON public.visits and still points at this function -
--     CREATE OR REPLACE keeps an identical signature, so the attachment and the
--     grants survive. Dropping and recreating it would be churn with a window.
--   * visits_follow_up_required_when_awaiting (0010) STAYS, untouched. It has
--     only ever required the DATE, for the two statuses that wait on somebody
--     else's answer, so it is unaffected by this change and remains the strict
--     subset it became in 0018. Kept for the reason 0018 kept it: dropping the
--     trigger must not silently lose 0010's guarantee.
--   * the COLUMN stays. public.visits.follow_up_time is not dropped, not made
--     NOT NULL, and not back-filled. It keeps every value already recorded -
--     every open-status visit logged between 0018 and now carries one - and it
--     simply stops being collected. Restoring the field is a control plus a
--     re-run of 0018's version of this function; it is not a migration that has
--     to invent data.
--
-- WHY A DORMANT COLUMN RATHER THAN A DROP
--
-- The same reason management_interest, students_reached, visit_outcome and the
-- rest of the retired closing-report fields keep theirs. A dropped column
-- cannot be un-dropped without inventing the history that was in it, and
-- report-view.tsx renders whatever a row happens to carry. This is the fourth
-- field to go dormant this way and the pattern has held every time.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Rule 5, minus the time
--
-- Reproduced in full because a function cannot be patched - the same reason
-- 0006, 0008, 0015, 0019 and 0022 each reproduced one. The body below is
-- 0018's, character for character, with exactly one change: the
-- `or new.follow_up_time is null` test is gone from the IF, and the sentence no
-- longer promises a time.
--
-- STILL A TRIGGER RATHER THAN A CHECK, and still for 0018's reason: two of the
-- three live visits at that time carried an open status with no follow-up at
-- all, so a constraint could never have been built. That has not changed, and
-- loosening a rule does not make its history any more constrainable.
--
-- STILL ASKS institute_status_is_open() rather than listing statuses, so it
-- cannot drift from public.institute_statuses - which is exactly what lets a
-- status added by an admin in a later stage be covered without touching this.
--
-- INSERT only. A visit is an account of a day and is not edited afterwards.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_follow_up_when_open()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status_set_to is null then
    return new;
  end if;

  if public.institute_status_is_open(new.status_set_to)
     and new.follow_up_date is null then
    raise exception
      'That status leaves the institute open, so a follow-up date is needed.'
      using errcode = 'FO016';
  end if;

  return new;
end;
$$;

comment on function public.enforce_follow_up_when_open is
  'Rule 5 as of 0023: an OPEN status needs a follow-up DATE. The TIME it also '
  'demanded from 0018 to 0023 is no longer required and is no longer '
  'collected; public.visits.follow_up_time is dormant, not dropped. Asks '
  'institute_status_is_open() rather than repeating the list, so it cannot '
  'drift from public.institute_statuses. A closed status may still carry a '
  'follow-up - "they said no, ask again next intake" is a real note.';

comment on column public.visits.follow_up_time is
  'DORMANT as of 0023. Collected from 0018 to 0023, when an open status '
  'required a date AND a time; the client''s spec asks for a date only, so the '
  'form stopped asking and enforce_follow_up_when_open() stopped requiring it. '
  'Every value already recorded is kept and still renders. Restoring the field '
  'is a form control plus 0018''s version of that function - no migration has '
  'to invent anything.';


-- -----------------------------------------------------------------------------
-- 2. Prove it landed
--
-- Three things, because the failure modes are different:
--
--   * the function no longer mentions follow_up_time at all. Read from
--     pg_get_functiondef rather than assumed, so a half-applied paste is caught
--     here rather than by a rep at a school gate.
--   * the trigger is still attached to it. CREATE OR REPLACE should not be able
--     to detach one, but this file's whole claim is "the trigger is untouched",
--     and an assertion is cheaper than trusting a claim.
--   * 0010's CHECK is still there. It is the guarantee that survives if the
--     trigger is ever dropped, and it is the thing most likely to be tidied
--     away by someone who reads this file and concludes the date rule now lives
--     in one place.
-- -----------------------------------------------------------------------------
do $$
declare
  fn_source text;
  problems  text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into fn_source
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_follow_up_when_open';

  if fn_source is null then
    raise exception 'enforce_follow_up_when_open() is missing entirely.';
  end if;

  if position('follow_up_time' in fn_source) > 0 then
    problems := problems
      || 'enforce_follow_up_when_open() still refers to follow_up_time';
  end if;

  if position('follow_up_date' in fn_source) = 0 then
    problems := problems
      || 'enforce_follow_up_when_open() no longer requires a follow_up_date at all';
  end if;

  if position('institute_status_is_open' in fn_source) = 0 then
    problems := problems
      || 'enforce_follow_up_when_open() stopped asking institute_status_is_open()';
  end if;

  if not exists (
    select 1
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.visits'::regclass
       and t.tgname = 'visits_follow_up_when_open'
       and p.proname = 'enforce_follow_up_when_open'
       and not t.tgisinternal
  ) then
    problems := problems
      || 'the visits_follow_up_when_open trigger is no longer attached';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'visits_follow_up_required_when_awaiting'
       and conrelid = 'public.visits'::regclass
  ) then
    problems := problems
      || '0010''s visits_follow_up_required_when_awaiting CHECK has gone';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Follow-up rule did not land cleanly: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Rule 5 is date-only. % visit(s) already carry a follow-up time; all kept, '
    'none required from here.',
    (select count(*) from public.visits where follow_up_time is not null);
end $$;


-- -----------------------------------------------------------------------------
-- 3. Reading it back
--
--   -- the rule, as the database now states it
--   select pg_get_functiondef(oid) from pg_proc where proname = 'enforce_follow_up_when_open';
--
--   -- what the dormant column still holds, and from when
--   select date, status_set_to, follow_up_date, follow_up_time
--     from public.visits
--    where follow_up_time is not null
--    order by date desc;
--
--   -- open-status visits with no date to chase on. Should be only rows that
--   -- predate 0018, since the trigger has refused them ever since.
--   select v.date, v.status_set_to
--     from public.visits v
--    where public.institute_status_is_open(v.status_set_to)
--      and v.follow_up_date is null
--    order by v.date;
-- -----------------------------------------------------------------------------
