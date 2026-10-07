-- =============================================================================
-- KUbeats - migration 0040: in-app alerts, and the record of what was missed
--
-- ✅ ADDITIVE, WITH ONE EXCEPTION. SAFE TO APPLY BEFORE THE CODE SHIPS.
--
-- One new table, four policies, one new column on `targets`, one function and
-- five pg_cron jobs. The single statement that is not purely additive is the
-- `targets_non_negative` CHECK, which has to be DROPPED and RE-ADDED because a
-- CHECK cannot be patched in place; section 2 does that under a guard and the
-- assertion block proves the result still covers all nine original columns.
--
-- THE ALERTS ARE A STATE, NOT AN INTERRUPTION, and that is the whole design.
-- Evaluation is exact and server-side - pg_cron fires at a fixed Indian clock
-- time and writes a row. Seeing it happens when the rep next opens the app.
-- There is no email, no push, no WhatsApp and no outbound anything: a channel
-- would be a SENDER over these same rows, which is why the rows come first.
--
-- WHY pg_cron AND NOT CLOUDFLARE CRON TRIGGERS. The OpenNext adapter's
-- generated worker exports a `fetch` handler and offers no supported way to add
-- `scheduled` from app code. It could be patched - scripts/trim-worker.mjs
-- already post-processes that file - but that is platform coupling in exactly
-- the place CLAUDE.md forbids it, and it would not survive the move to a Node
-- host that the portability rule exists to keep open. pg_cron is already here,
-- already carries two production jobs (0004, 0018), and travels with the
-- database. No pg_net is needed: every predicate below is pure SQL, so nothing
-- has to leave Postgres to be evaluated.
--
-- ⚠ THE TIMES ARE A LITERAL +05:30, DELIBERATELY. India has no DST, so a fixed
-- offset is permanently correct here in a way it is not anywhere else. Every
-- expression below is written UTC-first with its IST meaning beside it, and
-- every date the function itself computes goes through public.app_today() -
-- never current_date, which would date a 23:00 IST row to the following day.
-- That is 0008's lockstep rule and it is asserted in section 6.
--
-- ⚠ ONE DECISION WORTH READING BEFORE CHANGING THE POLICIES (section 4).
--
-- The brief asks for the missed record to be visible to "team lead, admin and
-- rep", and there is no team-lead role - the plan resolves it as "an admin,
-- scoped by profiles.created_by". That scoping lives in the SCREEN, not here.
-- RLS stays `member = auth.uid() or public.is_admin()`.
--
-- The reason is 0034's own header: "NO BACKFILL. The ~39 rows that predate this
-- file keep created_by NULL", and "created_by decides nothing. It records
-- something." Make it decide something and every rep created before 0034
-- becomes invisible to EVERY admin - their missed-follow-up record silently
-- absent from the one screen built to show it, with nothing on any page saying
-- a row was withheld. A record that hides its oldest rows is worse than no
-- record. So the boundary is the one every other admin surface in this app
-- uses, and "my team" is a filter an admin chooses on top of it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `alert_events_unique_per_day` IS WHAT MAKES THE JOB IDEMPOTENT, and it is
-- load-bearing rather than tidy. A cron run that fires twice - a retry after a
-- transient failure, an admin re-running the function by hand to test it - must
-- write ONE row, because section 5's record counts rows. Double-counting a
-- miss would make a rep's record wrong in the direction that matters, and
-- nothing on the screen would say so.
--
-- `payload` is jsonb rather than a column per alert kind. "A morning follow-up
-- reminder WITH A COUNT" needs one number; so do the 16:00 and 19:00 alerts;
-- `day_plan_not_set` needs none. Three nullable integer columns that are each
-- meaningful for one `kind` is the shape this avoids. The key is `count`
-- throughout rather than a per-kind name, so one renderer reads them all - a
-- per-kind key would reintroduce exactly the per-kind branching jsonb was
-- chosen to avoid.
--
-- `seen_at` is the ONLY column a rep may write, and section 4 is what enforces
-- that. An alert is a record of what the database observed at a fixed time; a
-- rep acknowledging it must not be able to edit what was observed.
--
-- `for_date` is the Indian calendar day the alert is ABOUT, which is not always
-- the day it is about to the minute: the Sunday `weekly_plan_not_set` row is
-- dated the Sunday it fired, not the Monday it is warning about. The week it
-- means is in the payload, so the unique constraint stays one-row-per-day
-- without the reader having to guess which Monday was intended.
-- -----------------------------------------------------------------------------
create table if not exists public.alert_events (
  id          uuid primary key default gen_random_uuid(),
  member      uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  for_date    date not null default public.app_today(),
  payload     jsonb not null default '{}'::jsonb,
  seen_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint alert_events_kind_valid check (kind in (
    'day_plan_not_set', 'follow_ups_due', 'follow_ups_pending',
    'follow_ups_missed', 'weekly_plan_not_set'
  )),

  constraint alert_events_unique_per_day unique (member, kind, for_date),

  -- A jsonb column accepts a bare number, a string or `null` as valid jsonb.
  -- The app reads `payload.count`, so anything that is not an object would
  -- surface as undefined rather than as an error.
  constraint alert_events_payload_is_object check (jsonb_typeof(payload) = 'object')
);

comment on table public.alert_events is
  'One row per member per alert kind per Indian calendar day, written by '
  'materialise_daily_alerts() from pg_cron. A STATE the app reads, not a '
  'message that was sent - any outbound channel added later is a sender over '
  'these rows. kind=follow_ups_missed doubles as the missed-follow-up record.';

comment on column public.alert_events.for_date is
  'The Asia/Kolkata day this alert is ABOUT. Defaults to app_today(), never '
  'current_date: a row written at 23:00 IST belongs to that day, not the next.';

comment on column public.alert_events.payload is
  'Alert detail as a jsonb object. `count` is the number of follow-ups for the '
  'three follow-up kinds; `week_start` is the Monday for weekly_plan_not_set. '
  'One key name across kinds so a single renderer reads them all.';

comment on column public.alert_events.seen_at is
  'When the member dismissed it. The only column they may write - see the '
  'update policy in section 4.';

-- Every read is "what is unseen for this member, newest first", which is what
-- the Dashboard banner asks on every page load. Partial on `seen_at is null`
-- for the same reason follow_up_tasks_open is partial: dismissed rows are the
-- majority over time and the banner never asks for them.
create index if not exists alert_events_unseen
  on public.alert_events (member, for_date desc)
  where seen_at is null;

-- The missed record asks the other way round: one kind, across members, over a
-- date range. Without this it is a sequential scan that grows with every day
-- the app runs.
create index if not exists alert_events_by_kind
  on public.alert_events (kind, for_date desc);


-- -----------------------------------------------------------------------------
-- 2. targets.calls - the OPTIONAL total-calls target
--
-- ⚠ IT MUST NOT JOIN `METRICS`, AND THIS IS THE ONE PARAGRAPH TO READ BEFORE
-- "TIDYING" IT IN.
--
-- Seven of the eight weekly metrics are counted by (activity, lifecycle_status)
-- and the eighth from daily_plans; ACTIVITY_COLUMNS folds all eight into six
-- export columns; and metricsMissingFromExport() plus the .xlsx byte-identity
-- test assert that the mapping is exhaustive. A ninth METRICS entry would
-- either fail that test or add a column to the client's template - and calls
-- are not visits, so no activity could ever feed it.
--
-- `targets.institutes_covered` IS THE PRECEDENT: a column on this table that is
-- deliberately not in METRICS, kept since 0013 and carrying numbers reps
-- committed, while the app neither asks for it nor writes it. `calls` follows
-- it exactly - a column, this CHECK extension, an optional row on /targets, and
-- NO entry in METRICS, ACTIVITY_COLUMNS, tallyVisitMetrics() or the .xlsx.
--
-- OPTIONAL MEANS NULLABLE, AND THAT IS NOT LAZINESS. Every other target column
-- is `not null default 0` because a rep answers all eight; this one they may
-- decline. `not null default 0` would make "committed to zero calls" and "did
-- not answer" the same stored value, and this is the one column where those are
-- different facts - a 0 is a commitment and would earn a bar reading 0%, while
-- an absence should render nothing at all. `visits.next_action` (0038) is
-- nullable for exactly this reason and says so in the same words.
--
-- A NULL passes `calls >= 0` on its own - a CHECK only rejects FALSE - but the
-- clause below is written `calls is null or calls >= 0` anyway, so the
-- constraint says what it means instead of relying on three-valued logic a
-- later reader has to re-derive. 0001 makes the same argument for the `else
-- false` in visits_lifecycle_matches_activity.
--
-- THE CHECK IS DROPPED AND RE-ADDED, which is the only non-additive statement
-- in this file. A CHECK cannot be patched in place. Both halves are guarded so
-- a re-run is a no-op, and section 6 proves the rebuilt constraint still covers
-- all nine original columns - dropping one by accident while editing this list
-- is the way this change could go wrong, and it would show up as a negative
-- target nobody refused.
-- -----------------------------------------------------------------------------
alter table public.targets
  add column if not exists calls integer;

comment on column public.targets.calls is
  'Optional weekly total-calls commitment, NULL when the rep did not set one. '
  'DELIBERATELY NOT a METRICS entry: calls are not visits and no activity feeds '
  'them, so adding one would break metricsMissingFromExport() or widen the '
  'client''s .xlsx template. Follows institutes_covered, which is on this table '
  'for the same reason. NULL and 0 are different answers here - 0 is a '
  'commitment to make no calls, NULL is no commitment at all.';

do $$
begin
  -- Only rebuild when `calls` is not already covered, so a second run does
  -- nothing rather than briefly dropping a live constraint.
  if not exists (
    select 1 from pg_constraint
     where conname = 'targets_non_negative'
       and pg_get_constraintdef(oid) like '%calls%'
  ) then
    alter table public.targets drop constraint if exists targets_non_negative;

    alter table public.targets add constraint targets_non_negative check (
      meetings >= 0 and sessions_set >= 0 and sessions_done >= 0
      and campus_visits_set >= 0 and campus_visits_done >= 0
      and olympiad >= 0 and application >= 0 and admission >= 0
      and institutes_covered >= 0
      and (calls is null or calls >= 0)
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. materialise_daily_alerts() - the five predicates, as one function
--
-- SECURITY DEFINER with search_path pinned, and SERVICE-ROLE ONLY. It reads
-- every rep's daily_plans, follow_up_tasks and targets, which RLS would narrow
-- to the caller's own; the question being asked is about the MEMBER, not the
-- caller. That is the same reason enforce_task_institute_owned() (0038) is a
-- definer.
--
-- ⚠ NO is_admin() GUARD, AND THAT IS NOT AN OVERSIGHT. CLAUDE.md's rule is for
-- a boundary-crossing RPC a USER can call. This one no user can call: the
-- revokes below leave only service_role, exactly as sweep_open_checkins()
-- (0018) and health_cron_jobs() (0031) are left. An is_admin() guard would in
-- fact BREAK it - cron runs with no auth.uid(), so is_admin() is false and the
-- function would refuse itself every night, silently, for ever.
--
-- ONE FUNCTION TAKING A KIND rather than five functions: the five predicates
-- differ only in their WHERE clause and all five share the insert, the
-- idempotency and the app_today() boundary. Five copies would be five places to
-- get the conflict clause wrong.
--
-- `on conflict do nothing` is the idempotency, paired with
-- alert_events_unique_per_day. It returns the number of rows actually INSERTED,
-- so a second run in the same day honestly reports 0.
--
-- WHO GETS ALERTS: `role = 'rep'`. An admin has no daily plan, no follow-up
-- tasks of their own and no weekly target, so every predicate below would be
-- vacuously true for them and they would collect five alerts a day about work
-- they do not do.
-- -----------------------------------------------------------------------------
create or replace function public.materialise_daily_alerts(p_kind text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date;
  v_monday  date;
  v_written integer := 0;
begin
  if p_kind is null then
    raise exception 'materialise_daily_alerts needs a kind' using errcode = 'FO032';
  end if;

  -- app_today(), never current_date. The 19:00 IST job runs at 13:30 UTC, so
  -- the two agree today - but the 10:00 IST job runs at 04:30 UTC, and a future
  -- schedule change that pushed any job past 18:30 UTC would silently date its
  -- rows to the next Indian day. Reading the Kolkata day makes that impossible
  -- rather than merely unlikely.
  v_today := public.app_today();

  if p_kind = 'day_plan_not_set' then
    /*
     * 10:00 IST. "Nothing beyond the auto plan was added by the rep."
     *
     * `assigned_by is null` IS what "added by the rep" means: 0005 gives that
     * column to an ADMIN assignment, so a null one is a row the rep put there
     * themselves - through the Dashboard, the morning tick-list or
     * startFollowUp(). A rep whose whole day was assigned to them by an admin
     * still has not planned anything, which is what the alert is for.
     */
    insert into public.alert_events (member, kind, for_date, payload)
    select p.id, p_kind, v_today, '{}'::jsonb
      from public.profiles p
     where p.role = 'rep'
       and not exists (
         select 1 from public.daily_plans d
          where d.member = p.id
            and d.date = v_today
            and d.assigned_by is null
       )
    on conflict (member, kind, for_date) do nothing;

  elsif p_kind in ('follow_ups_due', 'follow_ups_pending', 'follow_ups_missed') then
    /*
     * 09:00, 16:00 and 19:00 IST - ONE predicate asked three times.
     *
     * "Still open today": due_date = today and done_at is null. The morning row
     * tells the rep how many they owe; the 16:00 row says some are still open;
     * the 19:00 row records that the day ended with them open, and IS the
     * missed record (section 5). Each is a separate `kind`, so the record
     * counts only what the 19:00 run found - not the morning reminder, which
     * would otherwise make every working day a missed day.
     *
     * An OVERDUE task - due before today and still open - is deliberately not
     * counted here. It was already recorded as missed on its own due date, and
     * counting it again every day afterwards would turn one miss into a growing
     * tally against a rep who has one outstanding call.
     */
    insert into public.alert_events (member, kind, for_date, payload)
    select t.member, p_kind, v_today, jsonb_build_object('count', count(*))
      from public.follow_up_tasks t
      join public.profiles p on p.id = t.member and p.role = 'rep'
     where t.due_date = v_today
       and t.done_at is null
     group by t.member
    on conflict (member, kind, for_date) do nothing;

  elsif p_kind = 'weekly_plan_not_set' then
    /*
     * Sunday 19:00 IST: next week's commitment is not set, or is set and not
     * submitted. A draft is not a commitment - Rule 6's lock only applies once
     * submitted - so a rep with a half-filled draft still needs the nudge.
     *
     * date_trunc('week') is ISO, so it returns the MONDAY of the week the given
     * day falls in. On a Sunday that Monday is six days back, and +7 is
     * tomorrow. Written this way rather than `v_today + 1` so the predicate is
     * still right if the job is ever run by hand on another day.
     */
    v_monday := (date_trunc('week', v_today::timestamp)::date) + 7;

    insert into public.alert_events (member, kind, for_date, payload)
    select p.id, p_kind, v_today, jsonb_build_object('week_start', v_monday)
      from public.profiles p
     where p.role = 'rep'
       and not exists (
         select 1 from public.targets t
          where t.member = p.id
            and t.period = 'weekly'
            and t.period_start = v_monday
            and t.submitted_at is not null
       )
    on conflict (member, kind, for_date) do nothing;

  else
    -- Named rather than ignored: a typo in a cron command would otherwise be a
    -- job that runs nightly and does nothing, which looks exactly like a
    -- predicate that is never true.
    raise exception 'materialise_daily_alerts: unknown kind %', p_kind
      using errcode = 'FO032';
  end if;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function public.materialise_daily_alerts is
  'Writes one day''s alert_events rows for one kind, from pg_cron. Idempotent '
  'via alert_events_unique_per_day, so a retry writes nothing and returns 0. '
  'Service-role only: it reads every rep''s plans, tasks and targets, which RLS '
  'would narrow to the caller. No is_admin() guard BY DESIGN - cron has no '
  'auth.uid(), so one would make it refuse itself every night.';

-- Created with EXECUTE to PUBLIC by default, so these are not tidying.
revoke all on function public.materialise_daily_alerts(text) from public;
revoke all on function public.materialise_daily_alerts(text) from anon;
revoke all on function public.materialise_daily_alerts(text) from authenticated;
grant execute on function public.materialise_daily_alerts(text) to service_role;


-- -----------------------------------------------------------------------------
-- 4. RLS - own rows, or an admin's
--
-- SCOPED ON `member` DIRECTLY, not through a parent. 0037 and 0038 reach
-- through `institutes` because the thing being protected belongs to an
-- institute; an alert belongs to a PERSON and names no institute at all, so the
-- owner column is the whole boundary. Reaching through a parent that does not
-- exist would be ceremony, not safety.
--
-- No campus clause for the same reason: `my_campus()` scopes institutes, and
-- there is no institute here. A rep is identified by auth.uid() and that is
-- exact.
--
-- ⚠ NOBODY MAY INSERT OR DELETE. Not a rep, not an admin. These rows are what
-- the database OBSERVED at a fixed time, and the missed record is built by
-- counting them - so an insert grant is a way to manufacture a miss against
-- somebody, and a delete grant is a way to erase one. Only the service role
-- (which bypasses RLS) writes them, from cron. There are therefore FOUR
-- policies but only two verbs: select, and a deliberately narrow update.
--
-- THE UPDATE EXISTS ONLY TO DISMISS. Postgres has no column-level USING clause,
-- so "only seen_at" cannot be stated in the policy; the grant is narrowed to
-- `update (seen_at)` instead, which is enforced by the privilege system before
-- any policy runs. A rep sending `kind` or `payload` is refused with 42501.
-- -----------------------------------------------------------------------------
alter table public.alert_events enable row level security;

revoke all on public.alert_events from authenticated;
revoke all on public.alert_events from anon;
-- SELECT whole rows; UPDATE one column. Insert and delete are granted to
-- nobody, which is the point above expressed as a privilege.
grant select on public.alert_events to authenticated;
grant update (seen_at) on public.alert_events to authenticated;

drop policy if exists alert_events_select on public.alert_events;
create policy alert_events_select on public.alert_events
  for select to authenticated
  using (member = (select auth.uid()) or public.is_admin());

drop policy if exists alert_events_update on public.alert_events;
create policy alert_events_update on public.alert_events
  for update to authenticated
  using (member = (select auth.uid()) or public.is_admin())
  with check (member = (select auth.uid()) or public.is_admin());

/*
 * The two that exist to REFUSE.
 *
 * With no insert or delete policy at all, RLS already denies both - a missing
 * policy is a denial. These are written out as explicit `with check (false)` /
 * `using (false)` so that the refusal is visible in pg_policies and in this
 * file, rather than being an absence a later reader might "fix" by adding the
 * policy they assume was forgotten. 0038's assertion counts four policies for
 * the same reason: a number is checkable, an absence is not.
 */
drop policy if exists alert_events_no_insert on public.alert_events;
create policy alert_events_no_insert on public.alert_events
  for insert to authenticated
  with check (false);

drop policy if exists alert_events_no_delete on public.alert_events;
create policy alert_events_no_delete on public.alert_events
  for delete to authenticated
  using (false);


-- -----------------------------------------------------------------------------
-- 5. The five schedules
--
-- UTC on the left, IST on the right. India has no DST so these never drift.
--
--   30 3  * * *   09:00 IST  follow_ups_due        morning reminder + count
--   30 4  * * *   10:00 IST  day_plan_not_set      nothing planned yet
--   30 10 * * *   16:00 IST  follow_ups_pending    still open this afternoon
--   30 13 * * *   19:00 IST  follow_ups_missed     the day ended with them open
--   30 13 * * 0   Sun 19:00  weekly_plan_not_set   next week not committed
--
-- The 09:00 time is THE ONE VALUE THE BRIEF DOES NOT SPECIFY (plan §5 item 8).
-- It is the plan's own tentative figure and is a single number to change here
-- and in health_cron_jobs()'s list - no code reads it.
--
-- Two jobs share 13:30 UTC, which pg_cron runs concurrently and is fine: they
-- write different `kind` values, and the unique constraint is per (member,
-- kind, for_date).
--
-- `pure SQL, so no pg_net and no Vault secret` - the same note 0018 makes about
-- sweep-open-checkins, and the reason these jobs need none of 0004's machinery.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
declare
  j text;
begin
  foreach j in array array[
    'alerts-follow-ups-due', 'alerts-day-plan-not-set',
    'alerts-follow-ups-pending', 'alerts-follow-ups-missed',
    'alerts-weekly-plan-not-set'
  ] loop
    begin
      perform cron.unschedule(j);
    exception
      when others then null;  -- not scheduled yet, which is the normal first run
    end;
  end loop;
end $$;

select cron.schedule('alerts-follow-ups-due',      '30 3 * * *',
  $job$ select public.materialise_daily_alerts('follow_ups_due'); $job$);

select cron.schedule('alerts-day-plan-not-set',    '30 4 * * *',
  $job$ select public.materialise_daily_alerts('day_plan_not_set'); $job$);

select cron.schedule('alerts-follow-ups-pending',  '30 10 * * *',
  $job$ select public.materialise_daily_alerts('follow_ups_pending'); $job$);

select cron.schedule('alerts-follow-ups-missed',   '30 13 * * *',
  $job$ select public.materialise_daily_alerts('follow_ups_missed'); $job$);

select cron.schedule('alerts-weekly-plan-not-set', '30 13 * * 0',
  $job$ select public.materialise_daily_alerts('weekly_plan_not_set'); $job$);


-- -----------------------------------------------------------------------------
-- 6. health_cron_jobs() learns the five new names
--
-- ⚠ WITHOUT THIS THE MONITOR LIES. 0031 returns one row per job FOUND from a
-- hard-coded list of two. Leave that list alone and /api/health goes on
-- reporting a perfectly healthy cron subsystem while the alerts have silently
-- stopped - which is the exact partial failure 0031 was written to catch,
-- reproduced by the migration that added the jobs.
-- -----------------------------------------------------------------------------
create or replace function public.health_cron_jobs()
returns table (jobname text, active boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  -- Named explicitly rather than returning everything: a job somebody else
  -- scheduled is not this app's business, and its command text is not something
  -- to hand out over HTTP.
  return query
    select j.jobname::text, j.active
      from cron.job j
     where j.jobname in (
       'purge-visit-photos', 'sweep-open-checkins',
       'alerts-follow-ups-due', 'alerts-day-plan-not-set',
       'alerts-follow-ups-pending', 'alerts-follow-ups-missed',
       'alerts-weekly-plan-not-set'
     );
end;
$$;

revoke all on function public.health_cron_jobs() from public;
revoke all on function public.health_cron_jobs() from anon;
revoke all on function public.health_cron_jobs() from authenticated;
grant execute on function public.health_cron_jobs() to service_role;

comment on function public.health_cron_jobs is
  'Whether this app''s seven pg_cron jobs are scheduled and active, for the '
  'token-gated half of /api/health. Returns one row per job FOUND, so a short '
  'result means some are not scheduled. service_role only.';


-- -----------------------------------------------------------------------------
-- 7. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  j        text;
  pol      record;
  n        integer;
  body     text;
begin
  -- 7a. The table and its columns.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'alert_events'
  ) then
    problems := array_append(problems, 'public.alert_events is missing');
  else
    foreach c in array array[
      'id', 'member', 'kind', 'for_date', 'payload', 'seen_at', 'created_at'
    ] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'alert_events'
           and column_name = c
      ) then
        problems := array_append(problems, format('alert_events.%s is missing', c));
      end if;
    end loop;

    -- 7b. RLS is ON. Policies with RLS disabled are inert, and that mistake
    --     looks exactly like success.
    if not (select cl.relrowsecurity
              from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
             where ns.nspname = 'public' and cl.relname = 'alert_events') then
      problems := array_append(
        problems,
        'row level security is NOT enabled on alert_events - every policy is inert');
    end if;

    -- 7c. THE LOCKSTEP RULE, same check 0038 makes on follow_up_tasks.due_date.
    select column_default into body
      from information_schema.columns
     where table_schema = 'public' and table_name = 'alert_events'
       and column_name = 'for_date';

    if body is null or position('app_today' in body) = 0 then
      problems := array_append(problems, format(
        'alert_events.for_date does not default to app_today() (found: %s) - the Kolkata day would drift',
        coalesce(body, 'no default')));
    end if;

    -- 7d. The idempotency guarantee. Without this UNIQUE constraint the cron
    --     `on conflict` clause is a syntax error at runtime, and a retry would
    --     double-count a miss.
    if not exists (
      select 1 from pg_constraint
       where conname = 'alert_events_unique_per_day'
         and conrelid = 'public.alert_events'::regclass
         and contype = 'u'
    ) then
      problems := array_append(
        problems,
        'alert_events_unique_per_day is missing or not UNIQUE - the cron job is no longer idempotent');
    end if;
  end if;

  -- 7e. targets.calls, and the REBUILT CHECK.
  --     The column is the easy half. The constraint is the one that could have
  --     gone wrong: it was dropped and re-added, so every original column is
  --     named here and a dropped one is reported by name.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'targets' and column_name = 'calls'
  ) then
    problems := array_append(problems, 'targets.calls is missing');
  elsif (select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'targets'
            and column_name = 'calls') <> 'YES' then
    -- Nullable is the DECISION, not an accident - see section 2. NOT NULL here
    -- would collapse "committed to zero calls" into "did not answer", and the
    -- Targets screen would show a 0% bar for a rep who declined the field.
    problems := array_append(
      problems,
      'targets.calls is NOT NULL - an unset optional target would be stored as a commitment to zero');
  end if;

  select pg_get_constraintdef(oid) into body
    from pg_constraint where conname = 'targets_non_negative';

  if body is null then
    problems := array_append(
      problems,
      'targets_non_negative is GONE - it was dropped and not re-added, so a negative target would now be accepted');
  else
    foreach c in array array[
      'meetings', 'sessions_set', 'sessions_done', 'campus_visits_set',
      'campus_visits_done', 'olympiad', 'application', 'admission',
      'institutes_covered', 'calls'
    ] loop
      if position(c in body) = 0 then
        problems := array_append(problems, format(
          'targets_non_negative no longer covers %s - it was lost in the rebuild', c));
      end if;
    end loop;
  end if;

  -- 7f. The function: exactly one overload, definer, search_path pinned, and
  --     not callable by anyone but the service role.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'materialise_daily_alerts';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 materialise_daily_alerts, found %s - every call from cron would be ambiguous', n));
  else
    if not (select p.prosecdef
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'materialise_daily_alerts') then
      problems := array_append(
        problems,
        'materialise_daily_alerts() is not SECURITY DEFINER - it could not read another member''s plans to evaluate them');
    end if;

    /*
     * search_path pinned. LIKE 'search_path=%' against proconfig, NEVER array
     * containment: an empty search_path flattens to `search_path=""`, so
     * `@> array['search_path=']` is false for a function that pins it
     * perfectly. That false alarm rolled 0035 back on dev once.
     */
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'materialise_daily_alerts'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(
        problems,
        'materialise_daily_alerts() does not pin search_path - a definer function without one is a privilege hole');
    end if;
  end if;

  if has_function_privilege('anon', 'public.materialise_daily_alerts(text)', 'execute')
     or has_function_privilege('authenticated', 'public.materialise_daily_alerts(text)', 'execute')
  then
    problems := array_append(
      problems,
      'materialise_daily_alerts() is executable by anon or authenticated - a rep could write alerts against a colleague');
  end if;

  if not has_function_privilege('service_role', 'public.materialise_daily_alerts(text)', 'execute') then
    problems := array_append(
      problems,
      'materialise_daily_alerts() is not executable by service_role, so every cron job would fail nightly');
  end if;

  -- 7g. Four policies, and the two verbs nobody holds.
  n := 0;
  for pol in
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'alert_events'
  loop
    n := n + 1;

    if pol.cmd in ('SELECT', 'UPDATE') then
      if pol.qual is null
         or pol.qual not like '%auth.uid%'
         or pol.qual not like '%is_admin%' then
        problems := array_append(problems, format(
          '%s USING does not scope by member or admin (needs auth.uid and is_admin)',
          pol.policyname));
      end if;
    end if;
  end loop;

  if n <> 4 then
    problems := array_append(problems, format(
      'expected 4 policies on alert_events, found %s', n));
  end if;

  /*
   * THE PRIVILEGE THAT IS THE REAL BOUNDARY. A rep must be able to dismiss an
   * alert and nothing else. If `update` were ever granted on the whole table,
   * the update policy above would happily let a rep rewrite their own `payload`
   * - and the missed record counts those rows.
   */
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'alert_events'
       and grantee = 'authenticated' and privilege_type in ('INSERT', 'DELETE')
  ) then
    problems := array_append(
      problems,
      'authenticated holds INSERT or DELETE on alert_events - a miss could be manufactured or erased');
  end if;

  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'alert_events'
       and grantee = 'authenticated' and privilege_type = 'UPDATE'
       and column_name <> 'seen_at'
  ) then
    problems := array_append(
      problems,
      'authenticated may UPDATE a column other than seen_at - an observed alert could be rewritten');
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'alert_events' and grantee = 'anon'
  ) then
    problems := array_append(problems, 'anon holds a grant on alert_events');
  end if;

  -- 7h. All five jobs scheduled AND active, and the monitor knows all seven.
  foreach j in array array[
    'alerts-follow-ups-due', 'alerts-day-plan-not-set',
    'alerts-follow-ups-pending', 'alerts-follow-ups-missed',
    'alerts-weekly-plan-not-set'
  ] loop
    if not exists (select 1 from cron.job where jobname = j and active) then
      problems := array_append(problems, format(
        'cron job %s is not scheduled or not active', j));
    end if;

    if not exists (
      select 1 from pg_proc p
       where p.proname = 'health_cron_jobs'
         and pg_get_functiondef(p.oid) like '%' || j || '%'
    ) then
      problems := array_append(problems, format(
        'health_cron_jobs() does not know about %s - the monitor would report a healthy cron subsystem with this job stopped', j));
    end if;
  end loop;

  -- The two that were already there must not have been lost in the rewrite.
  foreach j in array array['purge-visit-photos', 'sweep-open-checkins'] loop
    if not exists (
      select 1 from pg_proc p
       where p.proname = 'health_cron_jobs'
         and pg_get_functiondef(p.oid) like '%' || j || '%'
    ) then
      problems := array_append(problems, format(
        'health_cron_jobs() no longer reports %s - 0031''s own jobs were dropped from the list', j));
    end if;
  end loop;

  /*
   * 7i. NOTHING IN PHASE E MAY HAVE TOUCHED THE RULES IT SITS BESIDE.
   *
   * This file reads daily_plans, follow_up_tasks and targets and writes none of
   * them. These are the guarantees a careless edit here would break, asserted
   * in the file that promised not to - the same closing move 0038 makes.
   */
  if not exists (
    select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
     where cl.relname = 'daily_plans_one_open_visit' and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - FO013 no longer holds');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'daily_plans_meeting_gate'
       and tgrelid = 'public.daily_plans'::regclass and not tgisinternal
  ) then
    raise notice '0040 note: daily_plans_meeting_gate not found under that name - check Rule 2 was not lost.';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0040 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0040 applied: alert_events is live with % policies, materialise_daily_alerts() is service-role only, targets.calls is covered by the rebuilt CHECK, and all 5 cron jobs are scheduled and known to health_cron_jobs().', n;
end $$;


-- =============================================================================
-- Afterwards, to see it working
--
--   -- the seven jobs
--   select jobname, schedule, active from cron.job order by jobname;
--
--   -- run one by hand (service role / SQL editor) and see it is idempotent:
--   select public.materialise_daily_alerts('follow_ups_due');   -- writes n
--   select public.materialise_daily_alerts('follow_ups_due');   -- writes 0
--
--   -- today's alerts, newest first
--   select p.name, a.kind, a.for_date, a.payload, a.seen_at
--     from public.alert_events a
--     join public.profiles p on p.id = a.member
--    order by a.for_date desc, p.name;
--
--   -- the missed record: misses per day and days-missed, per rep
--   select p.name,
--          count(*)                                  as days_missed,
--          sum((a.payload->>'count')::int)           as follow_ups_missed
--     from public.alert_events a
--     join public.profiles p on p.id = a.member
--    where a.kind = 'follow_ups_missed'
--    group by p.name
--    order by days_missed desc;
-- =============================================================================
