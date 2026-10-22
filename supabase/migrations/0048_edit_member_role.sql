-- Admin-only, atomic edit through the existing Team form. No historical rows removed.
begin;
create or replace function public.edit_team_member(
  p_member uuid, p_name text, p_role text, p_campus uuid, p_retag boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.profiles%rowtype;
  receipt jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit a team member.' using errcode='42501';
  end if;
  if p_role not in ('rep','team_lead') or p_role is null
     or p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Choose a supported role and name.' using errcode='22023';
  end if;
  select * into v from public.profiles where id=p_member for update;
  if not found or v.role not in ('rep','team_lead') then
    raise exception 'Only Rep and Team Lead accounts use this edit.' using errcode='42501';
  end if;
  if p_campus is null or not exists(select 1 from public.campuses where id=p_campus) then
    raise exception 'Choose a campus.' using errcode='22023';
  end if;
  if v.role is distinct from p_role and (
    exists(select 1 from public.daily_plans where member=p_member and checkin_at is not null
      and checkout_at is null and not checkout_missing)
    or exists(select 1 from public.visits where member=p_member and reported_at is null)
  ) then
    raise exception 'Finish outstanding visit reports before changing this role.' using errcode='22023';
  end if;
  -- A demoted lead no longer supervises these reps; their work and ownership stay intact.
  if v.role='team_lead' and p_role='rep' then
    update public.profiles set team_lead_id=null where team_lead_id=p_member;
    update public.profiles set role='rep' where id=p_member;
  end if;
  if p_campus is distinct from v.campus_id then
    if v.role='rep' or p_role='rep' then
      receipt := public.correct_member_campus(p_member,p_campus,p_retag);
    else
      -- Keep FO033's one-campus boundary in force. This does not enable A6.
      if exists(select 1 from public.profiles where team_lead_id=p_member)
         or exists(select 1 from public.institutes where registered_by=p_member) then
        raise exception 'Reassign this lead''s team before changing their campus.' using errcode='FO033';
      end if;
      if not exists(select 1 from public.campuses where id=p_campus and active) then
        raise exception 'Choose an active campus.' using errcode='22023';
      end if;
      update public.profiles set campus_id=p_campus where id=p_member;
      receipt := jsonb_build_object('campus',(select name from public.campuses where id=p_campus));
    end if;
  end if;
  update public.profiles
    set name=btrim(p_name), role=p_role,
        team_lead_id=case when p_role='team_lead' then null else team_lead_id end
    where id=p_member;
  return receipt || jsonb_build_object('role',p_role);
end;
$$;
revoke all on function public.edit_team_member(uuid,text,text,uuid,boolean) from public,anon;
grant execute on function public.edit_team_member(uuid,text,text,uuid,boolean) to authenticated;
commit;
