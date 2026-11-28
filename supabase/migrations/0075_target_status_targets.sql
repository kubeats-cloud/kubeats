-- =============================================================================
-- KUbeats - migration 0075: target statuses become weekly numeric commitments
--
-- Adds a child row for each (weekly target, target-status) value and one RPC
-- that writes the fixed target fields and these child values atomically.
-- public.targets and all achieved/reporting paths are deliberately unchanged.
-- =============================================================================

begin;


-- 1. One value per target row and vocabulary entry.
create table public.target_status_targets (
  target_id    uuid not null,
  status_name  text not null,
  value        integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint target_status_targets_pkey primary key (target_id, status_name),
  constraint target_status_targets_target_fk
    foreign key (target_id) references public.targets (id)
    on update cascade on delete cascade,
  constraint target_status_targets_status_fk
    foreign key (status_name) references public.target_statuses (name)
    on update cascade on delete restrict,
  constraint target_status_targets_value_valid check (value between 0 and 999)
);

comment on table public.target_status_targets is
  'Rep-set numeric commitments for visible target-status vocabulary rows. One '
  'value per public.targets row and target status; no achieved value is derived.';

comment on constraint target_status_targets_status_fk on public.target_status_targets is
  'A rename cascades so saved commitments keep their meaning. Deletion is '
  'restricted while any saved commitment still references the status.';

create index target_status_targets_status_idx
  on public.target_status_targets (status_name);


-- 2. Timestamp and lock guards. The child follows the parent lock even for a
--    privileged/direct SQL caller; reopening remains an update of targets and
--    therefore continues to use enforce_target_lock() from 0042.
create function public.set_target_status_target_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger target_status_targets_set_updated_at
  before update on public.target_status_targets
  for each row execute function public.set_target_status_target_updated_at();

create function public.enforce_target_status_target_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id uuid := new.target_id;
  v_locked boolean;
begin
  -- An admin rename of target_statuses cascades through its foreign key. It
  -- changes only the label key, not the rep's numeric commitment, and must
  -- keep working for historical locked weeks.
  if tg_op = 'UPDATE'
     and old.target_id = new.target_id
     and old.value = new.value
     and old.status_name is distinct from new.status_name then
    return new;
  end if;

  select t.locked into v_locked
    from public.targets t
   where t.id = v_target_id;

  if v_locked then
    raise exception
      'This target period is locked. Ask an admin or team lead to reopen it before editing.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger target_status_targets_enforce_lock
  before insert or update on public.target_status_targets
  for each row execute function public.enforce_target_status_target_lock();


-- 3. RLS mirrors the parent target boundary. Supervisors can read. Only the
--    owning rep can insert/update, only while the parent is unlocked, and only
--    for a target_statuses row visible through that table's 0066 SELECT policy.
alter table public.target_status_targets enable row level security;

revoke all on public.target_status_targets from anon;
revoke all on public.target_status_targets from authenticated;
grant select, insert, update on public.target_status_targets to authenticated;

create policy target_status_targets_select on public.target_status_targets
  for select to authenticated
  using (
    exists (
      select 1
        from public.targets t
       where t.id = target_id
         and public.supervises(t.member)
    )
  );

create policy target_status_targets_insert on public.target_status_targets
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.targets t
       where t.id = target_id
         and t.member = (select auth.uid())
         and not t.locked
    )
    and public.is_rep()
    and exists (
      select 1
        from public.target_statuses s
       where s.name = status_name
    )
  );

create policy target_status_targets_update on public.target_status_targets
  for update to authenticated
  using (
    exists (
      select 1
        from public.targets t
       where t.id = target_id
         and t.member = (select auth.uid())
         and not t.locked
    )
    and public.is_rep()
    and exists (
      select 1
        from public.target_statuses s
       where s.name = status_name
    )
  )
  with check (
    exists (
      select 1
        from public.targets t
       where t.id = target_id
         and t.member = (select auth.uid())
         and not t.locked
    )
    and public.is_rep()
    and exists (
      select 1
        from public.target_statuses s
       where s.name = status_name
    )
  );


-- 4. One transaction for parent and children. A submit is deliberately three
--    steps: write the unlocked parent, write children, then lock the parent.
--    PostgreSQL functions are atomic, so any refusal rolls all three back.
create function public.save_weekly_targets(
  p_week_start date,
  p_meetings integer,
  p_sessions_set integer,
  p_sessions_done integer,
  p_campus_visits_set integer,
  p_campus_visits_done integer,
  p_olympiad integer,
  p_application integer,
  p_admission integer,
  p_calls integer,
  p_status_targets jsonb,
  p_submit boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member uuid := (select auth.uid());
  v_target_id uuid;
  v_item record;
  v_number numeric;
begin
  if v_member is null then
    raise exception 'Authentication required.' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_rep() then
    raise exception 'Only a rep can set a weekly commitment.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status_targets is null or jsonb_typeof(p_status_targets) <> 'object' then
    raise exception 'Status targets must be a JSON object.' using errcode = 'check_violation';
  end if;

  if p_meetings not between 0 and 999
     or p_sessions_set not between 0 and 999
     or p_sessions_done not between 0 and 999
     or p_campus_visits_set not between 0 and 999
     or p_campus_visits_done not between 0 and 999
     or p_olympiad not between 0 and 999
     or p_application not between 0 and 999
     or p_admission not between 0 and 999
     or (p_calls is not null and p_calls not between 0 and 9999) then
    raise exception 'Target values are outside their allowed range.'
      using errcode = 'check_violation';
  end if;

  -- This upsert cannot reopen a locked row: it never assigns locked, and the
  -- existing enforce_target_lock trigger rejects every update of a locked row.
  insert into public.targets (
    member, period, period_start, meetings, sessions_set, sessions_done,
    campus_visits_set, campus_visits_done, olympiad, application, admission,
    calls, locked
  ) values (
    v_member, 'weekly', p_week_start, p_meetings, p_sessions_set, p_sessions_done,
    p_campus_visits_set, p_campus_visits_done, p_olympiad, p_application,
    p_admission, p_calls, false
  )
  on conflict (member, period, period_start) do update set
    meetings = excluded.meetings,
    sessions_set = excluded.sessions_set,
    sessions_done = excluded.sessions_done,
    campus_visits_set = excluded.campus_visits_set,
    campus_visits_done = excluded.campus_visits_done,
    olympiad = excluded.olympiad,
    application = excluded.application,
    admission = excluded.admission,
    calls = excluded.calls
  returning id into v_target_id;

  for v_item in select key as status_name, value as target_value
                  from jsonb_each(p_status_targets)
  loop
    if jsonb_typeof(v_item.target_value) <> 'number' then
      raise exception 'Target status % must be a whole number.', v_item.status_name
        using errcode = 'check_violation';
    end if;

    v_number := (v_item.target_value #>> '{}')::numeric;
    if v_number <> trunc(v_number) or v_number not between 0 and 999 then
      raise exception 'Target status % must be a whole number from 0 to 999.', v_item.status_name
        using errcode = 'check_violation';
    end if;

    -- target_statuses RLS is active for this SECURITY INVOKER function. A
    -- missing or campus-invisible vocabulary row therefore gets the same safe
    -- refusal and cannot be smuggled through a crafted RPC call.
    if not exists (
      select 1 from public.target_statuses s where s.name = v_item.status_name
    ) then
      raise exception 'Target status % is not available to this rep.', v_item.status_name
        using errcode = 'insufficient_privilege';
    end if;

    insert into public.target_status_targets (target_id, status_name, value)
    values (v_target_id, v_item.status_name, v_number::integer)
    on conflict (target_id, status_name) do update set value = excluded.value;
  end loop;

  if p_submit then
    update public.targets set locked = true where id = v_target_id;
  end if;

  return v_target_id;
end;
$$;

revoke all on function public.save_weekly_targets(
  date, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, jsonb, boolean
) from public;
revoke all on function public.save_weekly_targets(
  date, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, jsonb, boolean
) from anon;
grant execute on function public.save_weekly_targets(
  date, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, jsonb, boolean
) to authenticated;

comment on function public.save_weekly_targets(
  date, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, jsonb, boolean
) is
  'Atomically saves the weekly targets row and visible target-status values, '
  'then optionally locks the parent. Identity comes only from auth.uid().';


-- 5. Structural proof. Behavioral RLS/lock coverage lives in the integration
--    suite because only authenticated sessions can prove those branches.
do $$
declare
  problems text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.target_status_targets'::regclass) then
    problems := problems || 'RLS is not enabled';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.target_status_targets'::regclass) <> 3 then
    problems := problems || 'expected select/insert/update policies';
  end if;
  if has_table_privilege('authenticated', 'public.target_status_targets', 'DELETE') then
    problems := problems || 'authenticated unexpectedly has DELETE';
  end if;
  if to_regprocedure('public.save_weekly_targets(date,integer,integer,integer,integer,integer,integer,integer,integer,integer,jsonb,boolean)') is null then
    problems := problems || 'save_weekly_targets RPC is missing';
  end if;
  if array_length(problems, 1) > 0 then
    raise exception '0075 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
