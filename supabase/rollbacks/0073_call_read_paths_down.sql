-- =============================================================================
-- KUbeats - DOWN migration 0073
--
-- Reverses supabase/migrations/0073_call_read_paths.sql by restoring the exact
-- pre-0073 bodies:
--
--   log_call()                      <- 0052
--   admin_update_call_report()      <- 0063
--   call_activity_report()          <- 0064
--   audit_open_follow_ups           <- 0057
--   enforce_no_follow_up_when_closed() <- 0048
--   cancel_upcoming_follow_ups()    <- 0048, and the call trigger/split body is
--                                      dropped
--   materialise_due_followups()     <- 0053
--
-- Nothing else in 0073 existed before it, so nothing else needs dropping.
-- Safe only before 0074: with the FK still on institute_statuses, restoring
-- these bodies puts every read back on the visit vocabulary, which is exactly
-- what the database looked like before 0073.
--
-- WHAT IT REFUSES TO UNDO (same caveat every rollback carries): call statuses
-- written to institutes.call_status while 0073 was in effect remain there.
-- They are not copied back to institutes.status. Roll back 0072 afterwards if
-- the column itself should go.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice.
-- =============================================================================

begin;


-- 1. log_call() - 0052's body, verbatim.
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

  if p_status_set_to is null then
    raise exception 'Say where this call leaves the institute before saving it.'
      using errcode = 'FO024';
  end if;

  select s.category, s.asks_expected_date, s.asks_session_detail, s.asks_head_count
    into v_category, v_asks_expected, v_asks_session, v_asks_head_count
    from public.institute_statuses s
   where s.status = p_status_set_to;

  if v_category = 'closed' and p_next_action is not null then
    raise exception 'A closed status does not take a next action.' using errcode='22023';
  end if;

  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  if (public.institute_status_is_open(p_status_set_to) or p_next_action is not null)
     and p_follow_up_date is null then
    raise exception '%',
      case when p_next_action is not null
             then 'Say when this follow-up is due.'
           else 'That status leaves the institute open, so a follow-up date is needed.'
      end
      using errcode = 'FO016';
  end if;

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

  if p_status_set_to is not null then
    update public.institutes
       set status = p_status_set_to
     where id = v_task.institute_id;

    if not found then
      raise exception 'That institute no longer exists.' using errcode = 'FO006';
    end if;
  end if;

  if p_next_action is not null then
    insert into public.follow_up_tasks (
      member, institute_id, kind, due_date, note, from_visit_id
    ) values (
      v_member, v_task.institute_id, p_next_action, p_follow_up_date, p_follow_up_note, null
    );
  end if;
end;
$$;


-- 2. admin_update_call_report() - 0063's body, verbatim.
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
  if not public.is_admin() then
    raise exception 'Only an admin can edit a Call Report.' using errcode = 'FO045';
  end if;

  if p_task_id is null then
    raise exception 'No call report was named.' using errcode = 'FO046';
  end if;

  select * into v_task
    from public.follow_up_tasks
   where id = p_task_id
     and kind = 'call'
     and reported_at is not null
   for update;

  if not found then
    raise exception 'That Call Report could not be found.' using errcode = 'FO046';
  end if;

  if p_status_set_to is null then
    raise exception 'Choose a status before saving.' using errcode = 'FO024';
  end if;

  select s.asks_expected_date into v_asks_expected
    from public.institute_statuses s
   where s.status = p_status_set_to;
  v_is_open := public.institute_status_is_open(p_status_set_to);

  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  if v_is_open and p_follow_up_date is null then
    raise exception 'That status leaves the institute open, so a follow-up date is needed.'
      using errcode = 'FO016';
  end if;

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
    update public.institutes
       set status = p_status_set_to
     where id = v_task.institute_id;
  end if;
end;
$$;


-- 3. call_activity_report() - 0064's body, verbatim.
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
      left join institute_statuses s on s.status = c.status_set_to
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
      from institute_statuses s
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
        from institute_statuses s where s.is_active),
      'totals', jsonb_build_object(
        'byStatus', tot.by_status, 'openTotal', tot.open_total,
        'closedTotal', tot.closed_total, 'total', tot.grand_total),
      'rows', coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
        where w.all_rows or (n.position > (w.page-1)*50 and n.position <= w.page*50)), '[]'::jsonb)
    )
    from windowed w, totals tot
  );
end $$;


-- 4. audit_open_follow_ups - 0057's definition, verbatim.
drop view if exists public.audit_open_follow_ups;
create view public.audit_open_follow_ups with (security_invoker = true) as
select i.id institute_id,i.name institute_name,i.city,i.status,i.registered_by owner,
  owner_profile.name owner_name,a.id attribution_id,a.source attribution_source,a.member,
  actor.name member_name,a.date set_on,a.follow_up_date,a.expected_date,a.notes
from institutes i
left join lateral (
  select * from (
    select v.id,v.member,v.date,v.follow_up_date,v.expected_date,v.notes,v.created_at at,'visit'::text source
    from visits v where v.institute_id = i.id and v.status_set_to = i.status
    union all
    select t.id,t.member,(t.reported_at at time zone 'Asia/Kolkata')::date,
      t.follow_up_date,t.expected_date,t.call_notes,t.reported_at,'call'::text
    from follow_up_tasks t where t.institute_id = i.id and t.status_set_to = i.status
      and t.kind = 'call' and t.reported_at is not null
  ) events order by at desc,id limit 1
) a on true
left join profiles owner_profile on owner_profile.id = i.registered_by
left join profiles actor on actor.id = a.member
where i.deleted_at is null;
grant select on public.audit_open_follow_ups to authenticated;


-- 5. enforce_no_follow_up_when_closed() - 0048's body, verbatim.
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


-- 6. cancel_upcoming_follow_ups() - 0048's body; the call track that 0073 added
--    is removed outright.
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

  update public.follow_up_tasks
     set done_at = now(),
         outcome = 'cancelled'
   where institute_id = new.id
     and done_at is null;

  delete from public.daily_plans
   where institute_id = new.id
     and date >= public.app_today()
     and checkin_at is null
     and checkout_at is null
     and meetings_actual is null
     and checkout_missing = false;

  update public.daily_plans
     set follow_up_date = null
   where institute_id = new.id
     and date >= public.app_today()
     and follow_up_date is not null;

  return new;
end;
$$;

drop trigger if exists institutes_cancel_follow_ups_call on public.institutes;
drop function if exists public.cancel_upcoming_follow_ups_for_call();
drop function if exists public.cancel_open_work_for_institute(uuid);


-- 7. materialise_due_followups() - 0053's body, verbatim.
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

  insert into public.follow_up_tasks(member,institute_id,kind,due_date,purpose_id,from_visit_id)
  select uid,v.institute_id,coalesce(v.next_action,'meeting'),v.follow_up_date,purpose.id,v.id
  from (select distinct on (institute_id) * from public.visits
        where reported_at is not null order by institute_id,date desc,created_at desc,id) v
  join public.institutes i on i.id=v.institute_id
  where i.registered_by=uid and i.deleted_at is null and public.institute_status_is_open(i.status)
    and v.follow_up_date<=public.app_today()
    and not exists(select 1 from public.follow_up_tasks t where t.from_visit_id=v.id
      or (t.member=uid and t.institute_id=v.institute_id and t.due_date=v.follow_up_date));

  insert into public.follow_up_tasks(member,institute_id,kind,due_date,purpose_id,from_call_id)
  select uid,c.institute_id,coalesce(c.next_action,'meeting'),c.follow_up_date,purpose.id,c.id
  from public.follow_up_tasks c join public.institutes i on i.id=c.institute_id
  where c.member=uid and c.kind='call' and c.reported_at is not null
    and c.follow_up_date<=public.app_today() and i.deleted_at is null
    and i.registered_by=uid and public.institute_status_is_open(i.status)
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


-- Prove it landed: every restored body reads the visit vocabulary again.
do $$
declare
  problems text[] := '{}';
  body     text;
  c        text;
begin
  foreach c in array array['log_call', 'admin_update_call_report', 'call_activity_report'] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = c;

    if body is null then
      problems := array_append(problems, format('%s() is missing', c));
    elsif position('institute_statuses' in body) = 0 then
      problems := array_append(problems, format('%s() does not read institute_statuses again', c));
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_open_follow_ups'
       and column_name = 'status_source'
  ) then
    null; -- expected: the two-track columns are gone with the restore
  else
    problems := array_append(problems, 'audit_open_follow_ups still has status_source');
  end if;

  if exists (
    select 1 from pg_trigger
     where tgname = 'institutes_cancel_follow_ups_call'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_cancel_follow_ups_call is still attached');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_cancel_follow_ups'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_cancel_follow_ups has gone missing');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0073 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0073 down applied: every call-side read is back on the visit vocabulary.';
end $$;

commit;
