-- =============================================================================
-- KUbeats - DOWN migration 0061
--
-- Reverses supabase/migrations/0061_team_lead_cross_campus.sql.
-- NOT applied by walking migrations/ — this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   assign_rep_to_team() and enforce_team_lead_link(), restored to their
--   0043 bodies — a rep and their team lead must once again share a campus.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any cross-campus pairing made while 0061 was in effect. Re-applying this
--   down migration does NOT retroactively unassign a rep from a lead on
--   another campus — the trigger only re-checks on the next write to that
--   row. Run the query at the foot of 0061 first to find any such pairing
--   and decide by hand whether to release it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0061 afterwards removes the
--   campus check again.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. assign_rep_to_team(), back to the 0043 body.
-- -----------------------------------------------------------------------------
create or replace function public.assign_rep_to_team(
  p_rep  uuid,
  p_lead uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rep_role      text;
  v_rep_campus    uuid;
  v_rep_name      text;
  v_lead_role     text;
  v_lead_campus   uuid;
  v_lead_name     text;
  v_old_lead      uuid;
begin
  if not (
    public.is_admin()
    or (public.is_team_lead() and (p_lead = (select auth.uid()) or p_lead is null))
  ) then
    raise exception
      'Only an admin, or the team lead taking them on, can change which team a rep is in.'
      using errcode = 'FO034';
  end if;

  if p_rep is null then
    raise exception 'No rep was named.' using errcode = 'FO034';
  end if;

  select role, campus_id, name, team_lead_id
    into v_rep_role, v_rep_campus, v_rep_name, v_old_lead
    from public.profiles where id = p_rep;

  if v_rep_role is null then
    raise exception 'That rep no longer exists.' using errcode = 'FO034';
  end if;

  if v_rep_role <> 'rep' then
    raise exception
      'Only a rep belongs to a team. An admin and a team lead each report to nobody.'
      using errcode = 'FO034';
  end if;

  if not public.is_admin()
     and v_old_lead is not null
     and v_old_lead is distinct from (select auth.uid()) then
    raise exception
      'That rep is already on another team. Ask an admin to move them.'
      using errcode = 'FO034';
  end if;

  if p_lead is not null then
    select role, campus_id, name into v_lead_role, v_lead_campus, v_lead_name
      from public.profiles where id = p_lead;

    if v_lead_role is null then
      raise exception 'That team lead no longer exists.' using errcode = 'FO034';
    end if;

    if v_lead_role <> 'team_lead' then
      raise exception
        'A rep can only be assigned to a team lead.'
        using errcode = 'FO034';
    end if;

    if v_lead_campus is distinct from v_rep_campus then
      raise exception
        'A rep and their team lead must work from the same campus. Move the rep''s campus first, or choose a lead on theirs.'
        using errcode = 'FO034';
    end if;
  end if;

  update public.profiles set team_lead_id = p_lead where id = p_rep;

  return jsonb_build_object(
    'rep', v_rep_name,
    'lead', v_lead_name,
    'released', p_lead is null
  );
end;
$$;

comment on function public.assign_rep_to_team is
  'Puts a rep on a team, or takes them off it (p_lead null). An admin may move '
  'anybody; a team lead may take a rep onto their OWN team and release one of '
  'their own. SECURITY DEFINER because profiles_update does not let a lead '
  'reach another profile - and FO033 still re-checks every rule inside, since '
  'auth.uid() is the caller even here. Raises FO034.';

revoke all on function public.assign_rep_to_team(uuid, uuid) from public;
revoke all on function public.assign_rep_to_team(uuid, uuid) from anon;
grant execute on function public.assign_rep_to_team(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. enforce_team_lead_link(), back to the 0043 body — clause (d) restored.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_team_lead_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := (select auth.uid());
  v_lead_role text;
  v_lead_campus uuid;
begin
  if new.role <> 'rep' and new.team_lead_id is not null then
    raise exception
      'Only a rep belongs to a team lead.'
      using errcode = 'FO033';
  end if;

  if (tg_op = 'INSERT' and new.team_lead_id is not null)
     or (tg_op = 'UPDATE' and new.team_lead_id is distinct from old.team_lead_id)
  then
    if caller is not null
       and not public.is_admin()
       and not (
         public.is_team_lead()
         and coalesce(new.team_lead_id = caller, true)
         and coalesce(
               case when tg_op = 'INSERT' then true
                    else old.team_lead_id = caller end,
               true)
       ) then
      raise exception
        'Only an admin, or the team lead taking them on, can change which team a rep is in.'
        using errcode = 'FO033';
    end if;
  end if;

  if new.team_lead_id is null then
    return new;
  end if;

  if new.team_lead_id = new.id then
    raise exception
      'Nobody is their own team lead.'
      using errcode = 'FO033';
  end if;

  select p.role, p.campus_id into v_lead_role, v_lead_campus
    from public.profiles p
   where p.id = new.team_lead_id;

  if v_lead_role is null then
    raise exception
      'That team lead no longer exists.'
      using errcode = 'FO033';
  end if;

  if v_lead_role <> 'team_lead' then
    raise exception
      'A rep can only be assigned to a team lead.'
      using errcode = 'FO033';
  end if;

  if v_lead_campus is distinct from new.campus_id then
    raise exception
      'A rep and their team lead must work from the same campus.'
      using errcode = 'FO033';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_team_lead_link on public.profiles;
create trigger profiles_team_lead_link
  before insert or update of role, campus_id, team_lead_id on public.profiles
  for each row execute function public.enforce_team_lead_link();


do $$
declare
  problems text[] := '{}';
  body     text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'assign_rep_to_team';

  if body is null or position('must work from the same campus' in body) = 0 then
    problems := array_append(problems, 'assign_rep_to_team() did not get the campus check back');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_team_lead_link';

  if body is null or position('must work from the same campus' in body) = 0 then
    problems := array_append(problems, 'enforce_team_lead_link() did not get the campus check back');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0061 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0061 down applied: a rep and their team lead must share a campus again.';
end $$;
