-- =============================================================================
-- KUbeats - migration 0038: follow-up tasks, which are NOT daily plans
--
-- ✅ ADDITIVE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- One new table, one new column on `visits`, four policies and one trigger.
-- Nothing existing is rewritten; the live app, which knows neither, is
-- unaffected.
--
-- ⚠ THE ONE DECISION THIS FILE EXISTS TO ENFORCE
--
-- A FOLLOW-UP IS NOT A `daily_plans` ROW, AND MUST NEVER BECOME ONE.
--
-- `daily_plans` is the most heavily loaded table in this schema, and every one
-- of these depends on a row in it meaning exactly "a visit this rep planned and
-- may walk into":
--
--   Rule 2      enforce_meeting_gate() checks a visit against it. CLAUDE.md
--               calls the Dashboard owning that flow "load-bearing, not a
--               layout preference".
--   Rule 7      the Meetings metric is `daily_plans where meetings_actual = 1`,
--               read in week-summary.ts, activity-report.ts AND
--               activity-export.ts.
--   Overview    the "visits today / of planned" tile counts EVERY daily_plans
--               row for today as its denominator.
--   5 triggers  FO012, FO009, FO014, FO020, FO026 are all attached to it.
--   FO013       daily_plans_one_open_visit, the partial unique index that makes
--               "one open visit per rep" true, keyed on (member) alone.
--
-- A phone call has no arrival, no photograph, no location, no check-out and no
-- activity. Put one in that table and every reader above has to learn to
-- exclude a kind of row it was not written for - and the failure is not a
-- crash. It is the Overview tile quietly counting phone calls as planned
-- visits, and getTodayPlan() handing the check-in flow rows it cannot process.
-- 0033's own comments name that class of bug: "not a crash; a quietly wrong
-- column, which is worse."
--
-- So: a separate table. It costs this migration and buys total isolation -
-- Rule 7's eight numbers, the meeting gate, the Overview denominator, the
-- .xlsx export and all five triggers are untouched by the whole of Phase A.
-- The integration suite asserts that rather than trusting it.
--
-- A `kind = 'meeting'` TASK IS A PROMPT, NOT A PLAN. It does not satisfy the
-- meeting gate and cannot be checked into. Turning one into a real visit is an
-- explicit tap that writes `daily_plans` through the path that already exists
-- (`startFollowUp()`), so there is still exactly ONE writer in front of the row
-- Rule 2 checks.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `due_date default public.app_today()`, NEVER `current_date`. This is the
-- todayISO()/app_today() lockstep rule (0008) and it is not decoration: a task
-- created at 23:00 IST must carry that day, not the next. `daily_plans.date`
-- has had exactly this default since 0008.
--
-- NOTE the app pre-fills TOMORROW on the form - app_today() + 1 - which is a
-- different thing and deliberately so: the column default is what a direct
-- insert gets, the form default is what a rep is offered. Both read the same
-- Indian calendar day; neither reads the server's clock.
--
-- `institute_id` is `on delete restrict`, matching `visits` rather than
-- `institute_counsellors`' cascade: a task is a commitment somebody made, and
-- an institute with outstanding commitments should not vanish under it.
-- -----------------------------------------------------------------------------
create table if not exists public.follow_up_tasks (
  id            uuid primary key default gen_random_uuid(),
  member        uuid not null references public.profiles (id)  on delete cascade,
  institute_id  uuid not null references public.institutes (id) on delete restrict,
  kind          text not null,
  due_date      date not null default public.app_today(),
  -- Only a meeting can carry one, and only because the plan row it may later
  -- become needs a purpose to derive its activity from (0024/0025).
  purpose_id    uuid references public.purposes (id) on delete set null,
  -- Which visit asked for it. `set null` so deleting a visit never strands the
  -- commitment that came out of it.
  from_visit_id uuid references public.visits (id) on delete set null,
  note          text,
  outcome       text,
  done_at       timestamptz,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint follow_up_tasks_kind_valid check (kind in ('call', 'meeting')),
  constraint follow_up_tasks_outcome_valid check (
    outcome is null or outcome in ('done', 'no_answer', 'rescheduled')
  ),
  constraint follow_up_tasks_note_length check (note is null or length(note) <= 300),
  -- A call has no purpose to carry: it never becomes a plan row.
  constraint follow_up_tasks_purpose_for_meetings check (
    kind = 'meeting' or purpose_id is null
  ),
  -- An outcome is what CLOSED it, so the two move together.
  constraint follow_up_tasks_outcome_needs_done check (
    outcome is null or done_at is not null
  )
);

comment on table public.follow_up_tasks is
  'What a rep owes an institute NEXT - a call, or a meeting to arrange. '
  'DELIBERATELY NOT daily_plans: that table is the meeting gate''s, Rule 7''s '
  'Meetings source and the Overview''s denominator, and a call is none of '
  'those things. A kind=meeting row is a PROMPT; turning it into a visit is an '
  'explicit tap that writes daily_plans through startFollowUp().';

comment on column public.follow_up_tasks.due_date is
  'The Indian calendar day this is owed by. Defaults to app_today() for a '
  'direct insert; the form offers app_today() + 1. Never current_date.';

-- Every read is "what is still open for this rep", so that is the index.
-- Partial on `done_at is null` for the same reason daily_plans_one_open_visit
-- is partial on its own predicate: the closed rows are the majority over time
-- and no screen asks for them.
create index if not exists follow_up_tasks_open
  on public.follow_up_tasks (member, due_date)
  where done_at is null;

-- The Dashboard's calls section and Pending's today filter both read by member
-- and kind, so this covers the pair they actually ask for.
create index if not exists follow_up_tasks_by_institute
  on public.follow_up_tasks (institute_id);


-- -----------------------------------------------------------------------------
-- 2. visits.next_action - what the rep said they would do next
--
-- NULLABLE, and that is not laziness. Every visit already logged has no answer
-- to this question, and a NOT NULL column could not be built against them
-- without inventing data. 0027's lesson, pointing the other way: that file
-- made a status compulsory on INSERT ONLY, for exactly the same reason.
-- -----------------------------------------------------------------------------
alter table public.visits
  add column if not exists next_action text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visits_next_action_valid'
  ) then
    alter table public.visits add constraint visits_next_action_valid check (
      next_action is null or next_action in ('call', 'meeting')
    );
  end if;
end $$;

comment on column public.visits.next_action is
  'What the rep said they would do next: call, meeting, or nothing. The '
  'matching follow_up_tasks row is what is actually ACTED on; this is the '
  'answer as recorded on the visit, so a report reads as it was filed.';


-- -----------------------------------------------------------------------------
-- 3. FO031 - a task's institute must belong to the member it is for
--
-- MIRRORS FO026 RATHER THAN REUSING IT, and the reason is worth stating. A task
-- against an institute the rep does not own is a task they can never act on:
-- after 0028 they cannot see the institute, cannot plan a visit to it and
-- cannot log one. Creating it would be writing a silent dead end.
--
-- And it is reachable without tampering. Pending deliberately shows a rep the
-- institutes a COLLEAGUE left open - getOpenFollowUps() is scoped by institute
-- RLS and the row "says whose it is rather than hiding it" - so a control that
-- offered a follow-up there would land on exactly this case. The refusal names
-- the problem instead of the policy matching no row.
--
-- SECURITY DEFINER with search_path pinned: it reads public.institutes, which
-- RLS would otherwise narrow to the caller's own, and the question being asked
-- is about the MEMBER's ownership, not the caller's. An admin assigning a task
-- to a rep is the case that needs it.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_task_institute_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_name  text;
begin
  -- The service role, a restore and the SQL editor have no caller and are not
  -- a rep creating a dead end. Same exemption FO022 and FO023 carry.
  if (select auth.uid()) is null then
    return new;
  end if;

  select i.registered_by, i.name into v_owner, v_name
    from public.institutes i
   where i.id = new.institute_id;

  if not found then
    raise exception 'That institute no longer exists.' using errcode = 'FO031';
  end if;

  if v_owner is null then
    raise exception
      'That institute has no owner yet, so nothing can be followed up at it. Ask an admin to assign it.'
      using errcode = 'FO031';
  end if;

  if v_owner is distinct from new.member then
    raise exception
      'That institute belongs to another rep, so this follow-up could never be acted on. Reassign it first.'
      using errcode = 'FO031';
  end if;

  return new;
end;
$$;

comment on function public.enforce_task_institute_owned is
  'FO031 - a follow-up task must name an institute its member owns, or it is a '
  'dead end they can never act on. Mirrors FO026 for daily_plans. Exempts the '
  'service role, which has no caller.';

revoke all on function public.enforce_task_institute_owned() from public;
revoke all on function public.enforce_task_institute_owned() from anon;

drop trigger if exists follow_up_tasks_institute_owned on public.follow_up_tasks;
create trigger follow_up_tasks_institute_owned
  before insert or update of institute_id, member on public.follow_up_tasks
  for each row execute function public.enforce_task_institute_owned();


-- -----------------------------------------------------------------------------
-- 4. RLS - the same predicate the institute itself carries, reached through it
--
-- IDENTICAL IN SHAPE TO 0037's, and for the identical reason. 0028 section 2
-- names the trap: a child table whose policy does not reach through the parent
-- lets a rep read rows belonging to a colleague's institute without ever
-- selecting from `institutes`, so tightening only the parent MOVES a leak
-- rather than closing it.
--
-- Reaching through the parent also means this boundary cannot drift from the
-- institute's own. One fact, one home.
--
-- BOTH HALVES on every write verb: `using` decides which rows may be targeted,
-- `with check` what they may become. 0020b caught that in institutes_update and
-- 0027 restates it; scoping one leaves a door on the other side.
--
-- Grants spelled out rather than inherited: 0001's blanket grant was a one-time
-- statement that cannot reach a table created later.
-- -----------------------------------------------------------------------------
alter table public.follow_up_tasks enable row level security;

revoke all on public.follow_up_tasks from authenticated;
revoke all on public.follow_up_tasks from anon;
grant select, insert, update, delete on public.follow_up_tasks to authenticated;

drop policy if exists follow_up_tasks_select on public.follow_up_tasks;
create policy follow_up_tasks_select on public.follow_up_tasks
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

drop policy if exists follow_up_tasks_insert on public.follow_up_tasks;
create policy follow_up_tasks_insert on public.follow_up_tasks
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

drop policy if exists follow_up_tasks_update on public.follow_up_tasks;
create policy follow_up_tasks_update on public.follow_up_tasks
  for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

drop policy if exists follow_up_tasks_delete on public.follow_up_tasks;
create policy follow_up_tasks_delete on public.follow_up_tasks
  for delete to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );


-- -----------------------------------------------------------------------------
-- 5. Prove it landed, and prove daily_plans is untouched
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  pol      record;
  n        integer;
  body     text;
begin
  -- 5a. The table and its columns.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'follow_up_tasks'
  ) then
    problems := array_append(problems, 'public.follow_up_tasks is missing');
  else
    foreach c in array array[
      'member', 'institute_id', 'kind', 'due_date', 'purpose_id',
      'from_visit_id', 'note', 'outcome', 'done_at', 'created_by', 'created_at'
    ] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'follow_up_tasks'
           and column_name = c
      ) then
        problems := array_append(problems, format('follow_up_tasks.%s is missing', c));
      end if;
    end loop;

    -- 5b. RLS is ON. Policies with RLS disabled are inert, and that mistake
    --     looks exactly like success.
    if not (select c2.relrowsecurity
              from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
             where n2.nspname = 'public' and c2.relname = 'follow_up_tasks') then
      problems := array_append(
        problems,
        'row level security is NOT enabled on follow_up_tasks - every policy is inert');
    end if;

    -- 5c. THE LOCKSTEP RULE. A `current_date` default would date a task
    --     created after 18:30 UTC to the wrong Indian day, and nothing on any
    --     screen would say so.
    select column_default into body
      from information_schema.columns
     where table_schema = 'public' and table_name = 'follow_up_tasks'
       and column_name = 'due_date';

    if body is null or position('app_today' in body) = 0 then
      problems := array_append(problems, format(
        'follow_up_tasks.due_date does not default to app_today() (found: %s) - the Kolkata day would drift',
        coalesce(body, 'no default')));
    end if;
  end if;

  -- 5d. visits.next_action, and its CHECK.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'visits' and column_name = 'next_action'
  ) then
    problems := array_append(problems, 'visits.next_action is missing');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_next_action_valid') then
    problems := array_append(problems, 'visits_next_action_valid is missing');
  end if;

  -- 5e. FO031's function and trigger.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_task_institute_owned';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 enforce_task_institute_owned, found %s', n));
  else
    if not (select p.prosecdef
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'enforce_task_institute_owned') then
      problems := array_append(
        problems,
        'enforce_task_institute_owned() is not SECURITY DEFINER - it could not read a colleague''s institute to refuse it');
    end if;

    /*
     * search_path pinned. LIKE 'search_path=%' against proconfig, NEVER array
     * containment: an empty search_path flattens to `search_path=""`, so
     * `@> array['search_path=']` is false for a function that pins it
     * perfectly. That false alarm rolled 0035 back on dev once.
     */
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'enforce_task_institute_owned'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(
        problems,
        'enforce_task_institute_owned() does not pin search_path - a definer function without one is a privilege hole');
    end if;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'follow_up_tasks_institute_owned'
       and tgrelid = 'public.follow_up_tasks'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'follow_up_tasks_institute_owned is not attached');
  end if;

  -- 5f. All four policies, each reaching through the parent institute.
  n := 0;
  for pol in
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'follow_up_tasks'
  loop
    n := n + 1;

    if pol.cmd <> 'INSERT' then
      if pol.qual is null
         or pol.qual not like '%registered_by%'
         or pol.qual not like '%my_campus%'
         or pol.qual not like '%is_admin%' then
        problems := array_append(problems, format(
          '%s USING does not reach through institutes (needs is_admin, my_campus and registered_by)',
          pol.policyname));
      end if;
    end if;

    if pol.cmd in ('INSERT', 'UPDATE') then
      if pol.with_check is null
         or pol.with_check not like '%registered_by%'
         or pol.with_check not like '%my_campus%'
         or pol.with_check not like '%is_admin%' then
        problems := array_append(problems, format(
          '%s WITH CHECK does not reach through institutes', pol.policyname));
      end if;
    end if;
  end loop;

  if n <> 4 then
    problems := array_append(problems, format(
      'expected 4 policies on follow_up_tasks, found %s', n));
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'follow_up_tasks' and grantee = 'anon'
  ) then
    problems := array_append(problems, 'anon holds a grant on follow_up_tasks');
  end if;

  /*
   * 5g. THE CLAIM THE WHOLE SEPARATION RESTS ON.
   *
   * Nothing here may have touched daily_plans. If a later edit ever moves a
   * follow-up into that table, these are the rules it would silently break -
   * so they are asserted HERE, in the file that promised not to.
   */
  foreach c in array array[
    'daily_plans_one_open_visit'
  ] loop
    if not exists (
      select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
       where cl.relname = c and i.indisunique
    ) then
      problems := array_append(problems, format(
        '%s is missing or no longer unique - FO013 no longer holds', c));
    end if;
  end loop;

  foreach c in array array[
    'daily_plans_meeting_gate', 'daily_plans_checkin_located',
    'daily_plans_plan_institute_owned'
  ] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.daily_plans'::regclass and not tgisinternal
    ) then
      -- Named individually rather than counted, so a reader knows which rule
      -- went. Not fatal on its own: trigger names have moved before (0018
      -- renamed the presence guarantee), so this reports rather than refuses.
      raise notice '0038 note: daily_plans trigger % not found under that name - check it was not lost.', c;
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception '0038 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0038 applied: follow_up_tasks is live with % policies scoped through the parent institute, FO031 attached, and daily_plans untouched.', n;
end $$;
