-- =============================================================================
-- KUbeats - migration 0073: every CALL-side read asks the call vocabulary
--
-- PART 3, HALF ONE. THE FOREIGN KEY STILL POINTS AT institute_statuses -
-- follow_up_tasks_status_set_to_fk is untouched here and is retargeted by 0074
-- alone. That is why this file is safe to run on its own: call_statuses (0070)
-- is a column-for-column copy of institute_statuses, so every lookup below
-- resolves to exactly the same row, with exactly the same flags, as the lookup
-- it replaces.
--
-- WHAT MOVES, AND WHAT DOES NOT:
--
--   * log_call() reads its flags from call_statuses and writes the institute's
--     CALL track (institutes.call_status, 0072) instead of the visit track.
--   * admin_update_call_report() does the same.
--   * call_activity_report() counts by call_statuses.
--   * The call recovery in materialise_due_followups() gates on the call track.
--   * enforce_no_follow_up_when_closed() asks the track of the task being
--     inserted: a call task asks the call track, a meeting task the visit track.
--   * cancel_upcoming_follow_ups() becomes a thin visit-track trigger over a
--     shared body; a new call-track trigger calls the same body.
--   * audit_open_follow_ups becomes two-track: one row per institute, the
--     governing status (either track open), status_source/is_open/visit_status/
--     call_status added, and the attribution event taken from the governing
--     track only.
--
--   UNTOUCHED, DELIBERATELY: log_visit(), close_visit(), startFollowUp() and
--   every meeting-side read; institute_statuses and its 0011 history;
--   status_fields; the visit-track select policies; institutes_cancel_follow_ups'
--   name and its `update of status` trigger; institutes_record_status_change.
--   The visit half of Pending and the visit timeline keep behaving exactly as
--   they do today.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: every function is create-or-replace.
--
-- DOWN
--   supabase/rollbacks/0073_call_read_paths_down.sql restores the pre-0073
--   bodies from 0052, 0057, 0063, 0064 and 0048.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. log_call() - the same rules, asked of the call vocabulary
--
-- Body is 0052's, with three edits and nothing else:
--   (a) flags come from public.call_statuses;
--   (b) FO016 asks public.call_status_is_open();
--   (c) the institute update writes call_status, and leaves a transaction-local
--       note so 0072's history trigger can attribute the row to this call and
--       date it when the call was filed.
-- -----------------------------------------------------------------------------
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
  if not public.is_rep() then
    raise exception 'Only a Rep can log a call.' using errcode='42501';
  end if;

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
    from public.call_statuses s
   where s.status = p_status_set_to;

  if v_category = 'closed' and p_next_action is not null then
    raise exception 'A closed status does not take a next action.' using errcode='22023';
  end if;

  -- Rule 3's date, asked of the status exactly as eventDateRequired() asks it.
  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  -- Rule 5, mirroring enforce_follow_up_when_open() (FO016) plus visitSchema's
  -- extension of it to a chosen next action - asked by hand, because that
  -- trigger lives on visits and a call is never one.
  if (public.call_status_is_open(p_status_set_to) or p_next_action is not null)
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

  -- Rule 4 - status is set by hand, now on the CALL track. The note is what
  -- lets institutes_record_call_status_change (0072) attribute the history row
  -- to this call and touch_institute_status stamp it with this rep's identity.
  if p_status_set_to is not null then
    perform set_config(
      'app.call_status_note',
      jsonb_build_object(
        'institute', v_task.institute_id,
        'status',    p_status_set_to,
        'call',      p_task_id,
        'at',        now(),
        'by',        v_member
      )::text,
      true
    );

    update public.institutes
       set call_status = p_status_set_to
     where id = v_task.institute_id;

    if not found then
      raise exception 'That institute no longer exists.' using errcode = 'FO006';
    end if;

    perform set_config('app.call_status_note', '', true);
  end if;

  -- A3 - the next task, in the same transaction as the close, same reasoning
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

comment on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) is
  'Closes a follow-up call like a visit: the same status-driven expected date / '
  'follow-up date / closing-report fields and the same Next Action - but the '
  'status comes from call_statuses and moves institutes.call_status (0073), '
  'not the visit track. No photo, no check-in, never a visits or daily_plans '
  'row. SECURITY INVOKER. Raises FO004, FO006, FO016, FO024, FO038-FO044.';

revoke all on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) from public;
revoke all on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) from anon;
grant execute on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. admin_update_call_report() - the same correction, on the call track
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_call_report(
  p_task_id        uuid,
  p_status_set_to  text default null,
  p_follow_up_date date default null,
  p_expected_date  date default null,
  p_outcome        text default null,
  p_notes          text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caller          uuid := (select auth.uid());
  v_task            public.follow_up_tasks%rowtype;
  v_asks_expected   boolean;
  v_is_open         boolean;
  v_has_later_event boolean;
begin
  -- ⚠ STRICTER THAN RLS, DELIBERATELY. follow_up_tasks_update already lets a
  -- team lead reach their own rep's row (0042's supervises() rewrite) - this
  -- function is a SEPARATE, narrower door that the client asked be admin-only.
  if not public.is_admin() then
    raise exception 'Only an admin can edit a Call Report.' using errcode = 'FO045';
  end if;

  if p_task_id is null then
    raise exception 'No call report was named.' using errcode = 'FO046';
  end if;

  -- Only an already-filed call - never an open task, never a meeting.
  select * into v_task
    from public.follow_up_tasks
   where id = p_task_id
     and kind = 'call'
     and reported_at is not null
   for update;

  if not found then
    raise exception 'That Call Report could not be found.' using errcode = 'FO046';
  end if;

  -- Rule 4, same as log_call(): a status is compulsory.
  if p_status_set_to is null then
    raise exception 'Choose a status before saving.' using errcode = 'FO024';
  end if;

  select s.asks_expected_date into v_asks_expected
    from public.call_statuses s
   where s.status = p_status_set_to;
  v_is_open := public.call_status_is_open(p_status_set_to);

  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  if v_is_open and p_follow_up_date is null then
    raise exception 'That status leaves the institute open, so a follow-up date is needed.'
      using errcode = 'FO016';
  end if;

  -- The audit row, BEFORE the mutation.
  insert into public.call_report_edits (
    call_id, edited_by,
    old_status_set_to,  new_status_set_to,
    old_follow_up_date,  new_follow_up_date,
    old_expected_date,  new_expected_date,
    old_outcome,         new_outcome,
    old_call_notes,      new_call_notes
  ) values (
    p_task_id, v_caller,
    v_task.status_set_to, p_status_set_to,
    v_task.follow_up_date, p_follow_up_date,
    v_task.expected_date, p_expected_date,
    v_task.outcome, coalesce(p_outcome, v_task.outcome),
    v_task.call_notes, p_notes
  );

  update public.follow_up_tasks
     set status_set_to  = p_status_set_to,
         follow_up_date = p_follow_up_date,
         expected_date  = p_expected_date,
         outcome        = coalesce(p_outcome, outcome),
         call_notes     = p_notes,
         next_action    = case when v_is_open is false then null else next_action end
   where id = p_task_id;

  -- THE MOST-RECENT-EVENT RULE, unchanged: this call may still speak for the
  -- institute only when no visit and no other call reported later. What it
  -- writes has changed - the CALL track, not the visit track.
  select exists (
    select 1 from public.visits v
     where v.institute_id = v_task.institute_id
       and v.status_set_to is not null
       and v.reported_at > v_task.reported_at
    union all
    select 1 from public.follow_up_tasks f
     where f.institute_id = v_task.institute_id
       and f.kind = 'call'
       and f.id <> p_task_id
       and f.status_set_to is not null
       and f.reported_at > v_task.reported_at
  ) into v_has_later_event;

  if not v_has_later_event then
    perform set_config(
      'app.call_status_note',
      jsonb_build_object(
        'institute', v_task.institute_id,
        'status',    p_status_set_to,
        'call',      p_task_id,
        'at',        now(),
        'by',        v_caller
      )::text,
      true
    );

    update public.institutes
       set call_status = p_status_set_to
     where id = v_task.institute_id;

    perform set_config('app.call_status_note', '', true);
  end if;
end;
$$;

comment on function public.admin_update_call_report is
  'Admin-only correction to an already-filed Call Report. SECURITY INVOKER '
  'with is_admin() as its own first statement. Reads call_statuses and moves '
  'institutes.call_status through the SAME 0072 triggers, only when this call '
  'is still the institute''s most recent status-setting event. A closed status '
  'clears next_action and no new task is ever inserted. Every call records one '
  'append-only call_report_edits row. Raises FO016, FO024, FO040, FO045, FO046.';

revoke all on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) from public;
revoke all on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) from anon;
grant execute on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. call_activity_report() - counts by the CALL vocabulary
--
-- 0064's body, with institute_statuses replaced by call_statuses in the three
-- places it appears (per-rep category split, the totals aggregate, the status
-- list). Nothing else changes - the report has always been call-only.
-- -----------------------------------------------------------------------------
create or replace function public.call_activity_report(
  p_from      date    default null,
  p_to        date    default null,
  p_member    uuid    default null,
  p_institute text    default null,
  p_status    text    default null,
  p_sort      text    default 'rep',
  p_desc      boolean default false,
  p_page      integer default 1
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_export boolean := coalesce(p_page,1) < 1;
begin
  if not (public.is_admin() or public.is_team_lead()) then
    raise exception 'Only an admin or a team lead can read the Call Activity Report.'
      using errcode = '42501';
  end if;
  if v_export then
    if p_from is null or p_to is null then
      raise exception 'Choose a From and To date for the Excel export.' using errcode = '22023';
    end if;
    if p_to < p_from then
      raise exception 'The To date must not be before the From date.' using errcode = '22023';
    end if;
    if p_to - p_from + 1 > 31 then
      raise exception 'Choose a date range of 31 days or fewer for the Excel export.' using errcode = '22023';
    end if;
  end if;

  return (
    with registry as materialized (
      select p.id, p.name from profiles p
      where p.role = 'rep' and public.supervises(p.id)
        and (p_member is null or p.id = p_member)
    ), ranged_calls as materialized (
      select f.id, f.member, f.status_set_to
      from follow_up_tasks f
      join registry r on r.id = f.member
      join institutes i on i.id = f.institute_id and i.deleted_at is null
      where f.kind = 'call' and f.status_set_to is not null and f.reported_at is not null
        and (p_from is null or (f.reported_at at time zone 'Asia/Kolkata')::date >= p_from)
        and (p_to is null or (f.reported_at at time zone 'Asia/Kolkata')::date <= p_to)
        and (coalesce(trim(p_institute),'') = ''
             or strpos(lower(i.name), lower(trim(p_institute))) > 0)
        and (p_status is null or f.status_set_to = p_status)
    ), call_counts as (
      select member, status_set_to, count(*) n from ranged_calls group by member, status_set_to
    ), per_rep as (
      select r.id, r.name,
        coalesce(jsonb_object_agg(c.status_set_to, c.n) filter (where c.status_set_to is not null), '{}'::jsonb) by_status,
        coalesce(sum(c.n) filter (where s.category = 'open'), 0)::int open_total,
        coalesce(sum(c.n) filter (where s.category = 'closed'), 0)::int closed_total,
        coalesce(sum(c.n), 0)::int grand_total
      from registry r
      left join call_counts c on c.member = r.id
      left join call_statuses s on s.status = c.status_set_to
      group by r.id, r.name
    ), packed as (
      select id, name, jsonb_build_object(
        'id', id, 'name', name, 'statuses', by_status,
        'openTotal', open_total, 'closedTotal', closed_total, 'total', grand_total
      ) payload,
      case when p_sort = 'open_total' then to_jsonb(open_total)
        when p_sort = 'closed_total' then to_jsonb(closed_total)
        when p_sort = 'total' then to_jsonb(grand_total)
        when p_sort like 'status:%' then to_jsonb(coalesce((by_status ->> substring(p_sort from 8))::int, 0))
        else to_jsonb(lower(name))
      end sort_value
      from per_rep
    ), numbered as (
      select payload, row_number() over (
        order by case when not p_desc then sort_value end asc,
          case when p_desc then sort_value end desc, lower(name), id
      ) position
      from packed
    ), counts as (
      select count(*) total, greatest(1, ceil(count(*)/50.0)::integer) pages from registry
    ), totals as (
      select
        coalesce(jsonb_object_agg(s.status, coalesce(sc.n,0) order by s.sort_order, s.status), '{}'::jsonb) by_status,
        coalesce(sum(sc.n) filter (where s.category = 'open'), 0)::bigint open_total,
        coalesce(sum(sc.n) filter (where s.category = 'closed'), 0)::bigint closed_total,
        coalesce(sum(sc.n), 0)::bigint grand_total
      from call_statuses s
      left join (
        select status_set_to, count(*) n from ranged_calls group by status_set_to
      ) sc on sc.status_set_to = s.status
      where s.is_active
    ), windowed as (
      select total, pages,
        case when coalesce(p_page,1) < 1 then 1 else least(pages, greatest(1,p_page)) end page,
        coalesce(p_page,1) < 1 all_rows
      from counts
    )
    select jsonb_build_object(
      'total', w.total, 'pages', w.pages, 'page', w.page,
      'statuses', (select coalesce(jsonb_agg(jsonb_build_object(
          'status', s.status, 'category', s.category, 'sortOrder', s.sort_order)
          order by s.sort_order, s.status), '[]'::jsonb)
        from call_statuses s where s.is_active),
      'totals', jsonb_build_object(
        'byStatus', tot.by_status, 'openTotal', tot.open_total,
        'closedTotal', tot.closed_total, 'total', tot.grand_total),
      'rows', coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
        where w.all_rows or (n.position > (w.page-1)*50 and n.position <= w.page*50)), '[]'::jsonb)
    )
    from windowed w, totals tot
  );
end $$;

revoke all on function public.call_activity_report(date,date,uuid,text,text,text,boolean,integer) from public,anon;
grant execute on function public.call_activity_report(date,date,uuid,text,text,text,boolean,integer) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. audit_open_follow_ups - two tracks, one row per institute
--
-- Existing columns keep their names, order and types so this is a plain
-- CREATE OR REPLACE, and every current reader keeps working. Four columns are
-- appended: status_source, is_open, visit_status, call_status.
--
-- THE GOVERNING TRACK. An institute with only one track open is governed by
-- that track. With both open (or neither), the track whose latest
-- status-setting event is more recent governs - ties go to the visit track,
-- preserving the old view's behaviour. So `status` is always an OPEN status
-- whenever is_open is true, and status_source says whose it is.
--
-- ATTRIBUTION stays what it always was: the latest event that SET the shown
-- status. The union now filters each branch against its own track's current
-- status, and the lateral keeps only the governing source's event.
--
-- THE APP FILTERS ON is_open, not on a status list: the two vocabularies are
-- now independent, so "in (open visit statuses)" would silently drop a call
-- status that happens to share no name with a visit status.
-- -----------------------------------------------------------------------------
create or replace view public.audit_open_follow_ups with (security_invoker = true) as
select
  i.id            as institute_id,
  i.name          as institute_name,
  i.city,
  case gov.source when 'call' then i.call_status else i.status end as status,
  i.registered_by as owner,
  owner_profile.name as owner_name,
  a.id            as attribution_id,
  a.source        as attribution_source,
  a.member,
  actor.name      as member_name,
  a.date          as set_on,
  a.follow_up_date,
  a.expected_date,
  a.notes,
  gov.source      as status_source,
  (coalesce(public.institute_status_is_open(i.status), false)
   or coalesce(public.call_status_is_open(i.call_status), false)) as is_open,
  i.status        as visit_status,
  i.call_status   as call_status
from public.institutes i
cross join lateral (
  select case
    when coalesce(public.institute_status_is_open(i.status), false)
     and not coalesce(public.call_status_is_open(i.call_status), false) then 'visit'
    when coalesce(public.call_status_is_open(i.call_status), false)
     and not coalesce(public.institute_status_is_open(i.status), false) then 'call'
    when lv.at is null then 'call'
    when lc.at is null then 'visit'
    when lv.at >= lc.at then 'visit'
    else 'call'
  end as source
  from (select max(x.at) as at from (
          select v.created_at as at
            from public.visits v
           where v.institute_id = i.id and v.status_set_to is not null
        ) x) lv
  cross join (select max(y.at) as at from (
          select t.reported_at as at
            from public.follow_up_tasks t
           where t.institute_id = i.id and t.kind = 'call'
             and t.status_set_to is not null and t.reported_at is not null
        ) y) lc
) gov
left join lateral (
  select * from (
    select v.id, 'visit'::text as source, v.member,
           v.date, v.follow_up_date, v.expected_date, v.notes,
           v.created_at as at
      from public.visits v
     where v.institute_id = i.id and v.status_set_to = i.status
    union all
    select t.id, 'call'::text, t.member,
           (t.reported_at at time zone 'Asia/Kolkata')::date,
           t.follow_up_date, t.expected_date, t.call_notes,
           t.reported_at
      from public.follow_up_tasks t
     where t.institute_id = i.id and t.status_set_to = i.call_status
       and t.kind = 'call' and t.reported_at is not null
  ) events
  where events.source = gov.source
  order by events.at desc, events.id
  limit 1
) a on true
left join public.profiles owner_profile on owner_profile.id = i.registered_by
left join public.profiles actor on actor.id = a.member
where i.deleted_at is null;

grant select on public.audit_open_follow_ups to authenticated;


-- -----------------------------------------------------------------------------
-- 5. FO038 asks the track the new task belongs to
--
-- A call task is refused when the CALL track is closed; a meeting task when the
-- VISIT track is. `null` on either track still means "no status yet", which is
-- not closed - a fresh institute keeps taking follow-ups.
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
  if new.kind = 'call' then
    select i.call_status into v_status
      from public.institutes i
     where i.id = new.institute_id;

    if v_status is null then
      return new;
    end if;

    v_open := public.call_status_is_open(v_status);
  else
    select i.status into v_status
      from public.institutes i
     where i.id = new.institute_id;

    if v_status is null then
      return new;
    end if;

    v_open := public.institute_status_is_open(v_status);
  end if;

  if v_open is false then
    raise exception 'That institute is closed, so it does not take a follow-up.'
      using errcode = 'FO038';
  end if;

  return new;
end;
$$;

comment on function public.enforce_no_follow_up_when_closed is
  'FO038 - a call task cannot be created while the CALL track is closed; a '
  'meeting task cannot while the VISIT track is. SECURITY DEFINER so the '
  'status is read even when the caller cannot see the institute.';


-- -----------------------------------------------------------------------------
-- 6. Cancel-on-close: one shared body, one trigger per track
--
-- 0048's body, lifted into a plain function. The visit trigger keeps its name
-- and its `update of status` filter, so nothing that asserted on it moves; a
-- second trigger does the same for `update of call_status` against
-- call_statuses.cancels_follow_ups.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_open_work_for_institute(p_institute uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Open tasks leave Pending and the Daily Plan. The row stays, marked
  -- cancelled, so the fact that a follow-up had been owed is still a record.
  update public.follow_up_tasks
     set done_at = now(),
         outcome = 'cancelled'
   where institute_id = p_institute
     and done_at is null;

  -- Upcoming plan rows that have not started. A checked-in row is the visit in
  -- progress and stays; a past row is history and stays; checkout_missing is
  -- an admin's record.
  delete from public.daily_plans
   where institute_id = p_institute
     and date >= public.app_today()
     and checkin_at is null
     and checkout_at is null
     and meetings_actual is null
     and checkout_missing = false;

  -- Today's arrival, which we kept, must not still advertise a chase date.
  update public.daily_plans
     set follow_up_date = null
   where institute_id = p_institute
     and date >= public.app_today()
     and follow_up_date is not null;
end;
$$;

comment on function public.cancel_open_work_for_institute(uuid) is
  'Cancels an institute''s open follow-up tasks and clears upcoming unstarted '
  'plan rows. Shared body for both tracks'' cancel triggers (0073).';

revoke all on function public.cancel_open_work_for_institute(uuid) from public;
revoke all on function public.cancel_open_work_for_institute(uuid) from anon;
revoke all on function public.cancel_open_work_for_institute(uuid) from authenticated;

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

  perform public.cancel_open_work_for_institute(new.id);
  return new;
end;
$$;

comment on function public.cancel_upcoming_follow_ups is
  'Visit-track half of cancel-on-close (0048): when institutes.status moves to '
  'a status with cancels_follow_ups, run the shared body.';

revoke all on function public.cancel_upcoming_follow_ups() from public;
revoke all on function public.cancel_upcoming_follow_ups() from anon;
revoke all on function public.cancel_upcoming_follow_ups() from authenticated;

create or replace function public.cancel_upcoming_follow_ups_for_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cancels boolean;
begin
  select s.cancels_follow_ups into v_cancels
    from public.call_statuses s
   where s.status = new.call_status;

  if v_cancels is not true then
    return new;
  end if;

  perform public.cancel_open_work_for_institute(new.id);
  return new;
end;
$$;

comment on function public.cancel_upcoming_follow_ups_for_call is
  'Call-track half of cancel-on-close (0073): when institutes.call_status moves '
  'to a status with cancels_follow_ups, run the shared body.';

revoke all on function public.cancel_upcoming_follow_ups_for_call() from public;
revoke all on function public.cancel_upcoming_follow_ups_for_call() from anon;
revoke all on function public.cancel_upcoming_follow_ups_for_call() from authenticated;

drop trigger if exists institutes_cancel_follow_ups on public.institutes;
create trigger institutes_cancel_follow_ups
  after update of status on public.institutes
  for each row
  when (old.status is distinct from new.status)
  execute function public.cancel_upcoming_follow_ups();

drop trigger if exists institutes_cancel_follow_ups_call on public.institutes;
create trigger institutes_cancel_follow_ups_call
  after update of call_status on public.institutes
  for each row
  when (old.call_status is distinct from new.call_status)
  execute function public.cancel_upcoming_follow_ups_for_call();


-- -----------------------------------------------------------------------------
-- 7. materialise_due_followups() - the call recovery follows the call track
--
-- 0053's function, with ONE line changed: the call-recovery branch gates on
-- call_status_is_open(i.call_status) instead of institute_status_is_open(i.status).
-- The visit recovery and the meeting loop keep asking the visit track.
-- -----------------------------------------------------------------------------
create or replace function public.materialise_due_followups()
returns void language plpgsql security invoker set search_path='' as $$
declare
  uid uuid := auth.uid();
  purpose public.purposes%rowtype;
  task record;
  existing public.daily_plans%rowtype;
begin
  if uid is null or not public.is_rep() then
    raise exception 'Only a Rep can load their daily follow-ups.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,51));
  select * into purpose from public.purposes
    where is_active and activity='meeting' and not requires_note
    order by (label='Follow-up') desc,label limit 1;
  if not found then raise exception 'An active follow-up meeting purpose is required.' using errcode='22023'; end if;

  -- Recover scheduled institute follow-ups from the latest saved visit, without copying reports.
  insert into public.follow_up_tasks(member,institute_id,kind,due_date,purpose_id,from_visit_id)
  select uid,v.institute_id,coalesce(v.next_action,'meeting'),v.follow_up_date,purpose.id,v.id
  from (select distinct on (institute_id) * from public.visits
        where reported_at is not null order by institute_id,date desc,created_at desc,id) v
  join public.institutes i on i.id=v.institute_id
  where i.registered_by=uid and i.deleted_at is null and public.institute_status_is_open(i.status)
    and v.follow_up_date<=public.app_today()
    and not exists(select 1 from public.follow_up_tasks t where t.from_visit_id=v.id
      or (t.member=uid and t.institute_id=v.institute_id and t.due_date=v.follow_up_date));

  -- The same recovery for a saved call with a scheduled date but no next task
  -- yet. The CALL track decides whether that call still owes a follow-up.
  insert into public.follow_up_tasks(member,institute_id,kind,due_date,purpose_id,from_call_id)
  select uid,c.institute_id,coalesce(c.next_action,'meeting'),c.follow_up_date,purpose.id,c.id
  from public.follow_up_tasks c join public.institutes i on i.id=c.institute_id
  where c.member=uid and c.kind='call' and c.reported_at is not null
    and c.follow_up_date<=public.app_today() and i.deleted_at is null
    and i.registered_by=uid and public.call_status_is_open(i.call_status)
    and not exists(select 1 from public.follow_up_tasks t where t.from_call_id=c.id
      or (t.member=uid and t.institute_id=c.institute_id and t.due_date=c.follow_up_date
          and t.created_at>=c.reported_at));

  for task in select t.* from public.follow_up_tasks t join public.institutes i on i.id=t.institute_id
    where t.member=uid and t.kind='meeting' and t.done_at is null
      and t.due_date<=public.app_today() and i.deleted_at is null
      and public.institute_status_is_open(i.status) order by t.due_date,t.id
  loop
    select * into existing from public.daily_plans
      where follow_up_task_id=task.id and cancelled_at is null for update;
    if found then
      if existing.date>=public.app_today() or existing.checkin_at is not null then continue; end if;
      update public.daily_plans set cancelled_at=now() where id=existing.id;
    end if;
    select * into existing from public.daily_plans
      where member=uid and date=public.app_today() and institute_id=task.institute_id
        and purpose_id=purpose.id and follow_up_task_id is null and cancelled_at is null
      order by created_at limit 1 for update;
    if found then
      update public.daily_plans set follow_up_task_id=task.id where id=existing.id;
      if existing.checkout_at is not null then
        update public.follow_up_tasks set done_at=existing.checkout_at,outcome='done' where id=task.id;
      end if;
    else
      insert into public.daily_plans(member,date,institute_id,purpose,purpose_id,follow_up_task_id)
      values(uid,public.app_today(),task.institute_id,purpose.label,purpose.id,task.id);
    end if;
  end loop;
end;
$$;

revoke all on function public.materialise_due_followups() from public,anon;
grant execute on function public.materialise_due_followups() to authenticated;


-- -----------------------------------------------------------------------------
-- 8. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
  c        text;
begin
  -- 8a. Every rewritten function reads the call vocabulary and NOT the visit one.
  foreach c in array array['log_call', 'admin_update_call_report', 'call_activity_report'] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = c;

    if body is null then
      problems := array_append(problems, format('%s() is missing', c));
      continue;
    end if;

    if position('call_statuses' in body) = 0 then
      problems := array_append(problems, format('%s() does not read call_statuses', c));
    end if;
    if position('institute_statuses' in body) > 0 then
      problems := array_append(problems, format('%s() still reads institute_statuses', c));
    end if;
  end loop;

  -- log_call and admin_update_call_report must write the call track and name it.
  foreach c in array array['log_call', 'admin_update_call_report'] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = c;

    if body is null then
      continue;
    end if;

    if position('call_status =' in body) = 0 then
      problems := array_append(problems, format('%s() does not write institutes.call_status', c));
    end if;
    if position('call_status_note' in body) = 0 then
      problems := array_append(problems, format('%s() does not leave a call-status note', c));
    end if;
  end loop;

  -- 8b. The view is two-track and keeps every legacy column.
  if not exists (
    select 1 from pg_views
     where schemaname = 'public' and viewname = 'audit_open_follow_ups'
  ) then
    problems := array_append(problems, 'audit_open_follow_ups is missing');
  else
    select pg_get_viewdef('public.audit_open_follow_ups'::regclass, true) into body;
    foreach c in array array[
      'institute_id', 'institute_name', 'city', 'status', 'owner', 'owner_name',
      'attribution_id', 'attribution_source', 'member', 'member_name', 'set_on',
      'follow_up_date', 'expected_date', 'notes',
      'status_source', 'is_open', 'visit_status', 'call_status'
    ] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'audit_open_follow_ups'
           and column_name = c
      ) then
        problems := array_append(problems, format('audit_open_follow_ups.%s is missing', c));
      end if;
    end loop;
    if position('call_status_is_open' in body) = 0 then
      problems := array_append(problems, 'audit_open_follow_ups does not consult the call track');
    end if;
    if position('institute_status_is_open' in body) = 0 then
      problems := array_append(problems, 'audit_open_follow_ups does not consult the visit track');
    end if;
  end if;

  -- 8c. FO038 is track-aware.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_no_follow_up_when_closed';

  if body is null then
    problems := array_append(problems, 'enforce_no_follow_up_when_closed() is missing');
  else
    if position('call_status_is_open' in body) = 0
       or position('institute_status_is_open' in body) = 0 then
      problems := array_append(problems,
        'enforce_no_follow_up_when_closed() does not ask both tracks');
    end if;
    if position('new.kind' in body) = 0 then
      problems := array_append(problems,
        'enforce_no_follow_up_when_closed() ignores the task''s kind');
    end if;
  end if;

  -- 8d. The shared cancel body and BOTH triggers.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'cancel_open_work_for_institute'
  ) then
    problems := array_append(problems, 'cancel_open_work_for_institute() is missing');
  end if;

  foreach c in array array['institutes_cancel_follow_ups', 'institutes_cancel_follow_ups_call'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.institutes'::regclass and not tgisinternal
    ) then
      problems := array_append(problems, format('%s trigger is missing', c));
    end if;
  end loop;

  -- 8e. The call recovery follows the call track.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'materialise_due_followups';

  if body is null then
    problems := array_append(problems, 'materialise_due_followups() is missing');
  elsif position('call_status_is_open' in body) = 0 then
    problems := array_append(problems,
      'materialise_due_followups() does not gate the call recovery on the call track');
  end if;

  -- 8f. 0074 has NOT been applied: the FK still points at institute_statuses.
  if not exists (
    select 1 from pg_constraint
     where conname = 'follow_up_tasks_status_set_to_fk'
       and confrelid = 'public.institute_statuses'::regclass
  ) then
    problems := array_append(problems,
      'follow_up_tasks.status_set_to no longer references institute_statuses - 0074 must not have run');
  end if;

  -- 8g. The visit track is untouched.
  foreach c in array array[
    'institutes_touch_status', 'institutes_record_status_change',
    'institutes_cancel_follow_ups'
  ] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.institutes'::regclass and not tgisinternal
    ) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'touch_institute_status';
  if body is null or position('status_updated_at' in body) = 0 then
    problems := array_append(problems, 'touch_institute_status() lost the visit-track audit pair');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0073 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0073 applied: log_call/admin_update_call_report/call_activity_report read '
    'call_statuses; institutes.call_status is now the call track; FO038 is '
    'track-aware; cancel-on-close has a call trigger; the audit view is '
    'two-track. follow_up_tasks_status_set_to_fk still references '
    'institute_statuses (0074 not applied, by design).';
end $$;

commit;


-- =============================================================================
-- Afterwards
--
--   -- the two tracks, side by side
--   select i.name, i.status visit_status, i.call_status, a.status_source, a.is_open
--     from public.institutes i
--     join public.audit_open_follow_ups a on a.institute_id = i.id
--    where a.is_open
--    order by i.name;
-- =============================================================================
