-- =============================================================================
-- KUbeats — migration 0006: the proof photo becomes mandatory
--
-- Every visit now requires a photograph. A visit without one is not evidence
-- that anybody went anywhere, so this closes the last way to record one.
--
-- Three layers, the same shape as every other load-bearing rule here:
--
--   1. the shared zod schema           src/lib/validation/visit.ts
--   2. log_visit(), raising FO007      below - the friendly path
--   3. a CHECK constraint              below - the authority
--
-- Layer 3 is what makes this real: it refuses a direct INSERT that never went
-- near the form, which is exactly how the meeting gate and the weekly lock are
-- tested.
--
-- The location beside it is deliberately NOT required, and nothing here changes
-- that. A denied GPS permission still saves.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run: the function is replaced and the constraint is added
--   only if it is not already there.
--
-- NOTE FOR A RESTORE
--   The constraint is added NOT VALID, so applying this to a project that
--   already holds photo-less visits will not fail, and those rows are left
--   alone. It still rejects every new INSERT and UPDATE. If you are restoring a
--   backup taken before this migration, load the data first and apply this
--   afterwards - or drop the constraint for the duration:
--     alter table public.visits drop constraint visits_photo_required;
--     ... restore ...
--     (re-run this file)
--
-- ERROR CODES
--   FO007  no photo was supplied   (Rule 12)
--   FO001-FO006 are unchanged; see 0002_log_visit_rpc.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. log_visit(), with the photo guard. Identical to 0002 in every other
--    respect - it is reproduced in full because a function cannot be patched.
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

-- -----------------------------------------------------------------------------
-- 2. The constraint behind it.
--
-- An empty string is not a photo either, so both cases are named. NOT VALID
-- skips the scan of existing rows; new and updated rows are still checked.
-- -----------------------------------------------------------------------------

do $do$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'visits_photo_required'
       and conrelid = 'public.visits'::regclass
  ) then
    alter table public.visits
      add constraint visits_photo_required
      check (photo_url is not null and btrim(photo_url) <> '')
      not valid;
  end if;
end
$do$;

-- -----------------------------------------------------------------------------
-- Check it took:
--
--   select conname, convalidated
--     from pg_constraint
--    where conrelid = 'public.visits'::regclass
--      and conname = 'visits_photo_required';
--
--   -- and, as any signed-in rep, this must fail with FO007:
--   select public.log_visit(
--     p_institute_id := (select id from public.institutes limit 1),
--     p_activity     := 'olympiad'
--   );
-- -----------------------------------------------------------------------------
