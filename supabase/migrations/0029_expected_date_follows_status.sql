-- =============================================================================
-- 0029 — log_visit() stores the date the STATUS asked for
--
-- RENUMBERED FROM 0028, and the number that displaced it is worth knowing:
-- 0028 is `0028_rep_owned_institutes.sql`, which was applied to the client's
-- database long before its file reached main. This one was written as 0028
-- while that gap was open, so the two collided the moment it closed.
--
-- Nothing inside here depended on the number. This file is a
-- `create or replace function public.log_visit(...)`, and the ONLY thing that
-- matters about its position is that it runs after 0026, which holds the
-- definition it is based on. Neither 0027 nor 0028 touches log_visit() - the
-- five migrations that have ever defined it are 0002, 0006, 0008, 0015 and
-- 0026 - so the body below is still the current one with a single expression
-- changed, and applying this cannot revert anything.
--
-- WHAT THIS IS FOR
--
-- The Log Visit form now decides every conditional field from the chosen
-- status rather than from the purpose the rep planned under. The date is the
-- one of those that reaches the database, and log_visit() was still gating it
-- on the ACTIVITY:
--
--     case when v_lifecycle then p_expected_date else null end
--
-- `v_lifecycle` is `p_activity in ('session','campus_visit')`. So a rep who
-- planned a "Follow-up" (activity: meeting) and ended the visit on "Session
-- done" was asked for a Session Date by a form reading asks_expected_date, and
-- the value was discarded here without a word. 0026 (D3) removed the other half
-- of this same test for the same stated reason; this removes what was left.
--
-- WHY IT IS SAFE TO APPLY AT ANY TIME
--
-- It only ever WIDENS what may be stored:
--
--   * expected_date is nullable and has no CHECK constraint of any kind.
--   * Nothing requires it in the database - the rule is the app's, and has
--     been since it was written (see tests/unit/validation.test.ts).
--   * Every existing row keeps exactly the value it has. Nothing is rewritten,
--     nothing is re-validated, and no row can become invalid.
--
-- SO IT IS NOT DEPLOY-COUPLED, in either direction. Applied before the code
-- ships, nothing changes: the old form never sends a date the old gate would
-- have dropped. Applied after, the only difference is that a date the rep
-- already typed is kept. This is the opposite of 0027, which had to go out
-- after its deploy or it would refuse live reps mid-visit.
--
-- The body below is 0026's, with that one expression replaced. Everything else
-- - the meeting gate, Rule 4's status write, FO004 to FO007, app_today() - is
-- carried through unchanged so this file remains the whole definition.
-- =============================================================================

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
  -- constraint added at the bottom of 0006 is the authority; this exists
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
  -- `date` is always today: the day the work was logged. Rule 3's shape is
  -- normalised here too — a lifecycle status is kept only for the two
  -- activities that have one — so a stale form field cannot smuggle one
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
    -- 0029: THE DATE FOLLOWS THE STATUS, SO THE ACTIVITY TEST GOES.
    --
    -- 0026 (D3) removed the `= 'Set'` half of this for exactly the reason the
    -- rest is going now: "a form that collects an answer the RPC discards is
    -- worse than one that never asked". What it left behind was
    -- `v_lifecycle` - the date was stored only when the ACTIVITY was a session
    -- or a campus visit.
    --
    -- The form asks on the STATUS now (asks_expected_date, 0026), and a status
    -- is not gated by activity: a rep who planned a Follow-up and ended the
    -- visit on "Session done" is asked for a Session Date, and until this
    -- change that date was silently thrown away here. One rule, one place.
    --
    -- NOTHING ELSE MOVES. There is no CHECK on expected_date, nothing requires
    -- it, and the column has always been nullable, so this only widens what may
    -- be stored. A meeting that carries one is a meeting whose rep answered the
    -- question the status asked. Pending already reads `expected_date ?? date`.
    --
    -- What a "Set" means is still unchanged: the promise lives in expected_date
    -- while `date` records the day it was made, because the weekly rollup counts
    -- by `date`.
    p_expected_date,
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

comment on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) is
  'Saves a visit in one transaction. 0029: expected_date is stored whenever it '
  'is supplied, because the Log Visit form now asks for it on the status '
  '(institute_statuses.asks_expected_date) rather than on the activity.';
