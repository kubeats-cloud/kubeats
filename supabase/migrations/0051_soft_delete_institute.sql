-- Soft deletion keeps institute, visit, status and follow-up history.
begin;
alter table public.institutes add column if not exists deleted_at timestamptz;
create or replace function public.guard_institute_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and new.deleted_at is not null)
     or (tg_op='UPDATE' and new.deleted_at is distinct from old.deleted_at) then
    if not public.is_admin() then
      raise exception 'Only an admin can delete an institute.' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists institutes_guard_deletion on public.institutes;
create trigger institutes_guard_deletion before insert or update on public.institutes
for each row execute function public.guard_institute_deletion();

create or replace function public.guard_active_institute_work()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_deleted timestamptz;
begin
  select deleted_at into v_deleted from public.institutes where id=new.institute_id for share;
  if v_deleted is not null then
    raise exception 'This institute is no longer active.' using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists daily_plans_active_institute on public.daily_plans;
create trigger daily_plans_active_institute before insert on public.daily_plans
for each row execute function public.guard_active_institute_work();
drop trigger if exists follow_up_tasks_active_institute on public.follow_up_tasks;
create trigger follow_up_tasks_active_institute before insert on public.follow_up_tasks
for each row execute function public.guard_active_institute_work();
drop trigger if exists visits_active_institute on public.visits;
create trigger visits_active_institute before insert on public.visits
for each row execute function public.guard_active_institute_work();

create or replace function public.soft_delete_institute(p_institute uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete an institute.' using errcode='42501';
  end if;
  perform 1 from public.institutes where id=p_institute for update;
  if not found then raise exception 'Institute not found.' using errcode='22023'; end if;
  if exists(select 1 from public.daily_plans where institute_id=p_institute
    and checkin_at is not null and checkout_at is null and not checkout_missing) then
    raise exception 'Finish the visit in progress before deleting this institute.' using errcode='22023';
  end if;
  update public.institutes set deleted_at=coalesce(deleted_at,now()) where id=p_institute;
  update public.follow_up_tasks set done_at=now(),outcome='cancelled'
    where institute_id=p_institute and done_at is null;
  update public.daily_plans set cancelled_at=coalesce(cancelled_at,now())
    where institute_id=p_institute and checkin_at is null and checkout_at is null
      and date>=public.app_today() and not checkout_missing;
end;
$$;
revoke all on function public.soft_delete_institute(uuid) from public,anon;
grant execute on function public.soft_delete_institute(uuid) to authenticated;
revoke all on function public.guard_institute_deletion() from public,anon,authenticated;
revoke all on function public.guard_active_institute_work() from public,anon,authenticated;
commit;
