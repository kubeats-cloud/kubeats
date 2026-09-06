-- =============================================================================
-- KUbeats - migration 0014: field check-in / check-out
--
-- ⚠ NOT YET APPLIED, AND NOT TO BE APPLIED YET.
--
-- The feature this belongs to is built but deliberately unshipped: it waits on
-- hosting/size room. Apply this file at SHIP TIME, immediately BEFORE the code
-- goes live - not before. The app on main today does not read these columns,
-- so applying early is harmless but pointless; applying LATE, after the code
-- ships, would break every check-in.
--
-- WHAT THIS ADDS
--
--   1. Seven columns on public.daily_plans recording when a rep actually
--      arrived and left, and where.
--   2. Two IMMUTABLE helper functions: the visit status, and the duration.
--      Neither is stored - see below.
--   3. One trigger, so a meeting cannot be logged against a planned visit the
--      rep never checked in to. That is the presence guarantee.
--
-- WHY COLUMNS ON daily_plans RATHER THAN A NEW TABLE
--
-- The relationship is 1:1. daily_plans is already unique per
-- (member, date, institute_id), which is exactly "one planned visit", and a
-- rep checks into a planned visit once. A separate table would buy the ability
-- to record several arrivals at one planned visit, which nobody asked for, and
-- would cost a join on the meeting gate - the hottest query in the app.
--
-- WHY STATUS AND DURATION ARE NOT STORED
--
-- Both are pure functions of the three timestamps. Storing either would create
-- a second answer that can drift from the first, which is the mistake 0011
-- avoided by not storing the open/closed category. The functions below are
-- IMMUTABLE, so Postgres can index or inline them if a later query needs it,
-- and src/lib/validation/checkin.ts holds the same two rules for the browser.
-- The plan_visit_status suite in tests/integration/rules.test.ts fails if the
-- two halves ever disagree.
--
-- HOW TO RUN (AT SHIP TIME)
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The columns
--
-- Every coordinate is NULLABLE, and that is the feature rather than laziness.
-- A rep at a school with no signal, or one who refused the permission months
-- ago, must still be able to record that they arrived. The timestamp is what
-- the presence guarantee rests on; the coordinates are corroboration. This is
-- the same judgement Rule 12 already makes for the visit photo, where the
-- photo blocks and the geo-tag deliberately does not.
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  add column if not exists checkin_at        timestamptz,
  add column if not exists checkin_lat       double precision,
  add column if not exists checkin_lng       double precision,
  add column if not exists checkout_at       timestamptz,
  add column if not exists checkout_lat      double precision,
  add column if not exists checkout_lng      double precision,
  -- Set when a visit is closed without a check-out: the rep finished the work
  -- and walked away without tapping the button, which happens. It is the
  -- difference between "still in progress" and "completed, duration unknown",
  -- and without it those two are indistinguishable.
  add column if not exists checkout_missing  boolean not null default false;

comment on column public.daily_plans.checkin_at is
  'When the rep recorded arriving. Null means they have not checked in.';
comment on column public.daily_plans.checkin_lat is
  'Where they were on arrival, when the device could say. Null is normal and '
  'never blocks a check-in.';
comment on column public.daily_plans.checkout_missing is
  'True when the visit was closed without a check-out. Completed, duration '
  'not recorded - which is a different state from still being in progress.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkin_coords_valid') then
    alter table public.daily_plans add constraint daily_plans_checkin_coords_valid check (
      (checkin_lat is null or checkin_lat between -90 and 90)
      and (checkin_lng is null or checkin_lng between -180 and 180)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkout_coords_valid') then
    alter table public.daily_plans add constraint daily_plans_checkout_coords_valid check (
      (checkout_lat is null or checkout_lat between -90 and 90)
      and (checkout_lng is null or checkout_lng between -180 and 180)
    );
  end if;

  -- You cannot leave somewhere you never arrived.
  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkout_needs_checkin') then
    alter table public.daily_plans add constraint daily_plans_checkout_needs_checkin check (
      checkout_at is null or checkin_at is not null
    );
  end if;

  -- ...nor leave before arriving.
  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkout_after_checkin') then
    alter table public.daily_plans add constraint daily_plans_checkout_after_checkin check (
      checkout_at is null or checkin_at is null or checkout_at >= checkin_at
    );
  end if;

  -- "Closed without checking out" only means anything once checked in, and it
  -- contradicts an actual check-out time. Both halves stated, because a row
  -- carrying a checkout_at AND claiming the checkout is missing would make the
  -- derived status a coin toss.
  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkout_missing_valid') then
    alter table public.daily_plans add constraint daily_plans_checkout_missing_valid check (
      checkout_missing = false
      or (checkin_at is not null and checkout_at is null)
    );
  end if;
end $$;

-- The Dashboard asks "what is open for me today", which is now also "what am I
-- checked into". Partial, so it stays small.
create index if not exists daily_plans_checked_in_idx
  on public.daily_plans (member, date)
  where checkin_at is not null and checkout_at is null and checkout_missing = false;


-- -----------------------------------------------------------------------------
-- 2. Status and duration, derived rather than stored
--
-- IMMUTABLE because both are pure functions of their arguments: same inputs,
-- same answer, forever. That is what lets Postgres use them in an index or an
-- expression if a later query needs it, and it is also the honest label.
-- -----------------------------------------------------------------------------
create or replace function public.plan_visit_status(
  p_checkin_at       timestamptz,
  p_checkout_at      timestamptz,
  p_checkout_missing boolean
)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_checkin_at is null then 'Scheduled'
    when p_checkout_at is not null or coalesce(p_checkout_missing, false) then 'Completed'
    else 'In Progress'
  end;
$fn$;

comment on function public.plan_visit_status(timestamptz, timestamptz, boolean) is
  'Scheduled / In Progress / Completed for a planned visit. Mirrored by '
  'visitStatusOf() in src/lib/validation/checkin.ts; the two must agree.';

create or replace function public.plan_visit_minutes(
  p_checkin_at  timestamptz,
  p_checkout_at timestamptz
)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_checkin_at is null or p_checkout_at is null then null
    -- greatest(0, ...) rather than trusting the constraint alone: a duration
    -- must never render as a negative number, whatever a future row holds.
    else greatest(0, (extract(epoch from (p_checkout_at - p_checkin_at)) / 60)::integer)
  end;
$fn$;

comment on function public.plan_visit_minutes(timestamptz, timestamptz) is
  'Minutes on site, or null when either end is missing. Never stored: it is a '
  'function of the two timestamps and a stored copy could drift from them.';

revoke all on function public.plan_visit_status(timestamptz, timestamptz, boolean) from public;
revoke all on function public.plan_visit_minutes(timestamptz, timestamptz) from public;
grant execute on function public.plan_visit_status(timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.plan_visit_minutes(timestamptz, timestamptz) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. An admin may close a visit the rep left open
--
-- daily_plans_update was owner-only. The escape valve for "forgot to check
-- out" needs an admin to be able to close someone else's stuck visit, and an
-- admin could already DELETE the whole row (daily_plans_delete, 0005), so this
-- grants no power they did not have in a blunter form.
--
-- The assignment guard from 0005 still polices assigned_by on every update, so
-- widening this does not let an admin rewrite who asked for a visit.
-- -----------------------------------------------------------------------------
drop policy if exists daily_plans_update on public.daily_plans;
create policy daily_plans_update on public.daily_plans
  for update to authenticated
  using (member = (select auth.uid()) or public.is_admin())
  with check (member = (select auth.uid()) or public.is_admin());


-- -----------------------------------------------------------------------------
-- 4. The presence guarantee
--
-- Rule 2 said a meeting must be on that day's plan. It now also has to be a
-- planned visit the rep actually checked in to, which is the whole point of
-- the feature: "was there" stops being a claim and becomes a record.
--
-- A SEPARATE trigger rather than an edit to enforce_meeting_gate(). That
-- function is untouched and still runs, so if this one is ever dropped the
-- original rule survives intact - and reproducing a working function to add a
-- clause to it is how the copy in the previous migration drifts.
--
-- Sessions, campus visits and the one-shot activities are exempt, exactly as
-- they are exempt from the meeting gate: they do not run off the daily plan.
--
-- FO009 so the app can turn it into a sentence, the same way FO001-FO008 are
-- mapped in src/lib/visit-actions.ts. The message here is never shown.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_checkin_before_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activity <> 'meeting' then
    return new;
  end if;

  if not exists (
    select 1
    from public.daily_plans dp
    where dp.member = new.member
      and dp.date = new.date
      and dp.institute_id = new.institute_id
      and dp.checkin_at is not null
  ) then
    raise exception
      'Check in at this institute before logging the meeting.'
      using errcode = 'FO009';
  end if;

  return new;
end;
$$;

comment on function public.enforce_checkin_before_meeting is
  'The presence guarantee: a meeting may only be logged for a planned visit '
  'the rep checked in to. Runs beside enforce_meeting_gate(), which is '
  'unchanged and still requires the plan row itself.';

drop trigger if exists visits_require_checkin on public.visits;
create trigger visits_require_checkin
  before insert on public.visits
  for each row execute function public.enforce_checkin_before_meeting();


-- -----------------------------------------------------------------------------
-- 5. Reading it back
--
--   select dp.date,
--          i.name,
--          dp.checkin_at,
--          dp.checkout_at,
--          public.plan_visit_status(dp.checkin_at, dp.checkout_at, dp.checkout_missing) as status,
--          public.plan_visit_minutes(dp.checkin_at, dp.checkout_at) as minutes
--     from public.daily_plans dp
--     join public.institutes i on i.id = dp.institute_id
--    where dp.member = '...'
--    order by dp.date desc;
--
-- Visits still open, for chasing a forgotten check-out:
--
--   select * from public.daily_plans
--    where checkin_at is not null
--      and checkout_at is null
--      and checkout_missing = false
--      and date < public.app_today();
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 6. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'daily_plans'
       and column_name = 'checkin_at'
  ) then
    problems := problems || 'daily_plans.checkin_at is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'visits_require_checkin'
       and tgrelid = 'public.visits'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the visits_require_checkin trigger is missing';
  end if;

  -- The original gate must still be there. This feature adds to Rule 2; it
  -- does not replace it.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'visits_enforce_meeting_gate'
       and tgrelid = 'public.visits'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'enforce_meeting_gate from 0001 has gone missing';
  end if;

  -- The status function has to answer all three states correctly, or every
  -- screen reading it is wrong in the same way.
  if public.plan_visit_status(null, null, false) is distinct from 'Scheduled'
     or public.plan_visit_status(now(), null, false) is distinct from 'In Progress'
     or public.plan_visit_status(now(), now(), false) is distinct from 'Completed'
     or public.plan_visit_status(now(), null, true) is distinct from 'Completed' then
    problems := problems || 'plan_visit_status does not agree with its own definition';
  end if;

  if public.plan_visit_minutes(null, now()) is not null
     or public.plan_visit_minutes(now(), null) is not null then
    problems := problems || 'plan_visit_minutes should be null when either end is missing';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Check-in/out is not correctly set up: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Check-in/out: columns, both helper functions and the presence trigger in place.';
end $$;
