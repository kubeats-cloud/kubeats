-- =============================================================================
-- KUbeats - migration 0015: record how good a location actually was
--
-- WHY
--
-- A rep in Ahmedabad had a visit recorded about 25 km away, in Gandhinagar.
-- The geolocation options were already correct - enableHighAccuracy true,
-- maximumAge zero - so the cause was not a coarse request. It was a coarse
-- ANSWER accepted as though it were a good one: a Wi-Fi/network fix, which a
-- browser returns alongside a small-sounding accuracy figure.
--
-- That figure is a claim about PRECISION, not correctness. "137 m" means the
-- browser is confident to within 137 m of where it THINKS you are - and when
-- the Wi-Fi access-point database holds a stale entry, where it thinks you are
-- can be a different city. Nothing recorded that number, so a 5 km network fix
-- and a 10 m satellite fix were stored identically and looked identical.
--
-- This file makes accuracy part of the record. It does not, anywhere, make a
-- poor location a reason to refuse a save: Rule 12 makes the PHOTO mandatory
-- and deliberately leaves the location best-effort, because a rep in a
-- basement staff room must still be able to finish their work.
--
-- SAFE TO APPLY BEFORE THE CODE SHIPS
--
-- Every column is additive and nullable, and log_visit() gains a parameter with
-- a default. An app that does not know about accuracy carries on working
-- exactly as it does today and simply writes null. So migrate first, deploy
-- after - the opposite of 0014, which tightened a rule and had to go the other
-- way round.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The columns
--
-- Metres, as the browser reported them. Nullable throughout: a fix with no
-- accuracy figure is still a fix, and a visit with no location at all is still
-- a valid visit.
-- -----------------------------------------------------------------------------
alter table public.visits
  add column if not exists accuracy double precision;

alter table public.daily_plans
  add column if not exists checkin_accuracy  double precision,
  add column if not exists checkout_accuracy double precision;

comment on column public.visits.accuracy is
  'Reported accuracy of latitude/longitude, in metres. A PRECISION claim, not '
  'a correctness one: a small number from a Wi-Fi fix can still be a long way '
  'from the truth. Null means the device did not say.';

comment on column public.daily_plans.checkin_accuracy is
  'Reported accuracy of the check-in coordinates, in metres. Null means the '
  'device did not say, or there were no coordinates at all.';

do $$
begin
  -- A negative accuracy is meaningless; anything else is believable, including
  -- the very large numbers that are exactly what we want to be able to see.
  if not exists (select 1 from pg_constraint where conname = 'visits_accuracy_valid') then
    alter table public.visits add constraint visits_accuracy_valid check (
      accuracy is null or accuracy >= 0
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_plans_accuracy_valid') then
    alter table public.daily_plans add constraint daily_plans_accuracy_valid check (
      (checkin_accuracy is null or checkin_accuracy >= 0)
      and (checkout_accuracy is null or checkout_accuracy >= 0)
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. log_visit() carries the accuracy through
--
-- Reproduced in full because a function cannot be patched - the same reason
-- 0008 reproduced it. The body below is the one 0008 defines, character for
-- character, with exactly three changes: the new p_accuracy parameter, the
-- column in the INSERT list, and the value. Nothing else moved.
--
-- The parameter is LAST and DEFAULTED, so every existing caller keeps working
-- and simply writes null. CREATE OR REPLACE keeps the existing grants.
-- -----------------------------------------------------------------------------
create or replace function public.log_visit(
  p_institute_id     uuid,
  p_activity         text,
  p_lifecycle_status text        default null,
  p_expected_date    date        default null,
  p_latitude         double precision default null,
  p_longitude        double precision default null,
  p_photo_url        text        default null,
  p_notes            text        default null,
  p_status_set_to    text        default null,
  p_follow_up_date   date        default null,
  p_follow_up_time   time        default null,
  p_daily_plan_id    uuid        default null,
  -- 0015: how good the coordinates are, in metres. Nullable like the
  -- coordinates themselves; a fix with no accuracy is still a fix.
  p_accuracy         double precision default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member    uuid := (select auth.uid());
  -- The one change from 0006, which read the server's own calendar here.
  -- The server is UTC, so at 01:00 in Ahmedabad it still said yesterday.
  -- app_today() asks what day it is in India, and todayISO() in the app
  -- asks exactly the same question, so the plan row this gate looks for is
  -- the one the app actually wrote.
  --
  -- The old built-in is deliberately not named in this body, so that a
  -- search of pg_proc for it stays a straight answer to the question
  -- "is there any server-calendar today left in here?".
  v_today     date := public.app_today();
  v_lifecycle boolean := p_activity in ('session', 'campus_visit');
  v_plan      public.daily_plans%rowtype;
  v_visit_id  uuid;
begin
  if v_member is null then
    raise exception 'You must be signed in to log a visit.'
      using errcode = 'FO004';
  end if;

  -- Rule 12 — a visit is not evidence without its photograph.
  --
  -- Raised before the folder check below so a rep who took no picture is told
  -- that, rather than being told their photo is not theirs. The CHECK
  -- constraint added at the bottom of this file is the authority; this exists
  -- to give the app a code it can turn into a sentence.
  if p_photo_url is null or btrim(p_photo_url) = '' then
    raise exception 'A photo is required to log this visit.'
      using errcode = 'FO007';
  end if;

  -- A photo may only ever live under the uploader's own folder — the same rule
  -- the storage policy enforces, repeated here so a tampered form cannot record
  -- a path pointing at someone else's file.
  if p_photo_url is not null and p_photo_url not like v_member::text || '/%' then
    raise exception 'That photo does not belong to you.'
      using errcode = 'FO003';
  end if;

  -- Rule 2 — the meeting gate.
  --
  -- The trigger on public.visits is the authority and still fires below. This
  -- block exists to raise a sentence the app can show, and to take a row lock:
  -- two submissions racing each other would otherwise both read
  -- meetings_actual as null and both count as held.
  if p_activity = 'meeting' then
    select * into v_plan
      from public.daily_plans dp
     where dp.id = p_daily_plan_id
       and dp.member = v_member
       and dp.date = v_today
     for update;

    if not found or v_plan.institute_id is distinct from p_institute_id then
      raise exception 'That institute is not on today''s plan.'
        using errcode = 'FO001';
    end if;

    if v_plan.meetings_actual is not null then
      raise exception 'That meeting is already marked as held.'
        using errcode = 'FO002';
    end if;
  end if;

  -- 1. The visit itself.
  --
  -- `date` is always today: the day the work was logged. A "Set" session's
  -- future date lives in expected_date alone, because the weekly rollup counts
  -- by `date` and a session fixed today must earn its credit in this week.
  -- Rule 3's shape is normalised here too — a lifecycle status is kept only for
  -- the two activities that have one — so a stale form field cannot smuggle one
  -- through and trip the CHECK.
  insert into public.visits (
    institute_id, member, activity, lifecycle_status, date, expected_date,
    latitude, longitude, photo_url, notes,
    status_set_to, follow_up_date, follow_up_time, accuracy
  )
  values (
    p_institute_id,
    v_member,
    p_activity,
    case when v_lifecycle then p_lifecycle_status else null end,
    v_today,
    case when v_lifecycle and p_lifecycle_status = 'Set' then p_expected_date else null end,
    p_latitude,
    p_longitude,
    p_photo_url,
    p_notes,
    p_status_set_to,
    p_follow_up_date,
    p_follow_up_time,
    p_accuracy
  )
  returning id into v_visit_id;

  -- 2. Rule 7 — the weekly Meetings figure is counted from the plan, so marking
  --    the entry held is what makes the visit count.
  if p_activity = 'meeting' then
    update public.daily_plans
       set meetings_actual = 1,
           follow_up_date  = p_follow_up_date
     where id = p_daily_plan_id
       and member = v_member;

    if not found then
      raise exception 'Today''s plan entry could not be marked as held.'
        using errcode = 'FO005';
    end if;
  end if;

  -- 3. Rule 4 — status is set by hand; the institutes_touch_status trigger
  --    stamps who changed it and when.
  if p_status_set_to is not null then
    update public.institutes
       set status = p_status_set_to
     where id = p_institute_id;

    if not found then
      raise exception 'That institute no longer exists.'
        using errcode = 'FO006';
    end if;
  end if;

  return v_visit_id;
end;
$$;
-- Restated so this file stands on its own against a fresh restore.
revoke all on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) from public;

revoke all on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) from anon;

grant execute on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) to authenticated;


-- -----------------------------------------------------------------------------
-- The twelve-argument version from 0008 must go.
--
-- CREATE OR REPLACE could not replace it: adding a parameter changes the
-- signature, so the statement above created a SECOND function rather than
-- replacing the first. With both present, a call passing twelve arguments
-- matches each of them equally well and Postgres refuses it as ambiguous -
-- which would mean every visit failing to save. So the old one is dropped.
--
-- Guarded on the exact signature, so a second run finds nothing to do rather
-- than erroring.
--
-- The guard is to_regprocedure, which resolves one exact signature and returns
-- null when it is not there. An earlier version of this file compared
-- pg_get_function_identity_arguments against a bare list of types, which looks
-- right and never matches: that function includes the PARAMETER NAMES
-- ("p_institute_id uuid, p_activity text, ..."), so the comparison was always
-- false and the drop below was dead code. The migration then left both
-- overloads in place - the exact situation this block exists to prevent - and
-- only the assertion at the foot of the file noticed.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure(
       'public.log_visit(uuid, text, text, date, double precision, double precision, '
       'text, text, text, date, time without time zone, uuid)'
     ) is not null then
    drop function public.log_visit(
      uuid, text, text, date, double precision, double precision,
      text, text, text, date, time, uuid
    );
    raise notice 'Dropped the 12-argument log_visit; the 13-argument one replaces it.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Only now is it safe to comment on it, and even now it says which one.
--
-- This is where an earlier version of this file failed with 42725, "function
-- name public.log_visit is not unique". The comment sat directly after the
-- CREATE, at the one moment when BOTH overloads existed, and carried no
-- argument list - so Postgres had two candidates and no way to choose. It is
-- fixed twice over, because this statement is not worth being clever about:
--
--   1. it now runs AFTER the drop above, when only one function is left; and
--   2. it names the full 13-argument signature anyway, so it would still be
--      unambiguous if it ever ran while both existed.
--
-- Either one alone would do. Together they mean this line cannot fail on a
-- re-run of the whole file, whichever state the database starts in.
-- -----------------------------------------------------------------------------
comment on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) is
  'Records one visit and its two side effects (plan held, institute status) in a '
  'single transaction. Runs as the calling rep, so RLS and every trigger still '
  'apply. Raises FO001-FO009 for the cases the app turns into sentences. Dates '
  'the visit by public.app_today(), the Indian calendar day. Carries the '
  'reported location accuracy so a network fix can be told from a satellite one.';


-- -----------------------------------------------------------------------------
-- 3. Finding the fixes that were never really fixes
--
-- Worth running once after this ships, to see how much of the incoming data is
-- network-derived. Rows from before this migration have accuracy null, which
-- means "we never asked", not "it was good".
--
--   select date_trunc('day', created_at)::date as day,
--          count(*)                                   as located,
--          count(*) filter (where accuracy <= 150)     as good,
--          count(*) filter (where accuracy > 150
--                             and accuracy < 1000)     as approximate,
--          count(*) filter (where accuracy >= 1000)    as network,
--          count(*) filter (where accuracy is null)    as not_recorded
--     from public.visits
--    where latitude is not null
--    group by 1 order by 1 desc;
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 4. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  overloads integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'visits' and column_name = 'accuracy'
  ) then
    problems := problems || 'visits.accuracy is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'daily_plans'
       and column_name = 'checkin_accuracy'
  ) then
    problems := problems || 'daily_plans.checkin_accuracy is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'daily_plans'
       and column_name = 'checkout_accuracy'
  ) then
    problems := problems || 'daily_plans.checkout_accuracy is missing';
  end if;

  -- Exactly one log_visit, or a twelve-argument call becomes ambiguous and
  -- every visit fails to save. This is the check that matters most in this file.
  select count(*) into overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'log_visit';
  if overloads <> 1 then
    problems := problems || format('there are %s log_visit overloads, expected exactly 1', overloads);
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Location accuracy is not correctly set up: %',
      array_to_string(problems, '; ');
  end if;

  raise notice 'Location accuracy: columns in place, one log_visit carrying it.';
end $$;
