-- =============================================================================
-- KUbeats - migration 0018: the stage 3 core-flow rework
--
-- ⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS, NOT EARLIER.
--
-- This file both LOOSENS and TIGHTENS, so neither direction is safe to leave
-- open for long:
--
--   * it drops visits_follow_up_hidden_when_scheduled, which the CURRENT app
--     still relies on to keep a follow-up off the two "scheduled" statuses. Run
--     it early and the old app can write rows the old rule forbade.
--   * it widens the presence guarantee to EVERY activity. Run it early and the
--     old app - which only checks in for meetings - cannot log a session,
--     a campus visit or a one-shot activity at all.
--
-- So: apply, then deploy, close together. See docs/stage3-plan.md.
--
-- WHY SO MANY TRIGGERS AND SO FEW CONSTRAINTS
--
-- Four of the new rules were checked against live data before this was written,
-- following 0016's precedent, and FOUR OF THEM CANNOT BE CHECK CONSTRAINTS:
--
--   rule                              live violations   why a CHECK fails
--   ------------------------------    ---------------   -----------------
--   check-in must be located          1 of 2 check-ins  the escape-valve row
--                                                       has checkin_at and no
--                                                       coordinates
--   one visit per institute per day   1 duplicate pair  olympiad + meeting at
--                                                       AMIT on 2026-09-09
--   open status needs a follow-up     2 of 3 visits     "First meeting done"
--                                                       with no time, and one
--                                                       with no date at all
--   one open visit at a time          0                 -- this one CAN be an
--                                                       index, and is
--
-- A CHECK or a UNIQUE index is validated against every existing row the moment
-- it is added, so three of the four would fail halfway through this file and
-- leave the database part-migrated. A TRIGGER only ever sees the rows it is
-- given, so history stays exactly as it is and the new rule starts the moment
-- it is installed - which is what "this rule starts now" actually means. It is
-- also what 0014 did for the presence guarantee, for the same reason.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- The end-of-day sweep is scheduled in section 8 and needs pg_cron, which
-- 0004 already enabled. No Vault secret and no pg_net: unlike the photo purge
-- this job is pure SQL and calls no HTTP API.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. New columns
--
-- Everything nullable except one boolean with a default, so not one existing
-- row has to change and nothing here can fail on live data.
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  -- #6: this arrival's position was ASSERTED by the rep, not measured by the
  -- device. Never set silently - the app only writes it when the rep has typed
  -- a reason, and the CHECK below makes that the database's rule too.
  add column if not exists checkin_location_manual boolean not null default false,
  add column if not exists checkin_manual_reason    text;

alter table public.visits
  -- The visit's own link to the check-in it came from. Nothing joined them
  -- before: log_visit() takes p_daily_plan_id and does not store it, so
  -- "which arrival does this visit belong to" needed a three-column join on
  -- (member, date, institute_id). Auto-check-out and "meeting time = check-in
  -- time" both need the answer directly.
  add column if not exists daily_plan_id      uuid references public.daily_plans (id) on delete set null,
  -- Q2: which earlier "Set" this visit completed. See section 6.
  add column if not exists closes_visit_id    uuid references public.visits (id) on delete set null,
  -- The one genuinely new session field.
  add column if not exists session_taken_by   text,
  -- The person met, reduced to what a follow-up actually needs. public.visit_people
  -- is NOT dropped and NOT written: it holds 0 rows, so there is nothing to
  -- migrate and no reason to keep a second table, an extra statement in the
  -- RPC, and a NOT NULL contact_type the short form no longer asks about.
  add column if not exists met_name           text,
  add column if not exists met_phone          text,
  -- The one new yes/no the short form asks that nothing already stored.
  add column if not exists institute_interested boolean;

comment on column public.daily_plans.checkin_location_manual is
  'True when the rep checked in without a device position and declared why. '
  'The escape valve for #6, and deliberately a FLAG rather than a silent '
  'bypass: checkin_manual_reason carries their words and admins can see both.';
comment on column public.daily_plans.checkin_manual_reason is
  'Why the location could not be read, in the rep''s own words. Required '
  'whenever checkin_location_manual is true.';
comment on column public.visits.daily_plan_id is
  'The check-in this visit came from. The meeting time a screen shows is that '
  'row''s checkin_at - server-stamped, so it cannot be mistyped or backdated.';
comment on column public.visits.closes_visit_id is
  'The earlier "Set" visit this one completed. The Set row keeps its own '
  'lifecycle_status and simply gains a closed_at - see section 6.';

do $$
begin
  -- A declared location without the declaration is just a missing location.
  if not exists (select 1 from pg_constraint where conname = 'daily_plans_manual_reason_present') then
    alter table public.daily_plans add constraint daily_plans_manual_reason_present check (
      checkin_location_manual = false
      or (checkin_manual_reason is not null and length(btrim(checkin_manual_reason)) > 0)
    );
  end if;

  -- Mirrors visit_people_contact_number_valid, which is the shape this
  -- replaces. Builds cleanly: the column is new, so every row holds null.
  if not exists (select 1 from pg_constraint where conname = 'visits_met_phone_valid') then
    alter table public.visits add constraint visits_met_phone_valid check (
      met_phone is null or met_phone ~ '^[0-9]{10}$'
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_met_name_length') then
    alter table public.visits add constraint visits_met_name_length check (
      met_name is null or length(met_name) <= 120
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_session_taken_by_length') then
    alter table public.visits add constraint visits_session_taken_by_length check (
      session_taken_by is null or length(session_taken_by) <= 120
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Rule 5, reversed
--
-- 0001's visits_follow_up_hidden_when_scheduled FORBIDS a follow-up date and
-- time on 'Session scheduled' and 'Campus visit scheduled', because those
-- statuses carry their own expected_date. The new form REQUIRES one whenever
-- the visit stays open - and "next session set" is exactly those two statuses.
-- The old rule and the new one are direct opposites, so the old one goes.
--
-- visits_follow_up_required_when_awaiting (0010) STAYS. Both of its statuses
-- are open, so it is now a strict subset of the trigger below - and it is kept
-- rather than folded in, so that dropping the trigger could never silently
-- lose the guarantee 0010 added.
--
-- Dropping a constraint cannot fail on data. Nothing here is conditional.
-- -----------------------------------------------------------------------------
alter table public.visits
  drop constraint if exists visits_follow_up_hidden_when_scheduled;


-- -----------------------------------------------------------------------------
-- 3. The four new triggers
--
-- FO012 located    a check-in needs coordinates, or a declared reason
-- FO013 one open   a rep may hold one open visit at a time
-- FO014 one cycle  a checked-in plan row cannot be deleted out from under itself
-- FO016 follow-up  an open status needs a date AND a time to chase on
--
-- plus the widened presence guarantee, which keeps FO009 and its trigger name.
-- -----------------------------------------------------------------------------

/**
 * #6 - a check-in is located, or it says why not.
 *
 * Fires only on the null -> not null transition, so a row that was checked in
 * before this rule existed is never re-examined. That is the whole reason this
 * is a trigger and not a CHECK: one live row has an arrival time and no
 * coordinates, and a CHECK would have refused to build because of it.
 *
 * The coordinates stay NULLABLE and daily_plans_checkin_coords_paired (0016)
 * still guarantees they arrive whole. This adds a POLICY on top of that
 * integrity rule, and policy that may need an exception tomorrow does not
 * belong in a CHECK.
 */
create or replace function public.enforce_checkin_located()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.checkin_at is not null or new.checkin_at is null then
    return new;  -- not an arrival being recorded
  end if;

  if new.checkin_lat is null
     and coalesce(new.checkin_location_manual, false) = false then
    raise exception
      'A location is needed to check in. Turn location on, or say why it is not available.'
      using errcode = 'FO012';
  end if;

  return new;
end;
$$;

comment on function public.enforce_checkin_located is
  'Rule #6: an arrival carries a position, or carries the rep''s reason for '
  'not having one. Reverses the never-block rule 0014 and 0015 both state, '
  'deliberately, and keeps a LOGGED escape rather than a silent one.';

drop trigger if exists daily_plans_checkin_located on public.daily_plans;
create trigger daily_plans_checkin_located
  before update of checkin_at on public.daily_plans
  for each row execute function public.enforce_checkin_located();


/**
 * #7 - one open visit at a time, with a sentence.
 *
 * The partial unique index in section 4 is the actual guarantee; this exists so
 * the rep is told WHICH institute is still holding them, rather than being
 * shown a 23505. Both are kept: an index cannot raise a message, and a trigger
 * cannot settle a race.
 */
create or replace function public.enforce_one_open_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other text;
begin
  if old.checkin_at is not null or new.checkin_at is null then
    return new;
  end if;

  select i.name into v_other
    from public.daily_plans dp
    join public.institutes i on i.id = dp.institute_id
   where dp.member = new.member
     and dp.id <> new.id
     and dp.checkin_at is not null
     and dp.checkout_at is null
     and dp.checkout_missing = false
   limit 1;

  if v_other is not null then
    raise exception
      'You are still checked in at %. Finish that visit first.', v_other
      using errcode = 'FO013';
  end if;

  return new;
end;
$$;

comment on function public.enforce_one_open_visit is
  'Rule #7, the friendly half. The daily_plans_one_open_visit index is the '
  'guarantee; this names the institute still holding the rep.';

drop trigger if exists daily_plans_one_open_visit_guard on public.daily_plans;
create trigger daily_plans_one_open_visit_guard
  before update of checkin_at on public.daily_plans
  for each row execute function public.enforce_one_open_visit();


/**
 * #8 - one check-in CYCLE per institute per day.
 *
 * The rule was already almost complete and nobody had noticed:
 *
 *   daily_plans_unique_per_day (0001)  one plan row per member/date/institute
 *   daily_plans_checkin_final  (0016)  that row's checkin_at is write-once
 *
 * Together those already mean one arrival per institute per day. The hole was
 * that the plan row could be DELETED and added again - removeFromDailyPlan
 * deletes any row whose meetings_actual is null, including one already checked
 * in - which yields a fresh row, a fresh checkin_at, and a second cycle. That
 * also walked straight through FO011's write-once arrival.
 *
 * So this guards the DELETE rather than counting visits. It deliberately does
 * NOT limit how many activities one cycle records: the live data already holds
 * a legitimate olympiad + meeting at one institute on one day, and refusing
 * that would be refusing real work.
 *
 * An admin may still delete, following guard_institute_owner rather than
 * guard_photo_final: a rep who checked in at the wrong school needs someone
 * able to undo it, and an admin correcting a mistake is not the bypass this
 * exists to close.
 */
create or replace function public.guard_checkin_cycle_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if old.checkin_at is not null
     and caller is not null
     and not public.is_admin() then
    raise exception
      'This visit has already started and cannot be removed from the plan.'
      using errcode = 'FO014';
  end if;
  return old;
end;
$$;

comment on function public.guard_checkin_cycle_final is
  'Rule #8: a checked-in plan row cannot be deleted by the rep, so it cannot '
  'be re-created to buy a second check-in at the same institute on the same '
  'day. Closes an FO011 bypass that existed before this rule did. Admins and '
  'the service role may still delete.';

drop trigger if exists daily_plans_checkin_cycle_final on public.daily_plans;
create trigger daily_plans_checkin_cycle_final
  before delete on public.daily_plans
  for each row execute function public.guard_checkin_cycle_final();


/**
 * Rule 5, the new half - an open loop carries a date AND a time to chase on.
 *
 * A trigger rather than a CHECK, and for a reason worth stating: two of the
 * three live visits carry an open status with no follow-up time, and one has no
 * date at all, so a CHECK would have refused to build.
 *
 * The gain is that a plpgsql function CAN call public.institute_status_is_open()
 * - which a CHECK cannot, because that function is STABLE and reads
 * public.institute_statuses. So the open/closed list is NOT duplicated here.
 * 0010 had to name its statuses four times and guard the copies with an
 * assertion; this asks the lookup table directly and cannot drift from it.
 *
 * INSERT only. A visit is an account of a day and is not edited afterwards.
 */
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
     and (new.follow_up_date is null or new.follow_up_time is null) then
    raise exception
      'That status leaves the institute open, so a follow-up date and time are needed.'
      using errcode = 'FO016';
  end if;

  return new;
end;
$$;

comment on function public.enforce_follow_up_when_open is
  'Rule 5 as stage 3 restates it: an OPEN status needs a follow-up date and '
  'time. Asks institute_status_is_open() rather than repeating the list, so '
  'it cannot drift from public.institute_statuses. A closed status may still '
  'carry a follow-up - "they said no, ask again next intake" is a real note.';

drop trigger if exists visits_follow_up_when_open on public.visits;
create trigger visits_follow_up_when_open
  before insert on public.visits
  for each row execute function public.enforce_follow_up_when_open();


/**
 * The presence guarantee, widened from meetings to EVERY activity.
 *
 * 0014 exempted sessions, campus visits and the one-shot activities because
 * "they do not run off the daily plan". Stage 3 makes every visit run off the
 * daily plan - check in, log, feedback, auto check-out - so the exemption has
 * nothing left to describe.
 *
 * THE TRIGGER KEEPS ITS NAME, visits_require_checkin, so 0014's own assertion
 * still finds it. The function is replaced rather than edited in place, and
 * enforce_meeting_gate() is NOT touched: Rule 2 and the presence guarantee stay
 * two separate triggers exactly as 0014 insisted, so dropping either leaves the
 * other intact.
 *
 * THIS IS THE CHANGE THAT FIXES THE DEPLOY ORDER. Applied before the new code
 * ships, the old app cannot log a session at all.
 */
create or replace function public.enforce_checkin_before_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.daily_plans dp
    where dp.member = new.member
      and dp.date = new.date
      and dp.institute_id = new.institute_id
      and dp.checkin_at is not null
  ) then
    raise exception
      'Check in at this institute before logging the visit.'
      using errcode = 'FO009';
  end if;

  return new;
end;
$$;

comment on function public.enforce_checkin_before_visit is
  'The presence guarantee, for EVERY activity as of stage 3. Runs beside '
  'enforce_meeting_gate(), which is unchanged and still requires the plan row '
  'itself for a meeting.';

drop trigger if exists visits_require_checkin on public.visits;
create trigger visits_require_checkin
  before insert on public.visits
  for each row execute function public.enforce_checkin_before_visit();

-- The meetings-only version is now unreachable. Dropped so a search of pg_proc
-- gives a straight answer about which rule is live.
drop function if exists public.enforce_checkin_before_meeting();


/**
 * A check-out is a claim, like an arrival.
 *
 * Once #16 makes it automatic it also determines a RECORDED DURATION, so the
 * audit's F-4 reasoning applies to it exactly as it applied to checkin_at.
 * Follows guard_checkin_final: absolute, no admin exception.
 *
 * It does NOT interfere with the end-of-day sweep, which sets checkout_missing
 * and never touches checkout_at.
 */
create or replace function public.guard_checkout_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.checkout_at is not null
     and new.checkout_at is distinct from old.checkout_at then
    raise exception
      'The departure time was recorded on submission and cannot be changed afterwards.'
      using errcode = 'FO015';
  end if;
  return new;
end;
$$;

comment on function public.guard_checkout_final is
  'daily_plans.checkout_at is write-once, following guard_checkin_final. '
  'Raises FO015.';

drop trigger if exists daily_plans_checkout_final on public.daily_plans;
create trigger daily_plans_checkout_final
  before update of checkout_at on public.daily_plans
  for each row execute function public.guard_checkout_final();


-- -----------------------------------------------------------------------------
-- 4. #7's actual guarantee
--
-- The predicate is character-for-character the one in daily_plans_checked_in_idx
-- (0014), which is the non-unique version of the same question.
--
-- Deliberately NOT scoped by date: a visit left open from yesterday is exactly
-- what should stop a new one being started. The end-of-day sweep in section 8
-- is what stops that becoming a trap.
--
-- VERIFIED BUILDABLE: no member currently holds more than one open check-in.
-- The count is repeated as a guard below anyway, so a re-run on a database that
-- has drifted fails with a sentence rather than a duplicate-key error.
-- -----------------------------------------------------------------------------
do $$
declare
  offenders integer;
begin
  select count(*) into offenders from (
    select member
      from public.daily_plans
     where checkin_at is not null
       and checkout_at is null
       and checkout_missing = false
     group by member
    having count(*) > 1
  ) t;

  if offenders > 0 then
    raise exception
      'Cannot enforce one open visit: % member(s) already hold more than one. '
      'Close the extras first: select * from public.daily_plans where checkin_at '
      'is not null and checkout_at is null and checkout_missing = false;', offenders;
  end if;
end $$;

create unique index if not exists daily_plans_one_open_visit
  on public.daily_plans (member)
  where checkin_at is not null and checkout_at is null and checkout_missing = false;


-- -----------------------------------------------------------------------------
-- 5. Reading a visit's arrival, without a three-column join
--
-- daily_plan_id is new, so every existing visit has null there. Backfilled from
-- the unique (member, date, institute_id) key, which is exactly how the join
-- would have had to work anyway.
-- -----------------------------------------------------------------------------
update public.visits v
   set daily_plan_id = dp.id
  from public.daily_plans dp
 where v.daily_plan_id is null
   and dp.member = v.member
   and dp.date = v.date
   and dp.institute_id = v.institute_id;

create index if not exists visits_daily_plan_id_idx
  on public.visits (daily_plan_id)
  where daily_plan_id is not null;

-- Pending and the open-loops tile both read "a Set that is not yet closed".
create index if not exists visits_open_set_idx
  on public.visits (member, expected_date)
  where lifecycle_status = 'Set' and closed_at is null;


-- -----------------------------------------------------------------------------
-- 6. public.close_visit() - the feedback form, the close, and the check-out
--
-- ONE TRANSACTION, because it touches two tables and CLAUDE.md is explicit that
-- such a write goes through a Postgres function.
--
-- A NEW FUNCTION, never a parameter added to log_visit(). 0015's closing
-- assertion requires exactly one log_visit overload: adding a parameter creates
-- a second, every existing twelve-or-thirteen-argument call becomes ambiguous,
-- and every visit stops saving. log_visit() is not touched by this file at all.
--
-- SECURITY INVOKER, like log_visit(), so RLS and every trigger still apply. A
-- DEFINER function here would quietly bypass the whole model.
--
-- WHY THE "Set" ROW KEEPS ITS lifecycle_status
--
-- Rule 7 counts visits by (activity, lifecycle_status) over `date`. Closing an
-- old Set by FLIPPING it to Done would move the Done credit back into the week
-- the Set was logged AND let the new row count as a second Done. So the Set row
-- keeps its status and gains a closed_at; the new row carries closes_visit_id.
-- Week 1 keeps its "Sessions Set", week 3 earns its "Sessions Done", and each
-- week is credited with what actually happened in it.
--
-- Pending therefore reads "lifecycle_status = 'Set' and closed_at is null", and
-- so must openLoopsByMember() - miss the second and the Dashboard tile never
-- comes down.
-- -----------------------------------------------------------------------------
create or replace function public.close_visit(
  p_visit_id             uuid,
  p_daily_plan_id        uuid,
  p_notes                text             default null,
  p_institute_interested boolean          default null,
  p_management_interest  text             default null,
  p_met_name             text             default null,
  p_met_phone            text             default null,
  p_students_attended    integer          default null,
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

  -- 1. The feedback itself, and the visit's own close when it has one to do.
  --
  -- A session or campus visit logged as Done finishes the moment it is filed;
  -- a meeting has no lifecycle and never gets a closed_at, which is exactly why
  -- visits_photo_final (0006) is written as "any change at all".
  update public.visits
     set notes                = coalesce(p_notes, notes),
         institute_interested = p_institute_interested,
         management_interest  = p_management_interest,
         met_name             = p_met_name,
         met_phone            = p_met_phone,
         students_attended    = p_students_attended,
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

  -- 2. Q2 - close the earlier "Set" this visit completed, if it named one.
  --
  -- Checked rather than trusted: it must be the caller's own, at the same
  -- institute, still a Set, and still open. A rep closing somebody else's loop,
  -- or the wrong one, is the failure this is written against.
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

  -- 3. #16 - the check-out, stamped from the server clock like the arrival.
  --
  -- Filtered on checkout_at is null so a re-submission cannot move a departure
  -- that has already been recorded; guard_checkout_final would refuse it
  -- anyway, and this makes the retry silent rather than an error.
  if p_daily_plan_id is not null then
    update public.daily_plans
       set checkout_at       = now(),
           checkout_lat      = p_checkout_lat,
           checkout_lng      = p_checkout_lng,
           checkout_accuracy = p_checkout_accuracy
     where id = p_daily_plan_id
       and member = v_member
       and checkin_at is not null
       and checkout_at is null;
  end if;
end;
$$;

revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text, text, integer, text, text, uuid,
  double precision, double precision, double precision
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text, text, integer, text, text, uuid,
  double precision, double precision, double precision
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text, text, integer, text, text, uuid,
  double precision, double precision, double precision
) to authenticated;

comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text, text, integer, text, text, uuid,
  double precision, double precision, double precision
) is
  'Files the short feedback form, closes any earlier "Set" it completed, and '
  'checks the rep out - one transaction. Runs as the calling rep, so RLS and '
  'every trigger still apply. Raises FO004 and FO017-FO019.';


-- -----------------------------------------------------------------------------
-- 7. The end-of-day sweep
--
-- The ONLY safety net for an orphaned check-in, and reps never see it.
--
-- There is no rep-facing "abandon" button by design: the flow is a forced chain
-- and a rep who is still on it can always finish it - the Dashboard offers the
-- in-progress entry straight back to them. What this catches is the visit
-- nobody can finish: a dead phone, a closed browser, a rep who drove away.
--
-- It reuses the state the escape valve already used, checkout_missing = true,
-- which reads as "completed, duration not recorded". No new state, no new
-- vocabulary, and plan_visit_status() already answers Completed for it.
--
-- It does NOT set checkout_at, so guard_checkout_final never fires and no
-- departure time is invented - which is the honest answer, because there isn't
-- one.
-- -----------------------------------------------------------------------------
create table if not exists public.checkin_sweep_runs (
  id        uuid primary key default gen_random_uuid(),
  ran_at    timestamptz not null default now(),
  swept_for date        not null,
  closed    integer     not null
);

comment on table public.checkin_sweep_runs is
  'One row per nightly sweep. closed = 0 is the correct answer on a day when '
  'every rep finished properly; the row proves the job ran at all.';

alter table public.checkin_sweep_runs enable row level security;
revoke all on public.checkin_sweep_runs from authenticated;
revoke all on public.checkin_sweep_runs from anon;
grant select on public.checkin_sweep_runs to authenticated;

drop policy if exists checkin_sweep_runs_select on public.checkin_sweep_runs;
create policy checkin_sweep_runs_select on public.checkin_sweep_runs
  for select to authenticated
  using (public.is_admin());

create or replace function public.sweep_open_checkins()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.app_today();
  v_closed integer;
begin
  -- Anything still open from BEFORE today. A visit opened today is left alone:
  -- the job runs at 01:00 India time, so "before today" is yesterday and
  -- earlier, and a rep working late is never swept out from under themselves.
  update public.daily_plans
     set checkout_missing = true
   where checkin_at is not null
     and checkout_at is null
     and checkout_missing = false
     and date < v_today;

  get diagnostics v_closed = row_count;

  insert into public.checkin_sweep_runs (swept_for, closed)
  values (v_today, v_closed);

  return v_closed;
end;
$$;

comment on function public.sweep_open_checkins is
  'Closes check-ins left open from a previous day, as "completed, duration not '
  'recorded". The only safety net for an orphaned visit now that reps have no '
  'abandon button. Never invents a checkout_at.';

revoke all on function public.sweep_open_checkins() from public;
revoke all on function public.sweep_open_checkins() from anon;
revoke all on function public.sweep_open_checkins() from authenticated;


-- -----------------------------------------------------------------------------
-- 8. Schedule it
--
-- 20:00 UTC is 01:30 IST - half an hour after the photo purge, so the two
-- nightly jobs never overlap, and the middle of the night for the team either
-- way. pg_cron was enabled by 0004; no Vault secret and no pg_net are needed
-- because this job is pure SQL.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('sweep-open-checkins');
exception
  when others then null;  -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'sweep-open-checkins',
  '0 20 * * *',
  $job$ select public.sweep_open_checkins(); $job$
);


-- -----------------------------------------------------------------------------
-- 9. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c text;
  expected_cols text[] := array[
    'checkin_location_manual', 'checkin_manual_reason'
  ];
  expected_visit_cols text[] := array[
    'daily_plan_id', 'closes_visit_id', 'session_taken_by', 'met_name',
    'met_phone', 'institute_interested'
  ];
  expected_trig text[] := array[
    'daily_plans_checkin_located', 'daily_plans_one_open_visit_guard',
    'daily_plans_checkin_cycle_final', 'daily_plans_checkout_final'
  ];
begin
  foreach c in array expected_cols loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='daily_plans' and column_name=c) then
      problems := problems || format('daily_plans.%s is missing', c);
    end if;
  end loop;

  foreach c in array expected_visit_cols loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='visits' and column_name=c) then
      problems := problems || format('visits.%s is missing', c);
    end if;
  end loop;

  foreach c in array expected_trig loop
    if not exists (select 1 from pg_trigger t join pg_class r on r.oid=t.tgrelid
                    where r.relname='daily_plans' and t.tgname=c and not t.tgisinternal) then
      problems := problems || format('trigger %s is missing', c);
    end if;
  end loop;

  -- The widened presence guarantee kept the 0014 trigger NAME.
  if not exists (select 1 from pg_trigger where tgname='visits_require_checkin'
                   and tgrelid='public.visits'::regclass and not tgisinternal) then
    problems := problems || 'visits_require_checkin has gone';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='enforce_checkin_before_visit') then
    problems := problems || 'enforce_checkin_before_visit is missing';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.proname='enforce_checkin_before_meeting') then
    problems := problems || 'the meetings-only presence guarantee is still installed';
  end if;

  -- Rule 2 must be UNTOUCHED. This file adds to it and never replaces it.
  if not exists (select 1 from pg_trigger where tgname='visits_enforce_meeting_gate'
                   and tgrelid='public.visits'::regclass and not tgisinternal) then
    problems := problems || 'enforce_meeting_gate from 0001 has gone missing';
  end if;

  -- FO011 is absolute and this file must not have weakened it.
  if not exists (select 1 from pg_trigger where tgname='daily_plans_checkin_final'
                   and tgrelid='public.daily_plans'::regclass and not tgisinternal) then
    problems := problems || 'daily_plans_checkin_final (FO011) has gone';
  end if;

  -- Rule 12 likewise.
  if not exists (select 1 from pg_constraint where conname='visits_photo_required') then
    problems := problems || 'visits_photo_required has gone';
  end if;

  if exists (select 1 from pg_constraint where conname='visits_follow_up_hidden_when_scheduled') then
    problems := problems || 'visits_follow_up_hidden_when_scheduled was not dropped';
  end if;
  if not exists (select 1 from pg_constraint where conname='visits_follow_up_required_when_awaiting') then
    problems := problems || '0010''s awaiting follow-up rule has gone';
  end if;

  if not exists (select 1 from pg_trigger where tgname='visits_follow_up_when_open'
                   and tgrelid='public.visits'::regclass and not tgisinternal) then
    problems := problems || 'the open-status follow-up trigger is missing';
  end if;

  if to_regclass('public.daily_plans_one_open_visit') is null then
    problems := problems || 'the one-open-visit index is missing';
  end if;

  -- Exactly one log_visit, still. This file must not have touched it.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='log_visit') <> 1 then
    problems := problems || 'log_visit is no longer a single overload';
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='close_visit') then
    problems := problems || 'close_visit is missing';
  end if;

  if not exists (select 1 from cron.job where jobname='sweep-open-checkins') then
    problems := problems || 'the end-of-day sweep is not scheduled';
  end if;

  -- The three states the derived status must still answer, unchanged by the
  -- new checkout guard.
  if public.plan_visit_status(null, null, false) is distinct from 'Scheduled'
     or public.plan_visit_status(now(), null, false) is distinct from 'In Progress'
     or public.plan_visit_status(now(), null, true) is distinct from 'Completed' then
    problems := problems || 'plan_visit_status no longer agrees with itself';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0018 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  raise notice
    'Stage 3 core flow in place: 8 columns, 4 CHECKs, 6 triggers, 1 unique '
    'index, close_visit(), and the nightly sweep. Rule 2, Rule 12 and FO011 '
    'all still installed.';
end $$;


-- -----------------------------------------------------------------------------
-- 10. Check it took
--
--   -- the sweep, by hand, right now
--   select public.sweep_open_checkins();
--   select * from public.checkin_sweep_runs order by ran_at desc limit 5;
--
--   -- both nightly jobs
--   select jobid, schedule, jobname, active from cron.job order by jobname;
--
--   -- a check-in with no location and no reason must fail with FO012
--   update public.daily_plans set checkin_at = now()
--    where checkin_at is null limit 1;
--
--   -- who is checked in right now
--   select dp.date, i.name, dp.checkin_at, dp.checkin_location_manual,
--          dp.checkin_manual_reason
--     from public.daily_plans dp join public.institutes i on i.id = dp.institute_id
--    where dp.checkin_at is not null and dp.checkout_at is null
--      and dp.checkout_missing = false;
--
--   -- Set loops still genuinely open
--   select id, date, expected_date from public.visits
--    where lifecycle_status = 'Set' and closed_at is null;
-- -----------------------------------------------------------------------------
