-- =============================================================================
-- KUbeats - migration 0008: "today" becomes the Indian calendar day
--
-- WHAT WAS WRONG
--
-- The database decided what day it was with current_date, which is the
-- server's calendar. The server is UTC. So "today" turned over at 05:30 IST,
-- and between midnight and 05:30 the database and a rep disagreed about the
-- date:
--
--   * a visit logged at 01:00 was filed against yesterday;
--   * the meeting gate looked for yesterday's plan row;
--   * a plan added at 01:00 by the app - which now reads the Indian day - lands
--     on today, so the gate could not find it at all: the rep would be told the
--     institute in front of them is not on today's plan.
--
-- That last one is why this is not cosmetic. The app half of this change is
-- already committed; until this file is applied the two halves disagree for
-- five and a half hours every night.
--
-- WHAT CHANGES
--
--   1. public.app_today()      new - the Indian calendar day, in one place
--   2. visits.date             default current_date -> app_today()
--   3. daily_plans.date        default current_date -> app_today()
--   4. public.log_visit()      v_today := app_today() (reproduced in full,
--                              because a function cannot be patched)
--
-- WHAT DOES NOT CHANGE
--
--   * The meeting-gate trigger. It compares dp.date = new.date and never asks
--     what today is, so it was always right about the relationship - it was the
--     two dates handed to it that came from different calendars.
--   * Week arithmetic. weekly_targets.week_start is supplied by the app, and
--     weekly_targets_week_starts_monday only checks that it is a Monday.
--   * Every timestamptz column. now() as an instant is not a calendar day and
--     is left alone: created_at, submitted_at, reopened_at, assigned_at,
--     status_updated_at, closed_at, reported_at, cached_at, and the photo
--     retention window, which counts elapsed hours rather than calendar days.
--   * Rows already written. Nothing is back-dated. A visit filed yesterday at
--     01:00 IST keeps the date it was given; this only decides what "today"
--     means from now on.
--
-- MUST MATCH THE APP
--
-- src/lib/dates.ts holds APP_TIME_ZONE and todayISO(). The zone below is the
-- same one on purpose. If a client is ever moved to another country both have
-- to move together, and the app_today() suite in tests/integration/rules.test.ts
-- fails loudly if only one of them does.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run: every statement is create-or-replace or set-default,
--   and nothing here reads or rewrites existing rows.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. What day is it?
--
-- STABLE rather than IMMUTABLE: it reads the clock, so Postgres will not fold
-- it into an index or a CHECK. That is correct, and it is still fine as a
-- column default, which is evaluated per row at INSERT time.
--
-- `at time zone` applied to a timestamptz is absolute - it does not consult the
-- server's TimeZone setting - so this answers the same on any host, which is
-- the entire point of the change.
-- -----------------------------------------------------------------------------
create or replace function public.app_today()
returns date
language sql
stable
set search_path = ''
as $fn$
  select (now() at time zone 'Asia/Kolkata')::date;
$fn$;

comment on function public.app_today is
  'The calendar day in Asia/Kolkata. The database''s definition of "today", and '
  'the counterpart of todayISO() in src/lib/dates.ts. The two must agree: the '
  'app writes daily_plans.date with one and log_visit checks the meeting gate '
  'with the other.';


-- -----------------------------------------------------------------------------
-- 2. The two date columns that mean "the day this happened".
--
-- The app always supplies both explicitly, so these defaults are the safety net
-- for a direct INSERT - a restore, a repair, a service-role script. They were
-- the last places current_date could still put a row on the wrong day.
-- -----------------------------------------------------------------------------
alter table public.visits      alter column date set default public.app_today();
alter table public.daily_plans alter column date set default public.app_today();


-- -----------------------------------------------------------------------------
-- 3. log_visit(), unchanged from 0006 apart from the single line marked inside.
--    Reproduced in full because a function cannot be patched.
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
  p_daily_plan_id    uuid        default null
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
    status_set_to, follow_up_date, follow_up_time
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
    p_follow_up_time
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

comment on function public.log_visit is
  'Records one visit and its two side effects (plan held, institute status) in a '
  'single transaction. Runs as the calling rep, so RLS and every trigger still '
  'apply. Raises FO001-FO008 for the cases the app turns into sentences. Dates '
  'the visit by public.app_today(), the Indian calendar day.';

-- Restated so this file stands on its own against a fresh restore. CREATE OR
-- REPLACE keeps the grants an existing function already has, so on a project
-- that has run 0002 and 0006 these three are no-ops.
revoke all on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid
) from public;

revoke all on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid
) from anon;

grant execute on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid
) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Did it work?
--
-- Run this after the file. app_today and india must match, and both defaults
-- must read app_today(). Between 18:30 and 24:00 UTC - 00:00 to 05:30 in India,
-- the window this whole migration is about - server_utc will differ from the
-- other two, which is exactly the bug being fixed.
-- -----------------------------------------------------------------------------
-- select public.app_today()                        as app_today,
--        (now() at time zone 'Asia/Kolkata')::date as india,
--        current_date                              as server_utc;
--
-- select c.relname, pg_get_expr(d.adbin, d.adrelid) as date_default
--   from pg_attrdef d
--   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
--   join pg_class     c on c.oid = d.adrelid
--  where d.adrelid in ('public.visits'::regclass, 'public.daily_plans'::regclass)
--    and a.attname = 'date';
