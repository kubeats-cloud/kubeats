-- Bounded, caller-scoped Activity model. Existing RLS/FO033 are unchanged.
begin;
create function public.audit_institute_activity(
  p_from date default null, p_to date default null, p_search text default '',
  p_member uuid default null, p_campus uuid default null,
  p_sort text default 'institute', p_desc boolean default false, p_page integer default 1
) returns jsonb
language sql stable security invoker set search_path = public as $$
  with registry as materialized (
    select i.id,i.name,i.type,i.city,i.area,i.state,i.status from institutes i
    where i.deleted_at is null
      and (p_member is null or i.registered_by = p_member)
      and (p_campus is null or i.campus_id = p_campus)
      and (coalesce(trim(p_search),'') = '' or strpos(
        lower(concat_ws(' ',i.name,i.city,i.area)),lower(trim(p_search))) > 0)
  ), visit_counts as (
    select v.institute_id, count(*) total,
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
    where (p_from is null or v.date >= p_from) and (p_to is null or v.date <= p_to)
      and (p_member is null or v.member = p_member)
    group by v.institute_id
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
      'byActivity',jsonb_build_object('meeting', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.meeting_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.meeting_closed,0) end)),
          'session', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.session_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.session_closed,0) end)),
          'campus_visit', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end)),
          'olympiad', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.olympiad_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end)),
          'application', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.application_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.application_closed,0) end)),
          'admission', jsonb_build_object('open', (case when v.invalid then 0 else coalesce(v.admission_open,0) end), 'closed', (case when v.invalid then 0 else coalesce(v.admission_closed,0) end))),
      'totalActivities',coalesce(v.total,0),'meetingsCompleted',coalesce(d.meetings,0),
      'followUpsOwned',coalesce(t.owned,0),'followUpsPending',coalesce(t.pending,0),
      'totalVisits',coalesce(v.total,0),'lastCheckinAt',l.checkin_at,'lastCheckoutAt',l.checkout_at,
      'lastCheckinArea',null,'lastCheckoutArea',null,
      'checkinLat',l.checkin_lat,'checkinLng',l.checkin_lng,
      'checkoutLat',l.checkout_lat,'checkoutLng',l.checkout_lng
    ) payload,
    case when p_sort = 'institute' then to_jsonb(lower(r.name))
      else coalesce(jsonb_build_object(
        'meeting_open', (case when v.invalid then 0 else coalesce(v.meeting_open,0) end),
          'meeting_closed', (case when v.invalid then 0 else coalesce(v.meeting_closed,0) end),
          'session_open', (case when v.invalid then 0 else coalesce(v.session_open,0) end),
          'session_closed', (case when v.invalid then 0 else coalesce(v.session_closed,0) end),
          'campus_visit_open', (case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end),
          'campus_visit_closed', (case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end),
          'olympiad_open', (case when v.invalid then 0 else coalesce(v.olympiad_open,0) end),
          'olympiad_closed', (case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end),
          'application_open', (case when v.invalid then 0 else coalesce(v.application_open,0) end),
          'application_closed', (case when v.invalid then 0 else coalesce(v.application_closed,0) end),
          'admission_open', (case when v.invalid then 0 else coalesce(v.admission_open,0) end),
          'admission_closed', (case when v.invalid then 0 else coalesce(v.admission_closed,0) end),
        'total',coalesce(v.total,0),'meetings_completed',coalesce(d.meetings,0),
        'follow_ups_owned',coalesce(t.owned,0),'follow_ups_pending',coalesce(t.pending,0),
        'open_total',(case when v.invalid then 0 else coalesce(v.meeting_open,0) end)+(case when v.invalid then 0 else coalesce(v.session_open,0) end)+(case when v.invalid then 0 else coalesce(v.campus_visit_open,0) end)+(case when v.invalid then 0 else coalesce(v.olympiad_open,0) end)+(case when v.invalid then 0 else coalesce(v.application_open,0) end)+(case when v.invalid then 0 else coalesce(v.admission_open,0) end),'closed_total',(case when v.invalid then 0 else coalesce(v.meeting_closed,0) end)+(case when v.invalid then 0 else coalesce(v.session_closed,0) end)+(case when v.invalid then 0 else coalesce(v.campus_visit_closed,0) end)+(case when v.invalid then 0 else coalesce(v.olympiad_closed,0) end)+(case when v.invalid then 0 else coalesce(v.application_closed,0) end)+(case when v.invalid then 0 else coalesce(v.admission_closed,0) end),'total_visits',coalesce(v.total,0)
      )->p_sort,to_jsonb(lower(r.name))) end sort_value
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
  ), windowed as (
    select total,pages,least(pages,greatest(1,coalesce(p_page,1))) page from counts
  )
  select jsonb_build_object('total',w.total,'pages',w.pages,'page',w.page,
    'reconciliationFailed',exists(select 1 from visit_counts where invalid),
    'rows',coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
      where n.position > (w.page-1)*50 and n.position <= w.page*50),'[]'::jsonb))
  from windowed w;
$$;
revoke all on function public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer) from public,anon;
grant execute on function public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer) to authenticated;
commit;
