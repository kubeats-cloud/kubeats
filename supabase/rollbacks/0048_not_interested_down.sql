-- =============================================================================
-- KUbeats - DOWN migration 0048
--
-- Reverses supabase/migrations/0046_not_interested.sql.
-- NOT applied by walking migrations/ — this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   the three triggers and their functions
--   close_visit(), restored to the 0039 body
--   the 'cancelled' outcome (existing cancelled rows keep done_at and lose
--   the outcome label, so they stay off Pending rather than reappearing)
--   the Not Interested status, when nothing references it
--   institute_statuses.cancels_follow_ups
--
-- WHAT IT REFUSES TO UNDO
--
--   institutes, visits, past plans and finished tasks are not deleted.
--   Upcoming plan rows this migration already removed are not recreated:
--   putting them back would invent work nobody is owed.
--   If any institute, visit or history row uses 'Not Interested', the status
--   is retired (is_active = false) rather than deleted. The foreign keys are
--   ON DELETE RESTRICT, and deleting the vocabulary out from under history
--   is the one thing a down migration must not do.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0048 afterwards restores the
--   feature.
-- =============================================================================


drop trigger if exists institutes_cancel_follow_ups on public.institutes;
drop trigger if exists follow_up_tasks_closed_institute on public.follow_up_tasks;
drop trigger if exists visits_closed_has_no_next_action on public.visits;

drop function if exists public.cancel_upcoming_follow_ups();
drop function if exists public.enforce_no_follow_up_when_closed();
drop function if exists public.enforce_closed_visit_has_no_next_action();


-- Keep cancelled tasks closed. The label goes, because the old check does
-- not know the word; done_at stays, so they do not return to Pending.
update public.follow_up_tasks
   set outcome = null
 where outcome = 'cancelled';

alter table public.follow_up_tasks
  drop constraint if exists follow_up_tasks_outcome_valid;

alter table public.follow_up_tasks
  add constraint follow_up_tasks_outcome_valid check (
    outcome is null or outcome in ('done', 'no_answer', 'rescheduled')
  );


-- The status, only when nothing points at it. Otherwise retire it.
do $$
begin
  if to_regclass('public.institute_statuses') is null then
    return;
  end if;

  if not exists (
    select 1 from public.institutes where status = 'Not Interested'
    union all
    select 1 from public.visits where status_set_to = 'Not Interested'
    union all
    select 1 from public.institute_status_history where status = 'Not Interested'
  ) then
    delete from public.institute_statuses where status = 'Not Interested';
    raise notice '0048 down: removed the unused Not Interested status.';
  else
    update public.institute_statuses
       set is_active = false
     where status = 'Not Interested';
    raise notice
      '0048 down: Not Interested is in use, so it was retired rather than deleted. History was kept.';
  end if;
end $$;

alter table public.institute_statuses
  drop column if exists cancels_follow_ups;


-- close_visit() back to the 0039 body. Same signature, still SECURITY INVOKER.
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
         next_action          = p_next_action,
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
  if p_follow_up_kind is not null then
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
  'the rep will do next, creates the follow-up task for it, and stamps the '
  'check-out - all in ONE transaction. The follow-up goes to follow_up_tasks '
  'and NEVER to daily_plans (see 0038). SECURITY INVOKER, so RLS, FO031 and '
  'every trigger still apply. Every parameter past p_daily_plan_id is '
  'defaulted, so an older caller still resolves.';


do $$
declare
  problems text[] := '{}';
  def      text;
  body     text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'institute_statuses'
       and column_name = 'cancels_follow_ups'
  ) then
    problems := array_append(problems, 'cancels_follow_ups is still there');
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in (
       'cancel_upcoming_follow_ups',
       'enforce_no_follow_up_when_closed',
       'enforce_closed_visit_has_no_next_action'
     )
  ) then
    problems := array_append(problems, 'a 0048 function is still installed');
  end if;

  if exists (
    select 1 from pg_trigger
     where tgname in (
       'institutes_cancel_follow_ups',
       'follow_up_tasks_closed_institute',
       'visits_closed_has_no_next_action'
     )
       and not tgisinternal
  ) then
    problems := array_append(problems, 'a 0048 trigger is still attached');
  end if;

  select pg_get_constraintdef(oid) into def
    from pg_constraint
   where conname = 'follow_up_tasks_outcome_valid';

  if def is null or position('cancelled' in def) > 0 then
    problems := array_append(
      problems,
      'follow_up_tasks_outcome_valid still accepts cancelled, or is missing');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'close_visit';

  if body is null or position('a closed status creates no follow-up' in body) > 0 then
    problems := array_append(
      problems,
      'close_visit() still carries the 0048 closed-status guard');
  end if;

  if (
    select p.prosecdef
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'close_visit'
  ) then
    problems := array_append(problems, 'close_visit() was restored as SECURITY DEFINER');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0048 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0048 down applied: Not Interested no longer cancels follow-ups. Existing rows were kept.';
end $$;
