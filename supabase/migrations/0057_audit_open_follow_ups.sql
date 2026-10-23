-- Preserve visit/call attribution to CURRENT status, before SQL sort/pagination.
begin;
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
commit;
