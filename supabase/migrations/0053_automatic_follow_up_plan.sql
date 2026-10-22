-- Due and overdue follow-ups enter Today's Plan without deleting historical plans.
begin;
alter table public.daily_plans add column if not exists follow_up_task_id uuid
  references public.follow_up_tasks(id) on delete restrict;
alter table public.follow_up_tasks add column if not exists from_call_id uuid
  references public.follow_up_tasks(id) on delete restrict;
create unique index if not exists daily_plans_one_active_follow_up
  on public.daily_plans(follow_up_task_id) where follow_up_task_id is not null and cancelled_at is null;
create unique index if not exists follow_up_tasks_one_from_call
  on public.follow_up_tasks(from_call_id) where from_call_id is not null;

create or replace function public.guard_plan_follow_up_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.follow_up_task_id is not null then
    if not exists(select 1 from public.follow_up_tasks t
      where t.id=new.follow_up_task_id and t.member=new.member
        and t.institute_id=new.institute_id and t.kind='meeting') then
      raise exception 'This follow-up does not belong to this plan.' using errcode='23514';
    end if;
    if tg_op='UPDATE' and old.follow_up_task_id is not null
       and new.follow_up_task_id is distinct from old.follow_up_task_id then
      raise exception 'The original follow-up link is part of history.' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists daily_plans_follow_up_link on public.daily_plans;
create trigger daily_plans_follow_up_link before insert or update on public.daily_plans
for each row execute function public.guard_plan_follow_up_link();

create or replace function public.complete_planned_follow_up()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.follow_up_task_id is not null and old.checkout_at is null and new.checkout_at is not null then
    update public.follow_up_tasks set done_at=new.checkout_at,outcome='done'
      where id=new.follow_up_task_id and done_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists daily_plans_complete_follow_up on public.daily_plans;
create trigger daily_plans_complete_follow_up after update of checkout_at on public.daily_plans
for each row execute function public.complete_planned_follow_up();

create or replace function public.cancel_finished_follow_up_plan()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.done_at is null and new.done_at is not null then
    update public.daily_plans set cancelled_at=coalesce(cancelled_at,now())
      where follow_up_task_id=new.id and checkin_at is null and cancelled_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists follow_up_tasks_cancel_finished_plan on public.follow_up_tasks;
create trigger follow_up_tasks_cancel_finished_plan after update of done_at on public.follow_up_tasks
for each row execute function public.cancel_finished_follow_up_plan();

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

  -- The same recovery for a saved call with a scheduled date but no next task yet.
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
      -- A missed unstarted plan is retained as cancelled before today's plan is added.
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
revoke all on function public.guard_plan_follow_up_link() from public,anon,authenticated;
revoke all on function public.complete_planned_follow_up() from public,anon,authenticated;
revoke all on function public.cancel_finished_follow_up_plan() from public,anon,authenticated;
commit;
