-- =============================================================================
-- KUbeats - migration 0048: Not Interested, and no follow-up on a closed status
--
-- ADDITIVE for existing rows. SAFE TO APPLY BEFORE THE CODE SHIPS.
-- The new status is simply not offered until the app that knows its name
-- is deployed. The triggers only fire when a status is set or a task is
-- inserted, so a rep using the current build is unaffected.
--
-- WHAT THIS ADDS
--
--   1. 'Not Interested' as a built-in institute status, category closed,
--      tone neutral (the same tone as 'Will not come': a finished refusal,
--      not an overdue and not a success). It asks for no date, no session
--      detail and no head count.
--
--   2. institute_statuses.cancels_follow_ups. True only for that status.
--      The trigger keys off the flag, not the display name, so renaming an
--      unused status does not drop the behaviour. ON UPDATE RESTRICT still
--      refuses a rename once any institute or visit uses it.
--
--   3. Setting an institute to a cancelling status cancels its open
--      follow-up tasks (they leave Pending and the Daily Plan) and deletes
--      upcoming plan rows that have not started. The institute, every visit,
--      every past plan and every already-finished task stay.
--
--   4. A closed status creates no follow-up task (FO038 on a direct insert;
--      close_visit skips the insert so the report still files). A closed
--      visit stores no next_action. Not Interested also stores no
--      follow-up date on the visit that set it.
--
-- HISTORICAL DATA — PROPOSAL, APPLIED ON THIS DATABASE
--
-- 'Not interested' already exists as a retired closing-report value
-- (visits.visit_outcome, visits.management_response). Those columns describe
-- one visit. institutes.status is where the institute stands now. Copying
-- one onto the other would invent a current status from a dormant answer,
-- and — once the trigger below exists — would cancel live follow-ups as a
-- side effect of a backfill.
--
-- The proposal is: leave those values as history. This file does not UPDATE
-- institutes or visits from them. The notice below prints how many such
-- rows this database has, so the person applying it sees the count.
-- Confirm this proposal before any production apply. Dev, read on
-- 2026-10-20, had zero rows in either column.
--
-- RLS
--
-- No policy is widened. daily_plans_delete stays "the rep's own row, or an
-- admin" (0042). The cleanup runs as SECURITY DEFINER so a status change
-- can clear upcoming work without handing a rep a broader delete. The
-- follow-up refusal reads the institute's status through a definer function
-- for the same reason FO031 does: the question is about the row, not about
-- which rows the caller can already see.
--
-- DOWN
--
-- supabase/rollbacks/0046_not_interested_down.sql reverses this file. It is
-- not in migrations/ so applying the folder does not run it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Say how much retired-field history this database has, and do not touch it
-- -----------------------------------------------------------------------------
do $$
declare
  n_outcome  integer;
  n_response integer;
  n_flag     integer;
begin
  select count(*) into n_outcome
    from public.visits
   where visit_outcome = 'Not interested';

  select count(*) into n_response
    from public.visits
   where management_response @> array['Not interested']::text[];

  select count(*) into n_flag
    from public.visits
   where institute_interested = false;

  raise notice
    '0048 historical Not interested left as history: visit_outcome=%, management_response=%, institute_interested=false=%',
    n_outcome, n_response, n_flag;
end $$;


-- -----------------------------------------------------------------------------
-- 1. The flag, and the status
-- -----------------------------------------------------------------------------
alter table public.institute_statuses
  add column if not exists cancels_follow_ups boolean not null default false;

comment on column public.institute_statuses.cancels_follow_ups is
  'When this status is set on an institute, open follow-up tasks are '
  'cancelled and upcoming unstarted plan rows are removed. True only for '
  'Not Interested. Keyed off the row so a rename does not drop the rule.';

insert into public.institute_statuses (
  status, category, tone, sort_order, is_active,
  asks_expected_date, asks_session_detail, asks_head_count,
  cancels_follow_ups
) values (
  'Not Interested', 'closed', 'neutral', 10, true,
  false, false, false,
  true
)
on conflict (status) do update
  set category = 'closed',
      cancels_follow_ups = true;

comment on table public.institute_statuses is
  'Rule 4''s statuses and their open/closed category. Not Interested (0048) '
  'is the built-in closed status that cancels upcoming follow-ups.';


-- -----------------------------------------------------------------------------
-- 2. 'cancelled' is a way a follow-up task can end
--
-- The row stays. done_at is what takes it off Pending and the Daily Plan;
-- the outcome says why, so a later reader can tell a finished call from one
-- that was dropped because the institute was not interested.
-- -----------------------------------------------------------------------------
alter table public.follow_up_tasks
  drop constraint if exists follow_up_tasks_outcome_valid;

alter table public.follow_up_tasks
  add constraint follow_up_tasks_outcome_valid check (
    outcome is null or outcome in ('done', 'no_answer', 'rescheduled', 'cancelled')
  );


-- -----------------------------------------------------------------------------
-- 3. Cancel upcoming follow-ups when the status says so
-- -----------------------------------------------------------------------------
create or replace function public.cancel_upcoming_follow_ups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cancels boolean;
begin
  select s.cancels_follow_ups into v_cancels
    from public.institute_statuses s
   where s.status = new.status;

  if v_cancels is not true then
    return new;
  end if;

  -- Open tasks leave Pending and the Daily Plan. The row stays, marked
  -- cancelled, so the fact that a follow-up had been owed is still a record.
  -- Already-finished tasks are not rewritten.
  update public.follow_up_tasks
     set done_at = now(),
         outcome = 'cancelled'
   where institute_id = new.id
     and done_at is null;

  -- Upcoming plan rows that have not started, so they leave the Daily Plan.
  -- A checked-in row is the visit in progress and stays (FO014 would refuse
  -- a rep deleting it anyway). A past row is history, including Rule 7's
  -- meetings_actual, and stays. checkout_missing is an admin's record.
  -- visits.daily_plan_id is ON DELETE SET NULL, so a visit that pointed at
  -- one of these rows keeps the visit and loses only the link.
  delete from public.daily_plans
   where institute_id = new.id
     and date >= public.app_today()
     and checkin_at is null
     and checkout_at is null
     and meetings_actual is null
     and checkout_missing = false;

  -- Today's arrival, which we kept, must not still advertise a chase date.
  -- Past plans keep theirs.
  update public.daily_plans
     set follow_up_date = null
   where institute_id = new.id
     and date >= public.app_today()
     and follow_up_date is not null;

  return new;
end;
$$;

comment on function public.cancel_upcoming_follow_ups is
  'When an institute is set to a status with cancels_follow_ups (Not '
  'Interested), cancel its open follow-up tasks and remove upcoming '
  'unstarted plan rows. Does not delete the institute, visits, past plans '
  'or finished tasks. SECURITY DEFINER so the cleanup does not depend on '
  'widening daily_plans_delete.';

revoke all on function public.cancel_upcoming_follow_ups() from public;
revoke all on function public.cancel_upcoming_follow_ups() from anon;
revoke all on function public.cancel_upcoming_follow_ups() from authenticated;

drop trigger if exists institutes_cancel_follow_ups on public.institutes;
create trigger institutes_cancel_follow_ups
  after update of status on public.institutes
  for each row
  when (old.status is distinct from new.status)
  execute function public.cancel_upcoming_follow_ups();


-- -----------------------------------------------------------------------------
-- 4. A closed status creates no follow-up task
-- -----------------------------------------------------------------------------
create or replace function public.enforce_no_follow_up_when_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_open   boolean;
begin
  select i.status into v_status
    from public.institutes i
   where i.id = new.institute_id;

  -- No status yet is not closed. A follow-up on a fresh institute stays legal.
  if v_status is null then
    return new;
  end if;

  v_open := public.institute_status_is_open(v_status);
  if v_open is false then
    raise exception 'That institute is closed, so it does not take a follow-up.'
      using errcode = 'FO038';
  end if;

  return new;
end;
$$;

comment on function public.enforce_no_follow_up_when_closed is
  'FO038 - a follow-up task cannot be created for an institute whose current '
  'status is closed. Not Interested is the built-in case; every closed status '
  'refuses one. SECURITY DEFINER so the status is read even when the caller '
  'cannot see the institute.';

revoke all on function public.enforce_no_follow_up_when_closed() from public;
revoke all on function public.enforce_no_follow_up_when_closed() from anon;
revoke all on function public.enforce_no_follow_up_when_closed() from authenticated;

drop trigger if exists follow_up_tasks_closed_institute on public.follow_up_tasks;
create trigger follow_up_tasks_closed_institute
  before insert on public.follow_up_tasks
  for each row execute function public.enforce_no_follow_up_when_closed();


-- -----------------------------------------------------------------------------
-- 5. A closed visit stores no next action. Not Interested stores no chase date.
--
-- INSERT and UPDATE. close_visit() writes next_action on the way out, and
-- log_visit() writes follow_up_date on the way in. Both pass through here.
-- Other closed statuses may still carry a follow-up date: 0010 kept that
-- permitted, and only the cancelling status drops it.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_closed_visit_has_no_next_action()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_open    boolean;
  v_cancels boolean;
begin
  if new.status_set_to is null then
    return new;
  end if;

  v_open := public.institute_status_is_open(new.status_set_to);
  if v_open is false then
    new.next_action := null;
  end if;

  select s.cancels_follow_ups into v_cancels
    from public.institute_statuses s
   where s.status = new.status_set_to;

  if v_cancels is true then
    new.follow_up_date := null;
    new.follow_up_time := null;
    new.next_action := null;
  end if;

  return new;
end;
$$;

comment on function public.enforce_closed_visit_has_no_next_action is
  'A closed status stores no next_action. A status with cancels_follow_ups '
  'also stores no follow-up date on the visit that set it. Other closed '
  'statuses may still carry a date.';

revoke all on function public.enforce_closed_visit_has_no_next_action() from public;
revoke all on function public.enforce_closed_visit_has_no_next_action() from anon;
revoke all on function public.enforce_closed_visit_has_no_next_action() from authenticated;

drop trigger if exists visits_closed_has_no_next_action on public.visits;
create trigger visits_closed_has_no_next_action
  before insert or update on public.visits
  for each row execute function public.enforce_closed_visit_has_no_next_action();


-- -----------------------------------------------------------------------------
-- 6. close_visit() does not create a task for a closed status
--
-- The signature is unchanged (21 arguments, all past the second defaulted),
-- so this replaces the body and does not add an overload. SECURITY INVOKER
-- is preserved.
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
  p_students_attended    integer          default null,
  p_students_reached     integer          default null,
  p_session_topic        text             default null,
  p_session_taken_by     text             default null,
  p_closes_visit_id      uuid             default null,
  p_checkout_lat         double precision default null,
  p_checkout_lng         double precision default null,
  p_checkout_accuracy    double precision default null,
  -- 0039. All four defaulted; see the header for why that is load-bearing.
  p_next_action          text             default null,
  p_follow_up_kind       text             default null,
  p_follow_up_due        date             default null,
  p_follow_up_note       text             default null
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
         -- 0039: what the rep said they would do next, recorded on the visit so
         -- the report reads as it was filed. The TASK below is what is acted on.
         -- 0048: a closed status records no next action. Null status
         -- (a visit from before a status was required) keeps what was sent.
         next_action          = case
                                  when public.institute_status_is_open(v_visit.status_set_to) is false
                                    then null
                                  else p_next_action
                                end,
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

  /*
   * THE FOLLOW-UP, IN THE SAME TRANSACTION AS THE REPORT.
   *
   * Written to follow_up_tasks and NEVER to daily_plans - 0038's header says at
   * length why that separation is the whole design. A kind='meeting' row is a
   * PROMPT; turning it into a visit the rep can check into is a separate,
   * explicit tap through startFollowUp(), so there is still exactly one writer
   * in front of the row the meeting gate reads.
   *
   * The due date falls back to TOMORROW rather than to the column's own
   * app_today() default: a follow-up agreed during a visit is, by default,
   * something for the next working day, and `app_today() + 1` reads the Indian
   * calendar day exactly as every other date in this schema does. The form
   * offers the same value, so the two cannot disagree.
   *
   * SECURITY INVOKER means this insert passes through follow_up_tasks' own RLS
   * and through FO031 - so a rep cannot create a task on an institute they do
   * not own even from here, and the refusal rolls the whole report back rather
   * than filing a report with a dead-end task attached.
   */
  -- 0048: a closed status creates no follow-up. Skipping, rather than
  -- letting the insert raise FO038, keeps the report saveable: the visit
  -- is already logged, and a closed loop is finished. A direct insert into
  -- follow_up_tasks is still refused by enforce_no_follow_up_when_closed.
  if p_follow_up_kind is not null
     and public.institute_status_is_open(v_visit.status_set_to) is not false then
    insert into public.follow_up_tasks (
      member, institute_id, kind, due_date, note, from_visit_id
    ) values (
      v_member,
      v_visit.institute_id,
      p_follow_up_kind,
      coalesce(p_follow_up_due, public.app_today() + 1),
      p_follow_up_note,
      p_visit_id
    );
  end if;

  if p_daily_plan_id is not null then
    -- THE CHECK-OUT IS STAMPED ONLY IF THERE IS STILL ONE TO STAMP.
    --
    -- `checkout_missing = false` is the line 0030 added, and everything above
    -- this statement is why: a row the nightly sweep or an admin has already
    -- closed carries checkout_missing = true and checkout_at null, and writing
    -- a time onto it is refused by daily_plans_checkout_missing_valid (0014)
    -- with 23514 - which rolls the report back with it.
    --
    -- Matching no row is the whole fix. The report above is already written;
    -- this simply declines to invent a departure time for a visit nobody
    -- recorded leaving. checkout_missing stays true, checkout_at stays null,
    -- and that pair has meant "completed, duration not recorded" since 0014.
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
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) to authenticated;


comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) is
  'Files a visit''s report, closes any earlier Set it completes, records what '
  'the rep will do next, and stamps the check-out - all in ONE transaction. '
  '0048: a closed status creates no follow-up task and stores no next action. '
  'The follow-up, when there is one, goes to follow_up_tasks and NEVER to '
  'daily_plans (see 0038). SECURITY INVOKER.';


-- -----------------------------------------------------------------------------
-- 7. Prove it landed, and prove the history was not rewritten
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  n        integer;
  body     text;
  def      text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'institute_statuses'
       and column_name = 'cancels_follow_ups'
  ) then
    problems := array_append(problems, 'institute_statuses.cancels_follow_ups is missing');
  end if;

  if not exists (
    select 1 from public.institute_statuses
     where status = 'Not Interested'
       and category = 'closed'
       and cancels_follow_ups
       and is_active
  ) then
    problems := array_append(
      problems,
      'Not Interested is missing, or it is not an active closed status that cancels follow-ups');
  end if;

  select count(*) into n
    from public.institute_statuses
   where status <> 'Not Interested'
     and cancels_follow_ups;

  if n <> 0 then
    problems := array_append(problems, format(
      '%s statuses other than Not Interested cancel follow-ups', n));
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conname = 'follow_up_tasks_outcome_valid';

  if def is null or position('cancelled' in def) = 0 then
    problems := array_append(
      problems,
      'follow_up_tasks_outcome_valid does not accept cancelled');
  end if;

  foreach body in array array[
    'cancel_upcoming_follow_ups',
    'enforce_no_follow_up_when_closed',
    'enforce_closed_visit_has_no_next_action'
  ] loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = body
    ) then
      problems := array_append(problems, format('%s() is missing', body));
    end if;
  end loop;

  if not (
    select p.prosecdef
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'cancel_upcoming_follow_ups'
  ) then
    problems := array_append(
      problems,
      'cancel_upcoming_follow_ups() is not SECURITY DEFINER - a rep could not clear upcoming plans');
  end if;

  if not (
    select p.prosecdef
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'enforce_no_follow_up_when_closed'
  ) then
    problems := array_append(
      problems,
      'enforce_no_follow_up_when_closed() is not SECURITY DEFINER');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_cancel_follow_ups'
       and tgrelid = 'public.institutes'::regclass
       and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_cancel_follow_ups is not attached');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'follow_up_tasks_closed_institute'
       and tgrelid = 'public.follow_up_tasks'::regclass
       and not tgisinternal
  ) then
    problems := array_append(problems, 'follow_up_tasks_closed_institute is not attached');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'visits_closed_has_no_next_action'
       and tgrelid = 'public.visits'::regclass
       and not tgisinternal
  ) then
    problems := array_append(problems, 'visits_closed_has_no_next_action is not attached');
  end if;

  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'close_visit';

  if n <> 1 then
    problems := array_append(problems, format(
      'there are %s close_visit overloads, expected exactly 1', n));
  end if;

  if (
    select p.prosecdef
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'close_visit'
  ) then
    problems := array_append(
      problems,
      'close_visit() is SECURITY DEFINER - campus scoping would not apply inside it');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'close_visit';

  if position('a closed status creates no follow-up' in body) = 0 then
    problems := array_append(
      problems,
      'close_visit() does not skip the follow-up for a closed status');
  end if;

  if position('follow_up_tasks' in body) = 0 then
    problems := array_append(
      problems,
      'close_visit() no longer writes follow_up_tasks at all');
  end if;

  if position('institute_status_is_open' in body) = 0 then
    problems := array_append(
      problems,
      'close_visit() does not ask institute_status_is_open() before creating a follow-up');
  end if;

  -- RLS stayed on, and the delete policies were not replaced by this file.
  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'follow_up_tasks'
  ) then
    problems := array_append(problems, 'row level security is off on follow_up_tasks');
  end if;

  if not (
    select c.relrowsecurity
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relname = 'daily_plans'
  ) then
    problems := array_append(problems, 'row level security is off on daily_plans');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'daily_plans'
       and policyname = 'daily_plans_delete'
  ) then
    problems := array_append(problems, 'daily_plans_delete is missing');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0048 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0048 applied: Not Interested is a closed status that cancels upcoming follow-ups. Retired closing-report values were left as history.';
end $$;
