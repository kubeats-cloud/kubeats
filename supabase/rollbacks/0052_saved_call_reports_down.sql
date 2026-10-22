-- Restore production 0046 log_call; retain all call columns and saved reports.
begin;
create or replace function public.log_call(
  p_task_id           uuid,
  p_status_set_to     text    default null,
  p_expected_date     date    default null,
  p_follow_up_date    date    default null,
  p_notes             text    default null,
  p_students_attended integer default null,
  p_session_topic     text    default null,
  p_session_taken_by  text    default null,
  p_next_action       text    default null,
  p_follow_up_note    text    default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member          uuid := (select auth.uid());
  v_task            public.follow_up_tasks%rowtype;
  v_category        text;
  v_asks_expected   boolean;
  v_asks_session    boolean;
  v_asks_head_count boolean;
  v_needs_notes     boolean;
begin
  if v_member is null then
    raise exception 'You must be signed in to log this call.'
      using errcode = 'FO004';
  end if;

  -- Only the caller's own open call - never a colleague's, never a meeting
  -- task, and never one already closed. RLS (supervises()) would let a team
  -- lead reach a rep's row too; this is narrower on purpose, matching
  -- logFollowUpCallOutcome()'s existing `.eq("member", user.id)`.
  select * into v_task
    from public.follow_up_tasks
   where id = p_task_id
     and member = v_member
     and kind = 'call'
   for update;

  if not found then
    raise exception 'That call could not be found, or it is not yours to log.'
      using errcode = 'FO038';
  end if;

  if v_task.done_at is not null then
    raise exception 'That call has already been logged.'
      using errcode = 'FO039';
  end if;

  -- Rule 4, same as log_visit(): a status is compulsory.
  if p_status_set_to is null then
    raise exception 'Say where this call leaves the institute before saving it.'
      using errcode = 'FO024';
  end if;

  select s.category, s.asks_expected_date, s.asks_session_detail, s.asks_head_count
    into v_category, v_asks_expected, v_asks_session, v_asks_head_count
    from public.institute_statuses s
   where s.status = p_status_set_to;

  -- Rule 3's date, asked of the status exactly as eventDateRequired() asks it.
  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  -- Rule 5, mirroring enforce_follow_up_when_open() (FO016) plus visitSchema's
  -- extension of it to a chosen next action - asked by hand, because that
  -- trigger lives on visits and a call is never one.
  if (public.institute_status_is_open(p_status_set_to) or p_next_action is not null)
     and p_follow_up_date is null then
    raise exception '%',
      case when p_next_action is not null
             then 'Say when this follow-up is due.'
           else 'That status leaves the institute open, so a follow-up date is needed.'
      end
      using errcode = 'FO016';
  end if;

  -- The closing report's own rules, asked exactly as makeReportSchema() asks
  -- them. An unrecognised status (v_category null) excuses notes, matching
  -- notesRequired()'s "no row means not required" - the FK above is what
  -- actually refuses the status itself, moments from now.
  v_needs_notes := v_category is not null and (
    v_category <> 'closed'
    or coalesce(v_asks_expected, false)
    or coalesce(v_asks_session, false)
    or coalesce(v_asks_head_count, false)
  );

  if v_needs_notes and (p_notes is null or btrim(p_notes) = '') then
    raise exception 'Add a note before saving this call.' using errcode = 'FO041';
  end if;

  if coalesce(v_asks_head_count, false) and p_students_attended is null then
    raise exception 'Enter the number of students.' using errcode = 'FO042';
  end if;

  if coalesce(v_asks_session, false)
     and (p_session_topic is null or btrim(p_session_topic) = '') then
    raise exception 'Enter the topic title.' using errcode = 'FO043';
  end if;

  if coalesce(v_asks_session, false)
     and (p_session_taken_by is null or btrim(p_session_taken_by) = '') then
    raise exception 'Enter who took it.' using errcode = 'FO044';
  end if;

  update public.follow_up_tasks
     set status_set_to     = p_status_set_to,
         expected_date     = p_expected_date,
         follow_up_date    = p_follow_up_date,
         students_attended = p_students_attended,
         session_topic     = p_session_topic,
         session_taken_by  = p_session_taken_by,
         call_notes        = p_notes,
         next_action       = p_next_action,
         outcome           = 'done',
         done_at           = now(),
         reported_at       = now()
   where id = p_task_id;

  -- Rule 4 — status is set by hand, same as log_visit(); institutes_touch_status
  -- stamps who changed it and when.
  if p_status_set_to is not null then
    update public.institutes
       set status = p_status_set_to
     where id = v_task.institute_id;

    if not found then
      raise exception 'That institute no longer exists.' using errcode = 'FO006';
    end if;
  end if;

  -- A3 — the next task, in the same transaction as the close, same reasoning
  -- close_visit() gives for its own follow-up insert. NEVER daily_plans, and
  -- from_visit_id is always null: a call has no visit behind it to point at.
  -- SECURITY INVOKER means FO031 applies to this insert exactly as it does to
  -- close_visit()'s.
  if p_next_action is not null then
    insert into public.follow_up_tasks (
      member, institute_id, kind, due_date, note, from_visit_id
    ) values (
      v_member, v_task.institute_id, p_next_action, p_follow_up_date, p_follow_up_note, null
    );
  end if;
end;
$$;
commit;
