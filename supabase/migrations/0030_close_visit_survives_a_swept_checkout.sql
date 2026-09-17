-- =============================================================================
-- KUbeats - migration 0030: a report can still be filed after the sweep
--
-- APPLY THIS AT ANY TIME. It only LOOSENS, like 0023 and unlike 0018/0019/0022:
-- the one behaviour it changes is a path that currently cannot complete at all,
-- and every path that works today works identically afterwards. There is no
-- deploy ordering to get right because there is no app change to pair it with -
-- this file is the whole fix.
--
-- WHAT WAS BROKEN
--
-- The recovery path trapped a report FOR EVER, and said nothing useful while it
-- did it.
--
-- Logging a visit and filing its report are ONE submit but TWO RPCs - log_visit()
-- then close_visit() - so a visit can exist with no report against it. That is a
-- real and expected state, and Pending's getUnreportedVisits() block exists
-- precisely to hand the rep the `/log?plan=` link back to it. CLAUDE.md says so
-- in as many words, and says the block must not be deleted however redundant it
-- looks.
--
-- What it does not survive is the NIGHT in between. sweep_open_checkins() (0018)
-- closes a check-in left open from a previous day by setting checkout_missing =
-- true - it never invents a checkout_at, because there is not one to invent. An
-- admin clearing a stuck visit from the "Still checked in" panel does exactly the
-- same thing through guard_checkout_missing() (FO020).
--
-- close_visit() then came back the next morning and tried to stamp a check-out
-- anyway. Its UPDATE filtered on `checkout_at is null`, which is still TRUE on a
-- swept row, so it matched - and writing checkout_at onto a row that claims the
-- check-out is missing is the one thing daily_plans_checkout_missing_valid (0014)
-- forbids:
--
--     checkout_missing = false or (checkin_at is not null and checkout_at is null)
--
-- 23514. Inside a function, so the whole transaction rolls back - the report, the
-- closed loop, all of it - and the rep gets the generic "we could not file that"
-- with nothing to act on. Every retry takes the same path and fails the same way.
-- The report was owed for ever, and the ONE screen that still offered a way back
-- to it kept offering a link that could never complete.
--
-- WHAT THIS CHANGES - ONE LINE, AND IT IS A REFUSAL TO GUESS
--
-- The daily_plans UPDATE gains `and checkout_missing = false`. On a swept or
-- admin-cleared row it now matches NOTHING, so:
--
--   the report          is filed. The visit's notes, status fields, student
--                       counts and closed loop all write exactly as they always
--                       did - none of that was ever the problem.
--   the check-out       honestly stays "not recorded". checkout_missing remains
--                       true and checkout_at remains null, which is what that
--                       pair has meant since 0014: completed, duration unknown.
--
-- THE ALTERNATIVE WAS TO CLEAR checkout_missing AND STAMP now(), and it is worse
-- for the reason 0018's sweep already gives about itself: now() is when the rep
-- got round to filing the paperwork, which may be the next morning, and writing
-- it into checkout_at would claim they stood at the institute until then. The
-- duration report would then carry an invented figure that looks exactly like a
-- measured one. A blank is readable as a blank; a wrong number is not.
--
-- It is also not the rep's column to move. guard_checkout_missing() (FO020) makes
-- checkout_missing an admin's or the sweep's, never a rep's, and close_visit() is
-- SECURITY INVOKER - so clearing it from in here would either be refused by that
-- trigger or, worse, would have needed the function rewritten as DEFINER, which
-- punches a hole straight through campus scoping. CLAUDE.md names that rewrite as
-- the thing not to do.
--
-- WHY A FILTER RATHER THAN AN `if`. The UPDATE already carries three conditions
-- that decide whether there is a check-out to stamp - the row is the caller's,
-- they arrived, they have not left. "...and nobody has already closed this for
-- them" is the fourth of the same kind, so it belongs in the same place. A
-- branch above the statement would put the same rule somewhere else and invite
-- the two to drift.
--
-- REPRODUCED IN FULL, because a function cannot be patched - the same reason
-- 0015 reproduced log_visit() and 0019, 0020b and 0022 each reproduced this one.
-- The body below is 0022's, character for character, with that single added
-- line and the comments around it.
--
-- NO SIGNATURE CHANGE, so CREATE OR REPLACE genuinely replaces and there is no
-- second overload to drop. That is the difference from 0019 and 0022, and it is
-- why this file has no drop block - but the assertion at the foot still COUNTS
-- the overloads, because "there is nothing to drop" is a claim worth checking
-- rather than a claim worth trusting.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. close_visit(), which no longer insists on stamping a check-out
-- -----------------------------------------------------------------------------
create or replace function public.close_visit(
  p_visit_id             uuid,
  p_daily_plan_id        uuid,
  p_notes                text             default null,
  p_institute_interested boolean          default null,
  p_visit_outcome        text             default null,
  p_management_response  text[]           default null,
  p_student_response     text             default null,
  p_met_name             text             default null,
  p_met_phone            text             default null,
  -- The two student counts. PRESENT, then PARTICIPATED. Both nullable, both
  -- optional, and neither is checked against the other here - see 0022 section 1.
  p_students_attended    integer          default null,
  p_students_reached     integer          default null,
  p_session_topic        text             default null,
  p_session_taken_by     text             default null,
  p_closes_visit_id      uuid             default null,
  p_checkout_lat         double precision default null,
  p_checkout_lng         double precision default null,
  p_checkout_accuracy    double precision default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member uuid := (select auth.uid());
  v_visit  public.visits%rowtype;
  v_prior  public.visits%rowtype;
begin
  if v_member is null then
    raise exception 'You must be signed in to file this.' using errcode = 'FO004';
  end if;

  select * into v_visit
    from public.visits
   where id = p_visit_id and member = v_member
   for update;

  if not found then
    raise exception 'That visit could not be found, or it is not yours.'
      using errcode = 'FO017';
  end if;

  if v_visit.reported_at is not null then
    raise exception 'That visit has already been filed.' using errcode = 'FO018';
  end if;

  update public.visits
     set notes                = coalesce(p_notes, notes),
         institute_interested = p_institute_interested,
         visit_outcome        = p_visit_outcome,
         management_response  = p_management_response,
         student_response     = p_student_response,
         met_name             = p_met_name,
         met_phone            = p_met_phone,
         students_attended    = p_students_attended,
         students_reached     = p_students_reached,
         session_topic        = p_session_topic,
         session_taken_by     = p_session_taken_by,
         closes_visit_id      = p_closes_visit_id,
         daily_plan_id        = coalesce(p_daily_plan_id, daily_plan_id),
         reported_at          = now(),
         closed_at            = case
                                  when lifecycle_status = 'Done' then now()
                                  else closed_at
                                end
   where id = p_visit_id
     and member = v_member;

  if p_closes_visit_id is not null then
    select * into v_prior
      from public.visits
     where id = p_closes_visit_id
       and member = v_member
       and institute_id = v_visit.institute_id
       and lifecycle_status = 'Set'
       and closed_at is null
     for update;

    if not found then
      raise exception 'That earlier visit cannot be closed from here.'
        using errcode = 'FO019';
    end if;

    update public.visits
       set closed_at = now()
     where id = p_closes_visit_id
       and member = v_member;
  end if;

  if p_daily_plan_id is not null then
    -- THE CHECK-OUT IS STAMPED ONLY IF THERE IS STILL ONE TO STAMP.
    --
    -- `checkout_missing = false` is the line 0030 adds, and everything above
    -- this statement is why: a row the nightly sweep or an admin has already
    -- closed carries checkout_missing = true and checkout_at null, and writing
    -- a time onto it is refused by daily_plans_checkout_missing_valid (0014)
    -- with 23514 - which rolls the report back with it.
    --
    -- Matching no row is the whole fix. The report above is already written;
    -- this simply declines to invent a departure time for a visit nobody
    -- recorded leaving. checkout_missing stays true, checkout_at stays null,
    -- and that pair has meant "completed, duration not recorded" since 0014.
    --
    -- The three conditions beside it are unchanged: the plan is the caller's,
    -- they arrived, and they have not already left.
    update public.daily_plans
       set checkout_at       = now(),
           checkout_lat      = p_checkout_lat,
           checkout_lng      = p_checkout_lng,
           checkout_accuracy = p_checkout_accuracy
     where id = p_daily_plan_id
       and member = v_member
       and checkin_at is not null
       and checkout_at is null
       and checkout_missing = false;
  end if;
end;
$$;

revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) to authenticated;

comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) is
  'Files the closing report, closes any earlier "Set" it completed, and checks '
  'the rep out - one transaction. Runs as the calling rep, so RLS and every '
  'trigger still apply. Raises FO004 and FO017-FO019. Carries BOTH student '
  'counts as of 0022: p_students_attended is PRESENT, p_students_reached is '
  'PARTICIPATED. As of 0030 the check-out is stamped only while the plan row '
  'still has one owing: a visit the nightly sweep or an admin has already '
  'closed (checkout_missing = true) files its report and keeps its honest '
  'blank, instead of failing the 0014 CHECK and rolling the report back.';


-- -----------------------------------------------------------------------------
-- 2. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  overloads integer;
  v_src     text;
begin
  -- EXACTLY ONE close_visit, or every feedback submission fails as ambiguous.
  -- Nothing in this file changes the signature, so there was nothing to drop -
  -- which is exactly the sort of claim worth checking rather than trusting.
  select count(*) into overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_visit';
  if overloads <> 1 then
    problems := problems || format('there are %s close_visit overloads, expected exactly 1', overloads);
  end if;

  -- ...and it is still 0022's 17-argument shape. A signature change here would
  -- mean this file had quietly created a SECOND function beside the live one.
  if to_regprocedure(
       'public.close_visit(uuid, uuid, text, boolean, text, text[], text, text, '
       'text, integer, integer, text, text, uuid, double precision, '
       'double precision, double precision)'
     ) is null then
    problems := problems || 'the 17-argument close_visit is missing';
  end if;

  -- Still SECURITY INVOKER, which is what makes campus scoping (0020b) apply
  -- inside it. A DEFINER rewrite would punch a hole through that boundary - and
  -- rewriting it that way was the tempting wrong fix for this very defect, so
  -- this assertion is load-bearing here rather than inherited boilerplate.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'close_visit' and p.prosecdef
  ) then
    problems := problems
      || 'close_visit is SECURITY DEFINER - campus scoping would not apply inside it';
  end if;

  -- THE ONE LINE THIS FILE EXISTS FOR. Read out of the installed body rather
  -- than assumed from the CREATE above, because a later migration reproducing
  -- this function without it would reintroduce the trap silently - which is
  -- precisely how it arrived, 0022 having copied 0019 forward.
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_visit';
  -- Anchored on `and`, so it matches the WHERE clause and not the paragraph of
  -- comment above it that also names the column.
  if v_src is null or v_src !~ 'and\s+checkout_missing\s*=\s*false' then
    problems := problems
      || 'close_visit still stamps a check-out over checkout_missing - the 0030 filter is absent';
  end if;

  -- The CHECK that turned this into a rollback is 0014's and is NOT relaxed
  -- here. It is the thing being respected, not the thing being worked around:
  -- a row carrying both a checkout_at and a claim that the check-out is missing
  -- would make the derived status a coin toss.
  if not exists (
    select 1 from pg_constraint where conname = 'daily_plans_checkout_missing_valid'
  ) then
    problems := problems || 'daily_plans_checkout_missing_valid (0014) has gone';
  end if;

  -- Both ways a row reaches checkout_missing = true must still exist, or the
  -- path this file repairs is unreachable and the repair is untested.
  if to_regprocedure('public.sweep_open_checkins()') is null then
    problems := problems || 'the nightly sweep (0018) has gone';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'daily_plans_checkout_missing_guard'
       and tgrelid = 'public.daily_plans'::regclass and not tgisinternal
  ) then
    problems := problems || 'FO020 (guard_checkout_missing) has gone';
  end if;

  -- log_visit is not touched by this file, and must still be a single overload
  -- for exactly the same reason (0015).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'log_visit') <> 1 then
    problems := problems || 'log_visit is no longer a single overload';
  end if;

  -- EVERY AUDITED GUARD STILL STANDING. This file changes one filter; it must
  -- not have moved anything that was already load-bearing.
  if not exists (select 1 from pg_trigger where tgname = 'visits_enforce_meeting_gate'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'Rule 2 (enforce_meeting_gate) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'visits_require_checkin'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'the presence guarantee (FO009) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'daily_plans_checkin_final'
                   and tgrelid = 'public.daily_plans'::regclass and not tgisinternal) then
    problems := problems || 'FO011 write-once arrival has gone';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visits_photo_required') then
    problems := problems || 'Rule 12 (visits_photo_required) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'visits_photo_final'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'FO008 write-once photo has gone';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0030 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  raise notice
    'close_visit files the report without stamping a check-out over a swept or '
    'admin-cleared plan row. Still one 17-argument overload, still SECURITY '
    'INVOKER, every audited guard still standing.';
end $$;


-- -----------------------------------------------------------------------------
-- 3. Check it took
--
--   -- the filter is in the live body
--   select p.prosrc ~ 'and\s+checkout_missing\s*=\s*false' as has_0030_filter
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'close_visit';
--
--   -- reports that were trapped. Before 0030 these could not exist at all:
--   -- a swept plan row with a filed report is the state this file makes
--   -- reachable. An honest blank duration is the expected reading.
--   select dp.date, dp.purpose, dp.checkout_missing, dp.checkout_at,
--          v.reported_at
--     from public.daily_plans dp
--     join public.visits v on v.daily_plan_id = dp.id
--    where dp.checkout_missing
--      and v.reported_at is not null
--    order by v.reported_at desc limit 20;
--
--   -- ...and the ones still owed, which is what Pending's getUnreportedVisits
--   -- block puts back in front of the rep.
--   select dp.date, dp.purpose, v.id as visit_id
--     from public.daily_plans dp
--     join public.visits v on v.daily_plan_id = dp.id
--    where dp.checkout_missing and v.reported_at is null
--    order by dp.date desc limit 20;
-- -----------------------------------------------------------------------------
