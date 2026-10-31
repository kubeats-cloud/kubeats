-- =============================================================================
-- KUbeats - migration 0069: rep_daily_status
--
-- A rep declares, once a day, where they are working: in the field, in the
-- office, or on leave. This is a SEPARATE fact from check-in/check-out
-- (0014). Check-in is recorded per PLANNED VISIT in public.daily_plans; a rep
-- with no visits that day, or one on leave, has no row there at all. The daily
-- status is per REP PER CALENDAR DAY, and "no row" means "not recorded" - it
-- is never inferred from anything, and it is never counted as a worked day.
--
-- THE DAY IS public.app_today() (0008): (now() at time zone 'Asia/Kolkata')::date.
-- The same definition visits.date, daily_plans.date and every audit RPC use.
--
-- ONE ROW PER REP PER DAY, BY PRIMARY KEY. An upsert overwrites status/set_by/
-- set_at, so this table stores only the LATEST value for a day. It is not an
-- edit history; there is deliberately no second row and no ledger.
--
-- WHO MAY DO WHAT (decided by RLS, and again by the RPCs):
--
--   read    self OR admin OR public.supervises(rep_id)   (a team lead's team)
--   write   self, TODAY ONLY OR admin, ANY rep, ANY date
--   delete  nobody - there is no DELETE policy, and no DELETE grant
--
-- A team lead is READ-ONLY for their team. supervises() (0041) already returns
-- true for self and for an admin, so the read policy's three clauses overlap by
-- design; they are kept separate so the rule reads as the rule. my_campus() is
-- NOT used: this table has no campus column, and team scope is supervises().
--
-- set_by and set_at are stamped by a BEFORE trigger from auth.uid() and now(),
-- never taken from the request body. A direct PostgREST write cannot forge
-- them; the RPC path cannot either.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New paste -> Run. Idempotent:
--   create-or-replace / if-not-exists throughout, and the assertion block at
--   the foot is read-only.
--
-- DOWN
--   supabase/rollbacks/0069_rep_daily_status_down.sql drops the trigger, the
--   four functions and the table (which takes its policies, index and
--   constraints with it).
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- rep_id CASCADES: a departing member's own status rows go with their profile,
-- the same as their visits and plans (0068's teardown order).
--
-- set_by is ON DELETE SET NULL, not CASCADE: it is an audit byline on somebody
-- else's row (an admin who corrected a rep's day). If the admin is deleted the
-- day keeps its status and loses only the byline - call_report_edits.edited_by
-- (0063) makes the same call for the same reason.
-- -----------------------------------------------------------------------------
create table if not exists public.rep_daily_status (
  rep_id      uuid        not null,
  status_date date        not null default public.app_today(),
  status      text        not null,
  set_by      uuid,
  set_at      timestamptz not null default now(),
  constraint rep_daily_status_pkey
    primary key (rep_id, status_date),
  constraint rep_daily_status_rep_id_fkey
    foreign key (rep_id) references public.profiles (id) on delete cascade,
  constraint rep_daily_status_set_by_fkey
    foreign key (set_by) references public.profiles (id) on delete set null,
  constraint rep_daily_status_status_check
    check (status in ('in_field', 'in_office', 'on_leave'))
);

comment on table public.rep_daily_status is
  'One rep-declared status per rep per Asia/Kolkata calendar day: in_field, '
  'in_office or on_leave. A missing row means "not recorded" - never inferred '
  'from check-ins and never counted. Upsert overwrites the row, so only the '
  'latest value per day is stored; this is not an edit history.';

comment on column public.rep_daily_status.rep_id is
  'The rep whose day this is. ON DELETE CASCADE with their profile.';

comment on column public.rep_daily_status.status_date is
  'The Asia/Kolkata calendar day, defaulting to public.app_today() (0008).';

comment on column public.rep_daily_status.status is
  'in_field | in_office | on_leave. CHECK refuses anything else.';

comment on column public.rep_daily_status.set_by is
  'Who last set it, stamped from auth.uid() by rep_daily_status_stamp. An '
  'admin correcting a rep is the only case where this differs from rep_id. '
  'ON DELETE SET NULL: the day outlives the admin.';

comment on column public.rep_daily_status.set_at is
  'When the current value was last written, stamped from now(). Overwritten by '
  'an upsert - the row keeps only the latest value, not a history.';

create index if not exists rep_daily_status_date_idx
  on public.rep_daily_status (status_date, rep_id);


-- -----------------------------------------------------------------------------
-- 2. The stamp
--
-- BEFORE INSERT OR UPDATE, so both the insert half and the update half of an
-- upsert are covered. auth.uid() is null for a service-role script; the column
-- is nullable and that is the honest answer for a row no signed-in person set.
--
-- This is a trigger rather than part of the write policies because a policy
-- can only ALLOW or REFUSE a row; it cannot replace a client-supplied value.
-- -----------------------------------------------------------------------------
create or replace function public.stamp_rep_daily_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.set_by := (select auth.uid());
  new.set_at := now();
  return new;
end;
$$;

revoke all on function public.stamp_rep_daily_status() from public, anon, authenticated;

drop trigger if exists rep_daily_status_stamp on public.rep_daily_status;
create trigger rep_daily_status_stamp
  before insert or update on public.rep_daily_status
  for each row
  execute function public.stamp_rep_daily_status();


-- -----------------------------------------------------------------------------
-- 3. RLS
--
-- SELECT - three clauses, the 0065 shape adapted to this table:
--   is_admin()                every rep, every day
--   rep_id = auth.uid()       the caller's own row
--   supervises(rep_id)        a team lead's own reps (and, by its own body,
--                             self and admin again - kept explicit anyway)
--
-- INSERT / UPDATE - admin anywhere, or a REP setting their own row for TODAY.
-- The today-only AND role half is in SQL here, not only in the UI and not only
-- in the RPC, so a rep cannot POST a past (or future) date straight at
-- PostgREST, and a team lead cannot write a row at all - read-only is the
-- whole of their relationship with this table.
--
-- No DELETE policy and no DELETE grant: a correction is an upsert, and the day
-- is never removed through the API.
-- -----------------------------------------------------------------------------
alter table public.rep_daily_status enable row level security;

drop policy if exists rep_daily_status_select on public.rep_daily_status;
create policy rep_daily_status_select on public.rep_daily_status
  for select to authenticated
  using (
    public.is_admin()
    or rep_id = (select auth.uid())
    or public.supervises(rep_id)
  );

drop policy if exists rep_daily_status_insert on public.rep_daily_status;
create policy rep_daily_status_insert on public.rep_daily_status
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      public.is_rep()
      and rep_id = (select auth.uid())
      and status_date = public.app_today()
    )
  );

drop policy if exists rep_daily_status_update on public.rep_daily_status;
create policy rep_daily_status_update on public.rep_daily_status
  for update to authenticated
  using (
    public.is_admin()
    or (
      public.is_rep()
      and rep_id = (select auth.uid())
      and status_date = public.app_today()
    )
  )
  with check (
    public.is_admin()
    or (
      public.is_rep()
      and rep_id = (select auth.uid())
      and status_date = public.app_today()
    )
  );

revoke all on public.rep_daily_status from public, anon, authenticated;
grant select, insert, update on public.rep_daily_status to authenticated;


-- -----------------------------------------------------------------------------
-- 4. set_my_daily_status(status) - the rep's own toggle
--
-- SECURITY INVOKER, so every statement below runs as the caller and the RLS
-- above is the real gate. The explicit role check exists to give a team lead a
-- clear 42501 rather than a bare "new row violates row-level security policy".
--
-- The upsert is atomic: (rep_id, status_date) is the primary key, so two
-- concurrent clicks cannot produce two rows. One wins, the other updates it.
-- -----------------------------------------------------------------------------
create or replace function public.set_my_daily_status(p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
  v_day  date := public.app_today();
  v_row  public.rep_daily_status;
begin
  if v_uid is null then
    raise exception 'Sign in to set your daily status.' using errcode = '42501';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'rep' then
    raise exception 'Only a rep sets their own daily status.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('in_field', 'in_office', 'on_leave') then
    raise exception 'Choose In-Field, In-Office or On-Leave.' using errcode = '22023';
  end if;

  insert into public.rep_daily_status (rep_id, status_date, status)
  values (v_uid, v_day, p_status)
  on conflict (rep_id, status_date)
  do update set status = excluded.status
  returning * into v_row;

  return jsonb_build_object(
    'statusDate', v_row.status_date,
    'status',     v_row.status,
    'setAt',      v_row.set_at
  );
end;
$$;

revoke all on function public.set_my_daily_status(text) from public, anon;
grant execute on function public.set_my_daily_status(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 5. admin_set_rep_daily_status(rep, date, status) - the admin correction
--
-- Admin-only, any rep, any date (past, today or future). SECURITY INVOKER for
-- consistency with the rep path; is_admin() is the explicit first statement and
-- the admin branch of the write policies is what actually permits the row.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_rep_daily_status(
  p_rep_id      uuid,
  p_status_date date,
  p_status      text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.rep_daily_status;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can set another member''s daily status.'
      using errcode = '42501';
  end if;

  if p_rep_id is null or p_status_date is null then
    raise exception 'Choose a rep and a date.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = p_rep_id and p.role = 'rep'
  ) then
    raise exception 'That member is not a rep.' using errcode = '22023';
  end if;

  if p_status is null or p_status not in ('in_field', 'in_office', 'on_leave') then
    raise exception 'Choose In-Field, In-Office or On-Leave.' using errcode = '22023';
  end if;

  insert into public.rep_daily_status (rep_id, status_date, status)
  values (p_rep_id, p_status_date, p_status)
  on conflict (rep_id, status_date)
  do update set status = excluded.status
  returning * into v_row;

  return jsonb_build_object(
    'repId',      v_row.rep_id,
    'statusDate', v_row.status_date,
    'status',     v_row.status,
    'setAt',      v_row.set_at
  );
end;
$$;

revoke all on function public.admin_set_rep_daily_status(uuid, date, text) from public, anon;
grant execute on function public.admin_set_rep_daily_status(uuid, date, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. rep_daily_status_report - the screen's one read
--
-- SECURITY INVOKER. Scope is decided in SQL:
--
--   admin      every rep
--   team lead  every rep public.supervises() returns true for
--   rep        themselves
--
-- `p_member` can only NARROW that scope, never widen it: the registry applies
-- supervises() before it applies p_member, so a foreign rep id simply matches
-- nothing.
--
-- The default range is the current Asia/Kolkata calendar month. The caller may
-- override either end. p_page < 1 means "every rep" (the export-shaped answer);
-- otherwise 50 reps a page, ordered by name.
--
-- COUNTS ARE RECORDED DAYS ONLY. The left join keeps every rep in scope
-- visible, with zeros, so "no days recorded" is a row of zeros rather than a
-- missing rep. A day with no row is not in any count, and `recorded` is the
-- number of stored days - not the number of calendar days in the range.
-- -----------------------------------------------------------------------------
create or replace function public.rep_daily_status_report(
  p_start  date    default null,
  p_to     date    default null,
  p_member uuid    default null,
  p_page   integer default 1
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_start  date := coalesce(p_start, date_trunc('month', public.app_today())::date);
  v_end    date := coalesce(p_to, (date_trunc('month', public.app_today()) + interval '1 month - 1 day')::date);
  v_all    boolean := coalesce(p_page, 1) < 1;
  v_page   integer := greatest(1, coalesce(p_page, 1));
  v_size   constant integer := 50;
begin
  if v_uid is null then
    raise exception 'Sign in to read daily status.' using errcode = '42501';
  end if;

  if v_end < v_start then
    raise exception 'The To date must not be before the From date.' using errcode = '22023';
  end if;

  return (
    with registry as materialized (
      select p.id, p.name
      from public.profiles p
      where p.role = 'rep'
        and (public.is_admin() or public.supervises(p.id))
        and (p_member is null or p.id = p_member)
    ), ranged as materialized (
      select s.rep_id, s.status_date, s.status
      from public.rep_daily_status s
      join registry r on r.id = s.rep_id
      where s.status_date between v_start and v_end
    ), per_rep as (
      select
        r.id,
        r.name,
        count(*) filter (where g.status = 'in_field')::int  as in_field,
        count(*) filter (where g.status = 'in_office')::int as in_office,
        count(*) filter (where g.status = 'on_leave')::int  as on_leave,
        count(g.status_date)::int                           as recorded,
        coalesce(
          jsonb_agg(
            jsonb_build_object('date', g.status_date, 'status', g.status)
            order by g.status_date
          ) filter (where g.status_date is not null),
          '[]'::jsonb
        ) as days
      from registry r
      left join ranged g on g.rep_id = r.id
      group by r.id, r.name
    ), ordered as (
      select
        p.*,
        row_number() over (order by lower(coalesce(p.name, '')), p.id) as position
      from per_rep p
    ), counts as (
      select count(*)::int as total,
             greatest(1, ceil(count(*) / 50.0)::integer) as pages
      from registry
    ), windowed as (
      select total, pages,
             case when v_all then 1 else least(pages, v_page) end as page,
             v_all as all_rows
      from counts
    ), totals as (
      select
        count(*) filter (where status = 'in_field')::int  as in_field,
        count(*) filter (where status = 'in_office')::int as in_office,
        count(*) filter (where status = 'on_leave')::int  as on_leave,
        count(*)::int                                     as recorded
      from ranged
    )
    select jsonb_build_object(
      'start', v_start,
      'end',   v_end,
      'total', w.total,
      'pages', w.pages,
      'page',  w.page,
      'totals', jsonb_build_object(
        'inField',  t.in_field,
        'inOffice', t.in_office,
        'onLeave',  t.on_leave,
        'recorded', t.recorded
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',       o.id,
            'name',     o.name,
            'inField',  o.in_field,
            'inOffice', o.in_office,
            'onLeave',  o.on_leave,
            'recorded', o.recorded,
            'days',     o.days
          ) order by o.position
        )
        from ordered o
        where w.all_rows
           or (o.position > (w.page - 1) * v_size and o.position <= w.page * v_size)
      ), '[]'::jsonb)
    )
    from windowed w, totals t
  );
end;
$$;

revoke all on function public.rep_daily_status_report(date, date, uuid, integer) from public, anon;
grant execute on function public.rep_daily_status_report(date, date, uuid, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Did it land?
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  def      text;
  n        integer;
begin
  -- 7a. The table, its columns and nullability.
  if to_regclass('public.rep_daily_status') is null then
    problems := array_append(problems, 'rep_daily_status is missing');
  else
    foreach def in array array[
      'rep_id:NO', 'status_date:NO', 'status:NO', 'set_by:YES', 'set_at:NO'
    ] loop
      if not exists (
        select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = 'rep_daily_status'
           and c.column_name = split_part(def, ':', 1)
           and c.is_nullable = split_part(def, ':', 2)
      ) then
        problems := array_append(problems,
          format('rep_daily_status.%s is missing or has the wrong nullability',
                 split_part(def, ':', 1)));
      end if;
    end loop;

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'rep_daily_status'
         and column_name = 'status_date'
         and column_default like '%app_today%'
    ) then
      problems := array_append(problems,
        'rep_daily_status.status_date does not default to public.app_today()');
    end if;
  end if;

  -- 7b. Primary key, CHECK, and both foreign keys' delete actions.
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.rep_daily_status'::regclass
     and c.contype = 'p';
  if def is null or def not like '%PRIMARY KEY (rep_id, status_date)%' then
    problems := array_append(problems,
      'rep_daily_status primary key is not (rep_id, status_date)');
  end if;

  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.rep_daily_status'::regclass
     and c.conname = 'rep_daily_status_status_check';
  if def is null
     or position('in_field' in def) = 0
     or position('in_office' in def) = 0
     or position('on_leave' in def) = 0 then
    problems := array_append(problems,
      'rep_daily_status status CHECK does not list all three statuses');
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'rep_daily_status_rep_id_fkey'
       and c.contype = 'f' and c.confdeltype = 'c'
  ) then
    problems := array_append(problems,
      'rep_daily_status.rep_id has no CASCADE foreign key to profiles');
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'rep_daily_status_set_by_fkey'
       and c.contype = 'f' and c.confdeltype = 'n'
  ) then
    problems := array_append(problems,
      'rep_daily_status.set_by has no SET NULL foreign key to profiles');
  end if;

  -- 7c. The date index.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'rep_daily_status'
       and indexname = 'rep_daily_status_date_idx'
  ) then
    problems := array_append(problems, 'rep_daily_status_date_idx is missing');
  end if;

  -- 7d. RLS on, and exactly the three policies - no DELETE policy.
  if not exists (
    select 1 from pg_class
     where oid = 'public.rep_daily_status'::regclass and relrowsecurity
  ) then
    problems := array_append(problems, 'RLS is not enabled on rep_daily_status');
  end if;

  select count(*) into n from pg_policy
   where polrelid = 'public.rep_daily_status'::regclass and polcmd = 'd';
  if n <> 0 then
    problems := array_append(problems,
      'a DELETE policy exists on rep_daily_status - corrections are upserts');
  end if;

  select pg_get_expr(polqual, polrelid) into def
    from pg_policy
   where polrelid = 'public.rep_daily_status'::regclass
     and polname = 'rep_daily_status_select';
  if def is null
     or position('is_admin' in def) = 0
     or position('supervises' in def) = 0 then
    problems := array_append(problems,
      'rep_daily_status_select is missing its admin/supervises clauses');
  end if;

  select pg_get_expr(polwithcheck, polrelid) into def
    from pg_policy
   where polrelid = 'public.rep_daily_status'::regclass
     and polname = 'rep_daily_status_insert';
  if def is null
     or position('app_today' in def) = 0
     or position('is_admin' in def) = 0
     or position('is_rep' in def) = 0 then
    problems := array_append(problems,
      'rep_daily_status_insert does not enforce rep-self-today or admin');
  end if;

  -- 7e. The stamp trigger.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.rep_daily_status'::regclass
       and t.tgname = 'rep_daily_status_stamp'
       and not t.tgisinternal
       and (t.tgtype & 2) = 2          -- BEFORE
       and (t.tgtype & 4) = 4          -- INSERT
       and (t.tgtype & 16) = 16        -- UPDATE
  ) then
    problems := array_append(problems,
      'rep_daily_status_stamp is missing or is not BEFORE INSERT OR UPDATE');
  end if;

  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'stamp_rep_daily_status';
  if def is null
     or position('auth.uid()' in def) = 0
     or position('now()' in def) = 0 then
    problems := array_append(problems,
      'stamp_rep_daily_status() does not stamp auth.uid() and now()');
  end if;

  -- 7f. The three RPCs exist, are SECURITY INVOKER, and are callable by
  --     authenticated only.
  foreach def in array array[
    'set_my_daily_status(text)',
    'admin_set_rep_daily_status(uuid,date,text)',
    'rep_daily_status_report(date,date,uuid,integer)'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public'
         and p.oid = to_regprocedure('public.' || def)
         and not p.prosecdef
    ) then
      problems := array_append(problems,
        format('%s is missing or is not SECURITY INVOKER', def));
    end if;
    if not has_function_privilege('authenticated', 'public.' || def, 'EXECUTE') then
      problems := array_append(problems,
        format('authenticated cannot execute %s', def));
    end if;
  end loop;

  if has_function_privilege(
    'authenticated', 'public.stamp_rep_daily_status()', 'EXECUTE'
  ) then
    problems := array_append(problems,
      'authenticated can call stamp_rep_daily_status() directly');
  end if;

  -- 7g. Table grants: authenticated may read/write, never delete.
  if not has_table_privilege('authenticated', 'public.rep_daily_status', 'SELECT')
     or not has_table_privilege('authenticated', 'public.rep_daily_status', 'INSERT')
     or not has_table_privilege('authenticated', 'public.rep_daily_status', 'UPDATE') then
    problems := array_append(problems,
      'authenticated lost SELECT/INSERT/UPDATE on rep_daily_status');
  end if;
  if has_table_privilege('authenticated', 'public.rep_daily_status', 'DELETE') then
    problems := array_append(problems,
      'authenticated can DELETE from rep_daily_status - there is no delete path');
  end if;
  if has_table_privilege('anon', 'public.rep_daily_status', 'SELECT') then
    problems := array_append(problems,
      'anon can read rep_daily_status');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0069 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0069 applied: rep_daily_status has one row per rep per Asia/Kolkata day, '
    'three statuses, a BEFORE stamp from auth.uid()/now(), self-today-or-admin '
    'writes, self/admin/supervises reads and no delete path. '
    'set_my_daily_status, admin_set_rep_daily_status and '
    'rep_daily_status_report are live and SECURITY INVOKER.';
end $$;

commit;


-- =============================================================================
-- Afterwards
--
--   -- as a rep's session: today twice, last status wins, still one row
--   select set_my_daily_status('in_field');
--   select set_my_daily_status('in_office');
--   select * from public.rep_daily_status where rep_id = auth.uid();
--
--   -- a past date is refused for a rep, allowed for an admin
--   select set_my_daily_status('in_field');                       -- (no date arg)
--   select admin_set_rep_daily_status('<rep id>', public.app_today() - 1, 'on_leave');
--
--   -- the screen's read, defaulting to this month
--   select rep_daily_status_report();
-- =============================================================================
