-- Behavioral DOWN: keep cancellation labels, status flags and all historical rows.
-- Prior code must be restored with this rollback. The Not Interested status is retired.
begin;
drop trigger if exists institutes_cancel_follow_ups on public.institutes;
drop trigger if exists follow_up_tasks_closed_institute on public.follow_up_tasks;
drop trigger if exists visits_closed_has_no_next_action on public.visits;
update public.institute_statuses set is_active=false where status='Not Interested';
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
commit;
