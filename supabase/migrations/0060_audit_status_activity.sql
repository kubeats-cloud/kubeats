-- Status-wise institute activity, visit-level export, and in-SQL authorization.
--
-- 1. audit_institute_activity is now readable only by an admin or a team lead
--    (checked inside SQL, not only in the route) and returns one column per
--    active status (ordered as the app orders them) plus visit-level rows for
--    the export.
-- 2. audit_rep_institute_activity has NO rep-id parameter: it derives the rep
--    from auth.uid(), so a rep can only ever read their own institutes, visits
--    and follow-ups.
-- 3. Exports (p_page = 0) require a From/To range of at most 31 days.
begin;

create or replace function public.audit_institute_activity(
  p_from date default null, p_to date default null, p_search text default '',
  p_member uuid default null, p_campus uuid default null,
  p_sort text default 'institute', p_desc boolean default false, p_page integer default 1
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_export boolean := coalesce(p_page,1) < 1;
begin
  if not (public.is_admin() or public.is_team_lead()) then
    raise exception 'Only an admin or a team lead can read the institute activity report.'
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
      select i.id,i.name,i.type,i.city,i.area,i.state,i.status from institutes i
      where i.deleted_at is null
        and (p_member is null or i.registered_by = p_member)
        and (p_campus is null or i.campus_id = p_campus)
        and (coalesce(trim(p_search),'') = '' or strpos(
          lower(concat_ws(' ',i.name,i.city,i.area)),lower(trim(p_search))) > 0)
    ), ranged_visits as materialized (
      select v.id,v.institute_id,v.member,v.activity,v.date,v.status_set_to,
        v.follow_up_date,v.follow_up_time,v.next_action,
        d.purpose,d.checkin_at,d.checkout_at,d.checkin_lat,d.checkin_lng,d.checkout_lat,d.checkout_lng
      from visits v join registry r on r.id = v.institute_id
        left join daily_plans d on d.id = v.daily_plan_id
      where (p_from is null or v.date >= p_from) and (p_to is null or v.date <= p_to)
        and (p_member is null or v.member = p_member)
    ), visit_counts as (
      select institute_id,sum(n) total,
        jsonb_object_agg(status_set_to,n) filter (where status_set_to is not null) by_status
      from (
        select institute_id,status_set_to,count(*) n
        from ranged_visits group by institute_id,status_set_to
      ) c group by institute_id
    ), visit_followups as (
      select from_visit_id,
        count(*)::integer total_follow_ups,
        count(*) filter (where done_at is null)::integer open_follow_ups,
        min(due_date) filter (where done_at is null) next_action_date
      from follow_up_tasks
      where from_visit_id is not null
      group by from_visit_id
    ), ranged_plans as materialized (
      select d.id,d.institute_id,d.date,d.meetings_actual,d.checkin_at,d.checkout_at,
        d.checkin_lat,d.checkin_lng,d.checkout_lat,d.checkout_lng
      from daily_plans d join registry r on r.id = d.institute_id
      where (p_from is null or d.date >= p_from) and (p_to is null or d.date <= p_to)
        and (p_member is null or d.member = p_member)
    ), plan_counts as (
      select institute_id,count(*) filter (where meetings_actual = 1) meetings
      from ranged_plans group by institute_id
    ), latest as (
      select distinct on (institute_id) institute_id,checkin_at,checkout_at,
        checkin_lat,checkin_lng,checkout_lat,checkout_lng
      from ranged_plans where checkin_at is not null
      order by institute_id,date desc,checkin_at desc,id
    ), tasks as (
      select t.institute_id,count(*) owned,
        count(*) filter (where t.due_date <= public.app_today()) pending
      from follow_up_tasks t join registry r on r.id = t.institute_id
      where t.done_at is null and (p_member is null or t.member = p_member)
      group by t.institute_id
    ), packed as (
      select r.id,r.name,jsonb_build_object(
        'id',r.id,'name',r.name,'type',r.type,'city',r.city,'area',r.area,'state',r.state,'status',r.status,
        'byStatus',coalesce(v.by_status,'{}'::jsonb),
        'totalVisits',coalesce(v.total,0),'meetingsCompleted',coalesce(d.meetings,0),
        'followUpsOwned',coalesce(t.owned,0),'followUpsPending',coalesce(t.pending,0),
        'lastCheckinAt',l.checkin_at,'lastCheckoutAt',l.checkout_at,
        'lastCheckinArea',null,'lastCheckoutArea',null,
        'checkinLat',l.checkin_lat,'checkinLng',l.checkin_lng,
        'checkoutLat',l.checkout_lat,'checkoutLng',l.checkout_lng
      ) payload,
      case when p_sort = 'institute' then to_jsonb(lower(r.name))
        when p_sort like 'status:%' then to_jsonb(coalesce(((v.by_status -> substring(p_sort from 8))::text)::numeric,0))
        else to_jsonb(coalesce(((jsonb_build_object(
          'total_visits',coalesce(v.total,0),
          'follow_ups_owned',coalesce(t.owned,0),
          'follow_ups_pending',coalesce(t.pending,0),
          'meetings_completed',coalesce(d.meetings,0)
        )) ->> p_sort)::numeric,0))
      end sort_value
      from registry r left join visit_counts v on v.institute_id = r.id
        left join plan_counts d on d.institute_id = r.id left join latest l on l.institute_id = r.id
        left join tasks t on t.institute_id = r.id
    ), numbered as (
      select payload,row_number() over (
        order by case when not p_desc then sort_value end asc,
          case when p_desc then sort_value end desc,lower(name),id
      ) position from packed
    ), counts as (
      select count(*) total,greatest(1,ceil(count(*)/50.0)::integer) pages from registry
    ), totals as (
      select
        coalesce(sum(coalesce(v.total,0)),0)::bigint total_visits,
        coalesce(sum(coalesce(d.meetings,0)),0)::bigint meetings_completed,
        coalesce(sum(coalesce(t.owned,0)),0)::bigint follow_ups_owned,
        coalesce(sum(coalesce(t.pending,0)),0)::bigint follow_ups_pending,
        (select coalesce(
          jsonb_object_agg(s.status,coalesce(sc.n,0) order by s.sort_order,s.status),
          '{}'::jsonb)
         from institute_statuses s
         left join (
           select status_set_to,count(*) n from ranged_visits
           where status_set_to is not null group by status_set_to
         ) sc on sc.status_set_to = s.status
         where s.is_active) by_status
      from registry r left join visit_counts v on v.institute_id = r.id
        left join plan_counts d on d.institute_id = r.id left join tasks t on t.institute_id = r.id
    ), windowed as (
      select total,pages,
        case when coalesce(p_page,1) < 1 then 1 else least(pages,greatest(1,p_page)) end page,
        coalesce(p_page,1) < 1 all_rows
      from counts
    ), visit_payloads as (
      select jsonb_build_object(
        'institute',r.name,
        'member',p.name,
        'activity',rv.activity,
        'meetingPurpose',rv.purpose,
        'date',rv.date,
        'status',rv.status_set_to,
        'nextAction',rv.next_action,
        'nextActionDate',vf.next_action_date,
        'totalFollowUps',coalesce(vf.total_follow_ups,0),
        'openFollowUps',coalesce(vf.open_follow_ups,0),
        'checkinAt',rv.checkin_at,
        'checkoutAt',rv.checkout_at,
        'checkinLat',rv.checkin_lat,
        'checkinLng',rv.checkin_lng,
        'followUpDate',rv.follow_up_date,
        'followUpTime',rv.follow_up_time,
        'followUpCreated',exists(
          select 1 from follow_up_tasks f where f.from_visit_id = rv.id)
      ) payload,rv.date,rv.id
      from ranged_visits rv join registry r on r.id = rv.institute_id
        left join profiles p on p.id = rv.member
        left join visit_followups vf on vf.from_visit_id = rv.id
    )
    select jsonb_build_object(
      'total',w.total,'pages',w.pages,'page',w.page,
      'statuses',(select coalesce(jsonb_agg(jsonb_build_object(
        'status',s.status,'category',s.category,'sortOrder',s.sort_order)
        order by s.sort_order,s.status),'[]'::jsonb)
        from institute_statuses s where s.is_active),
      'totals',jsonb_build_object(
        'byStatus',tot.by_status,
        'totalVisits',tot.total_visits,
        'meetingsCompleted',tot.meetings_completed,
        'followUpsOwned',tot.follow_ups_owned,
        'followUpsPending',tot.follow_ups_pending),
      'visitCount',case when w.all_rows then (select count(*) from ranged_visits) else null end,
      'visits',case when w.all_rows then (
        select coalesce(jsonb_agg(vp.payload order by vp.date,vp.id),'[]'::jsonb)
        from visit_payloads vp) else '[]'::jsonb end,
      'rows',coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
        where w.all_rows or (n.position > (w.page-1)*50 and n.position <= w.page*50)),'[]'::jsonb)
    )
    from windowed w,totals tot
  );
end $$;
revoke all on function public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer) from public,anon;
grant execute on function public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer) to authenticated;

drop function if exists public.audit_rep_institute_activity(date,date,text,boolean,integer);
create function public.audit_rep_institute_activity(
  p_from date default null, p_to date default null,
  p_sort text default 'institute', p_desc boolean default false,
  p_page integer default 1
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_export boolean := coalesce(p_page,1) < 1;
begin
  if v_me is null or not public.is_rep() then
    raise exception 'Only a rep can read their own institute activity.' using errcode = '42501';
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
      select i.id,i.name,i.type,i.city,i.area,i.state,i.status from institutes i
      where i.deleted_at is null and i.registered_by = v_me
    ), visit_counts as (
      select v.institute_id,count(*) total,
        bool_or(not coalesce(v.activity in ('meeting','olympiad','application','admission') or (v.activity in ('session','campus_visit') and v.lifecycle_status in ('Set','Done')),false)) invalid,
        count(*) filter (where v.activity = 'meeting' and s.category = 'open') as meeting_open,
        count(*) filter (where v.activity = 'meeting' and s.category = 'closed') as meeting_closed,
        count(*) filter (where v.activity = 'session' and s.category = 'open') as session_open,
        count(*) filter (where v.activity = 'session' and s.category = 'closed') as session_closed,
        count(*) filter (where v.activity = 'campus_visit' and s.category = 'open') as campus_visit_open,
        count(*) filter (where v.activity = 'campus_visit' and s.category = 'closed') as campus_visit_closed,
        count(*) filter (where v.activity = 'olympiad' and s.category = 'open') as olympiad_open,
        count(*) filter (where v.activity = 'olympiad' and s.category = 'closed') as olympiad_closed,
        count(*) filter (where v.activity = 'application' and s.category = 'open') as application_open,
        count(*) filter (where v.activity = 'application' and s.category = 'closed') as application_closed,
        count(*) filter (where v.activity = 'admission' and s.category = 'open') as admission_open,
        count(*) filter (where v.activity = 'admission' and s.category = 'closed') as admission_closed
      from visits v join registry r on r.id = v.institute_id
        left join institute_statuses s on s.status = v.status_set_to
      where v.member = v_me
        and (p_from is null or v.date >= p_from) and (p_to is null or v.date <= p_to)
      group by v.institute_id
    ), ranged_plans as materialized (
      select d.id,d.institute_id,d.date,d.meetings_actual,d.checkin_at,d.checkout_at,
        d.checkin_lat,d.checkin_lng,d.checkout_lat,d.checkout_lng
      from daily_plans d join registry r on r.id = d.institute_id
      where d.member = v_me
        and (p_from is null or d.date >= p_from) and (p_to is null or d.date <= p_to)
    ), plan_counts as (
      select institute_id,count(*) filter (where meetings_actual = 1) meetings
      from ranged_plans group by institute_id
    ), latest as (
      select distinct on (institute_id) institute_id,checkin_at,checkout_at,
        checkin_lat,checkin_lng,checkout_lat,checkout_lng
      from ranged_plans where checkin_at is not null
      order by institute_id,date desc,checkin_at desc,id
    ), tasks as (
      select t.institute_id,count(*) owned,
        count(*) filter (where t.due_date <= public.app_today()) pending
      from follow_up_tasks t join registry r on r.id = t.institute_id
      where t.done_at is null and t.member = v_me
      group by t.institute_id
    ), packed as (
      select r.id,r.name,jsonb_build_object(
        'id',r.id,'name',r.name,'type',r.type,'city',r.city,'area',r.area,'state',r.state,'status',r.status,
        'byActivity',jsonb_build_object(
          'meeting',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.meeting_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.meeting_closed,0) end)),
          'session',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.session_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.session_closed,0) end)),
          'campus_visit',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end)),
          'olympiad',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.olympiad_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end)),
          'application',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.application_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.application_closed,0) end)),
          'admission',jsonb_build_object('open',(case when v.invalid then 0 else coalesce(v.admission_open,0) end),'closed',(case when v.invalid then 0 else coalesce(v.admission_closed,0) end))),
        'totalActivities',coalesce(v.total,0),'meetingsCompleted',coalesce(d.meetings,0),
        'followUpsOwned',coalesce(t.owned,0),'followUpsPending',coalesce(t.pending,0),
        'totalVisits',coalesce(v.total,0),'lastCheckinAt',l.checkin_at,'lastCheckoutAt',l.checkout_at,
        'lastCheckinArea',null,'lastCheckoutArea',null,
        'checkinLat',l.checkin_lat,'checkinLng',l.checkin_lng,
        'checkoutLat',l.checkout_lat,'checkoutLng',l.checkout_lng
      ) payload,
      case when p_sort = 'institute' then to_jsonb(lower(r.name))
        else to_jsonb(coalesce(((jsonb_build_object(
          'meeting_open',(case when v.invalid then 0 else coalesce(v.meeting_open,0) end),
          'meeting_closed',(case when v.invalid then 0 else coalesce(v.meeting_closed,0) end),
          'session_open',(case when v.invalid then 0 else coalesce(v.session_open,0) end),
          'session_closed',(case when v.invalid then 0 else coalesce(v.session_closed,0) end),
          'campus_visit_open',(case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end),
          'campus_visit_closed',(case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end),
          'olympiad_open',(case when v.invalid then 0 else coalesce(v.olympiad_open,0) end),
          'olympiad_closed',(case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end),
          'application_open',(case when v.invalid then 0 else coalesce(v.application_open,0) end),
          'application_closed',(case when v.invalid then 0 else coalesce(v.application_closed,0) end),
          'admission_open',(case when v.invalid then 0 else coalesce(v.admission_open,0) end),
          'admission_closed',(case when v.invalid then 0 else coalesce(v.admission_closed,0) end),
          'total',coalesce(v.total,0),'meetings_completed',coalesce(d.meetings,0),
          'follow_ups_owned',coalesce(t.owned,0),'follow_ups_pending',coalesce(t.pending,0),
          'open_total',(case when v.invalid then 0 else coalesce(v.meeting_open,0) end)+(case when v.invalid then 0 else coalesce(v.session_open,0) end)+(case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end)+(case when v.invalid then 0 else coalesce(v.olympiad_open,0) end)+(case when v.invalid then 0 else coalesce(v.application_open,0) end)+(case when v.invalid then 0 else coalesce(v.admission_open,0) end),
          'closed_total',(case when v.invalid then 0 else coalesce(v.meeting_closed,0) end)+(case when v.invalid then 0 else coalesce(v.session_closed,0) end)+(case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end)+(case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end)+(case when v.invalid then 0 else coalesce(v.application_closed,0) end)+(case when v.invalid then 0 else coalesce(v.admission_closed,0) end),
          'total_visits',coalesce(v.total,0)
        )) ->> p_sort)::numeric,0))
      end sort_value
      from registry r left join visit_counts v on v.institute_id = r.id
        left join plan_counts d on d.institute_id = r.id left join latest l on l.institute_id = r.id
        left join tasks t on t.institute_id = r.id
    ), numbered as (
      select payload,row_number() over (
        order by case when not p_desc then sort_value end asc,
          case when p_desc then sort_value end desc,lower(name),id
      ) position from packed
    ), counts as (
      select count(*) total,greatest(1,ceil(count(*)/50.0)::integer) pages from registry
    ), totals as (
      select
        coalesce(sum(case when v.invalid then 0 else coalesce(v.meeting_open,0) end),0)::bigint meeting_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.meeting_closed,0) end),0)::bigint meeting_closed,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.session_open,0) end),0)::bigint session_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.session_closed,0) end),0)::bigint session_closed,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end),0)::bigint campus_visit_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end),0)::bigint campus_visit_closed,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.olympiad_open,0) end),0)::bigint olympiad_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end),0)::bigint olympiad_closed,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.application_open,0) end),0)::bigint application_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.application_closed,0) end),0)::bigint application_closed,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.admission_open,0) end),0)::bigint admission_open,
        coalesce(sum(case when v.invalid then 0 else coalesce(v.admission_closed,0) end),0)::bigint admission_closed,
        coalesce(sum(coalesce(v.total,0)),0)::bigint total_activities,
        coalesce(sum(coalesce(d.meetings,0)),0)::bigint meetings_completed,
        coalesce(sum(coalesce(t.owned,0)),0)::bigint follow_ups_owned,
        coalesce(sum(coalesce(t.pending,0)),0)::bigint follow_ups_pending,
        coalesce(sum(coalesce(v.total,0)),0)::bigint total_visits
      from registry r left join visit_counts v on v.institute_id = r.id
        left join plan_counts d on d.institute_id = r.id left join tasks t on t.institute_id = r.id
    ), windowed as (
      select total,pages,
        case when coalesce(p_page,1) < 1 then 1 else least(pages,greatest(1,p_page)) end page,
        coalesce(p_page,1) < 1 all_rows
      from counts
    ), visit_followups as (
      select from_visit_id,
        count(*)::integer total_follow_ups,
        count(*) filter (where done_at is null)::integer open_follow_ups,
        min(due_date) filter (where done_at is null) next_action_date
      from follow_up_tasks
      where from_visit_id is not null and member = v_me
      group by from_visit_id
    ), visit_payloads as (
      select jsonb_build_object(
        'institute',r.name,
        'member',p.name,
        'activity',v.activity,
        'meetingPurpose',d.purpose,
        'date',v.date,
        'status',v.status_set_to,
        'nextAction',v.next_action,
        'nextActionDate',vf.next_action_date,
        'totalFollowUps',coalesce(vf.total_follow_ups,0),
        'openFollowUps',coalesce(vf.open_follow_ups,0),
        'checkinAt',d.checkin_at,
        'checkoutAt',d.checkout_at,
        'checkinLat',d.checkin_lat,
        'checkinLng',d.checkin_lng,
        'followUpDate',v.follow_up_date,
        'followUpTime',v.follow_up_time,
        'followUpCreated',coalesce(vf.total_follow_ups,0) > 0
      ) payload,v.date,v.id
      from visits v join registry r on r.id = v.institute_id
        left join daily_plans d on d.id = v.daily_plan_id
        left join profiles p on p.id = v.member
        left join visit_followups vf on vf.from_visit_id = v.id
      where v.member = v_me
        and (p_from is null or v.date >= p_from)
        and (p_to is null or v.date <= p_to)
    )
    select jsonb_build_object(
      'total',w.total,'pages',w.pages,'page',w.page,
      'statuses',(select coalesce(jsonb_agg(jsonb_build_object(
        'status',s.status,'category',s.category,'sortOrder',s.sort_order)
        order by s.sort_order,s.status),'[]'::jsonb)
        from institute_statuses s where s.is_active),
      'totals',jsonb_build_object(
        'meeting',jsonb_build_object('open',tot.meeting_open,'closed',tot.meeting_closed),
        'session',jsonb_build_object('open',tot.session_open,'closed',tot.session_closed),
        'campus_visit',jsonb_build_object('open',tot.campus_visit_open,'closed',tot.campus_visit_closed),
        'olympiad',jsonb_build_object('open',tot.olympiad_open,'closed',tot.olympiad_closed),
        'application',jsonb_build_object('open',tot.application_open,'closed',tot.application_closed),
        'admission',jsonb_build_object('open',tot.admission_open,'closed',tot.admission_closed),
        'totalActivities',tot.total_activities,'meetingsCompleted',tot.meetings_completed,
        'followUpsOwned',tot.follow_ups_owned,'followUpsPending',tot.follow_ups_pending,
        'totalVisits',tot.total_visits),
      'visitCount',case when w.all_rows then (select count(*) from visit_payloads) else null end,
      'visits',case when w.all_rows then (
        select coalesce(jsonb_agg(vp.payload order by vp.date,vp.id),'[]'::jsonb)
        from visit_payloads vp) else '[]'::jsonb end,
      'rows',coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
        where w.all_rows or (n.position > (w.page-1)*50 and n.position <= w.page*50)),'[]'::jsonb)
    )
    from windowed w,totals tot
  );
end $$;
revoke all on function public.audit_rep_institute_activity(date,date,text,boolean,integer) from public,anon;
grant execute on function public.audit_rep_institute_activity(date,date,text,boolean,integer) to authenticated;

commit;
