-- =============================================================================
-- Field Ops — log_visit(): one visit, one transaction
--
-- Phase 5 follow-up. Saving a visit is three writes:
--
--   1. insert the visit
--   2. mark today's plan entry as held        (meetings only)
--   3. set the institute's status             (when the rep chose one)
--
-- The app did these as three separate PostgREST calls, so a failure in the
-- middle left the database half-updated: a visit with no held plan entry, or a
-- held plan entry with a stale institute status. This function does all three
-- in a single transaction. Any exception — including one raised by the meeting
-- gate trigger, which fires inside this transaction — rolls back every part.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run: it only replaces the function.
--
-- SECURITY
--   SECURITY INVOKER, deliberately. The function runs as the signed-in rep, so
--   every Row Level Security policy and every trigger still applies exactly as
--   it did when the app wrote these rows directly. It grants nothing new; it
--   only makes the writes atomic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Error codes
--
-- Raised with SQLSTATEs in a user-defined class so the app can map each one to
-- its own sentence without ever parsing an error message. The rules themselves
-- live in the triggers and CHECK constraints from 0001 — these are the friendly
-- path, raised first so the rep gets a sentence instead of a constraint name.
--
--   FO001  the institute is not on today's plan   (Rule 2, the meeting gate)
--   FO002  that plan entry is already held
--   FO003  the photo path is not the caller's own
--   FO004  no signed-in user
--   FO005  the plan entry vanished between check and update
--   FO006  the institute vanished between check and update
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
  v_today     date := current_date;
  v_lifecycle boolean := p_activity in ('session', 'campus_visit');
  v_plan      public.daily_plans%rowtype;
  v_visit_id  uuid;
begin
  if v_member is null then
    raise exception 'You must be signed in to log a visit.'
      using errcode = 'FO004';
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

-- Named with its full argument list. Migration 0015 adds a THIRTEEN-argument
-- log_visit, and while both exist a bare `comment on function public.log_visit`
-- has two candidates and fails with 42725, "function name is not unique" -
-- which is exactly what happened when the whole chain was re-run.
comment on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid
) is
  'Records one visit and its two side effects (plan held, institute status) in a '
  'single transaction. Runs as the calling rep, so RLS and every trigger still '
  'apply. Raises FO001-FO006 for the cases the app turns into sentences.';

-- Only signed-in members may call it.
--
-- Both revokes are needed: EXECUTE is granted to PUBLIC on any new function,
-- and Supabase additionally grants it to `anon` by default privilege. A call
-- with no session would fail at FO004 anyway, but it should not be reachable.
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
