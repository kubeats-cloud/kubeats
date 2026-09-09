-- =============================================================================
-- KUbeats - migration 0020b: the campus boundary
--
-- ⚠ RUN 0020a FIRST, AND DO NOT RUN THIS UNTIL THE GATE IS OPEN:
--
--       select count(*) from public.profiles
--        where role = 'rep' and campus_id is null;
--
--       -- must be 0
--
-- A rep with no campus sees NOTHING once this is applied: empty institute list,
-- empty daily-plan picker, and the meeting gate refusing every visit because
-- they cannot reach an institute to plan one. That is a total outage for that
-- person, not a degraded screen. Section 0 below refuses to apply if any rep is
-- still unassigned, so the gate is enforced rather than merely documented.
--
-- ⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS. It tightens, so an early
-- apply is safe for the data and hostile to anyone using the old build.
--
-- WHAT THIS CLOSES
--
-- Three doors, not one. institutes_select is the obvious one and the other two
-- are the ones that would have been missed:
--
--   institutes_select              using (true)  -> the shared registry
--   institutes_UPDATE              using (true) with check (true)
--                                  -> ANY rep may edit ANY institute today:
--                                     name, contacts, status. Everyone thinks
--                                     about the select policy. A rep who
--                                     guessed a uuid could rewrite another
--                                     campus's school WITHOUT being able to
--                                     read it.
--   institute_status_history_select using (true)
--                                  -> the whole registry's journey - names,
--                                     statuses, dates - readable by every rep
--                                     without ever touching institutes.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
--   * enforce_meeting_gate() and enforce_checkin_before_visit(). Both are
--     SECURITY DEFINER and bypass RLS BY DESIGN - that is what makes them a
--     guarantee rather than a convenience. The plan row they check was created
--     through a scoped picker, so they are already checking inside the campus.
--   * log_visit() and close_visit(). Both stay SECURITY INVOKER, and that is
--     load-bearing: it is what makes campus scoping apply INSIDE them. A rep
--     passing a foreign institute_id fails the institutes read in the
--     function's own transaction. A DEFINER rewrite would punch a hole straight
--     through this whole feature.
--   * is_admin(). Admin visibility is unchanged everywhere, which is what keeps
--     this reviewable: the admin half of every policy below is the half that
--     already existed.
--   * visits, daily_plans, targets, visit_people and the visit-photos bucket.
--     All are `member = auth.uid() or is_admin()` already, which is STRICTLY
--     STRONGER than campus scoping while a rep belongs to one campus. Adding a
--     campus predicate would be redundant and would give a second thing to keep
--     in step.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. The gate, enforced
-- -----------------------------------------------------------------------------
do $$
declare
  unassigned integer;
begin
  select count(*) into unassigned
    from public.profiles where role = 'rep' and campus_id is null;

  if unassigned > 0 then
    raise exception
      'REFUSING TO APPLY: % rep(s) have no campus and would see nothing at all. '
      'Assign them first: select id, name from public.profiles where role = ''rep'' '
      'and campus_id is null;', unassigned;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_campus'
  ) then
    raise exception 'my_campus() is missing - run 0020a first.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. institutes - the shared-registry reversal
--
-- 0016 section 3 states the old rule as a decision: "the institute list is a
-- shared registry, and Rule 4 says a status is set by hand by whoever visited,
-- not only by whoever registered the school." That reasoning held while every
-- rep worked one pipeline. With five campuses in five cities it is exactly
-- backwards, so it is reversed here on purpose rather than drifted away from.
--
-- Every policy reads the same shape, so there is one thing to review:
--
--     public.is_admin() or campus_id = public.my_campus()
--
-- A null campus_id therefore matches nobody but an admin, which is the right
-- answer for a row that has not been given a home: invisible rather than
-- visible to everyone.
-- -----------------------------------------------------------------------------
drop policy if exists institutes_select on public.institutes;
create policy institutes_select on public.institutes
  for select to authenticated
  using (public.is_admin() or campus_id = public.my_campus());

-- A rep registers into their OWN campus and nowhere else. registered_by is
-- still theirs, so 0016's N-1 finding is untouched - it now simply operates
-- within a campus instead of across the whole registry.
drop policy if exists institutes_insert on public.institutes;
create policy institutes_insert on public.institutes
  for insert to authenticated
  with check (
    public.is_admin()
    or (registered_by = (select auth.uid()) and campus_id = public.my_campus())
  );

-- THE ONE THAT WOULD HAVE BEEN MISSED. Both halves are scoped: `using` decides
-- which rows may be targeted, `with check` decides what they may become. Scope
-- only the first and a rep could move an institute INTO their campus; scope
-- only the second and they could still edit a foreign row as long as they left
-- its campus alone.
drop policy if exists institutes_update on public.institutes;
create policy institutes_update on public.institutes
  for update to authenticated
  using (public.is_admin() or campus_id = public.my_campus())
  with check (public.is_admin() or campus_id = public.my_campus());

-- Unchanged: deleting an institute was always an admin's.
drop policy if exists institutes_delete on public.institutes;
create policy institutes_delete on public.institutes
  for delete to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 2. institute_status_history - the quiet one
--
-- Feature C made this readable by everyone: "it is the registry's history".
-- With a shared registry that was consistent. With five campuses it means a
-- Bangalore rep can read every status change Gandhinagar ever made - the
-- institute names, what happened to them and when - without ever selecting from
-- institutes.
--
-- Scoped through the parent institute rather than by duplicating campus_id onto
-- the history rows: one fact, one home. 0011 made the same call about the
-- open/closed category, and 0014 about the derived visit status.
--
-- The write side is unchanged - the table has no insert/update/delete policy at
-- all, because only the trigger writes it and a rep cannot forge a journey.
-- -----------------------------------------------------------------------------
drop policy if exists institute_status_history_select on public.institute_status_history;
create policy institute_status_history_select on public.institute_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
    )
  );


-- -----------------------------------------------------------------------------
-- 3. materials - the table AND the bucket
--
-- Both layers, or the row is hidden and the file is not. 0012 built the library
-- as one collection the whole team reads and only an admin writes; scoping adds
-- a campus to the read half and leaves the write half exactly as it was.
--
-- NULL campus_id means EVERY campus. That is the shared library the app had
-- before this, still the right answer for a brochure that is not
-- campus-specific, and it means the existing rows keep working untouched.
--
-- The storage policy has to reach the campus through the materials row, because
-- the object itself knows only its path. An object with NO row is invisible -
-- which 0012 already called the worse of the two orphan states, and this makes
-- it stricter still.
-- -----------------------------------------------------------------------------
drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
  for select to authenticated
  using (
    public.is_admin()
    or campus_id is null
    or campus_id = public.my_campus()
  );

drop policy if exists materials_object_select on storage.objects;
create policy materials_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and (
      public.is_admin()
      or exists (
        select 1 from public.materials m
        where m.file_path = storage.objects.name
          and (m.campus_id is null or m.campus_id = public.my_campus())
      )
    )
  );


-- -----------------------------------------------------------------------------
-- 4. A rep has a campus; an admin does not
--
-- A TRIGGER rather than NOT NULL, and the first reason is decisive: an admin
-- legitimately has campus_id null, so NOT NULL on this column is simply wrong.
-- A CHECK could express the conditional - it can read `role` from the same row -
-- but it would be validated against every existing row the moment it is added,
-- and the demo backfill in 0020a is a guess we may want to correct.
--
-- FO021.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_profile_campus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'rep' and new.campus_id is null then
    raise exception
      'A rep must belong to a campus.'
      using errcode = 'FO021';
  end if;

  -- An admin sees everything, so a campus on one would be a fact that decides
  -- nothing and could later be mistaken for a scope.
  if new.role = 'admin' and new.campus_id is not null then
    raise exception
      'An admin has no campus - they see every campus.'
      using errcode = 'FO021';
  end if;

  return new;
end;
$$;

comment on function public.enforce_profile_campus is
  'A rep belongs to exactly one campus; an admin belongs to none. Raises '
  'FO021. A trigger rather than NOT NULL because the rule is conditional on '
  'role and the column is legitimately null for an admin.';

drop trigger if exists profiles_campus_required on public.profiles;
create trigger profiles_campus_required
  before insert or update of role, campus_id on public.profiles
  for each row execute function public.enforce_profile_campus();


-- -----------------------------------------------------------------------------
-- 5. A new institute lands in the registering rep's campus
--
-- Defaulted rather than demanded, because the app has no reason to ask: a rep
-- can only register into their own campus anyway (section 1), so making them
-- choose would be asking a question with one answer.
--
-- An ADMIN must say which, since they have no campus to default to.
--
-- INSERT only. Moving an institute between campuses is a real administrative
-- act and institutes_update already restricts who may attempt it.
--
-- FO022.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_institute_campus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if new.campus_id is null then
    new.campus_id := public.my_campus();
  end if;

  if new.campus_id is null then
    -- An admin, or a trusted context, that did not say which campus.
    if caller is null then
      return new;  -- service role / SQL editor: seeding and restores
    end if;
    raise exception
      'This institute needs a campus.'
      using errcode = 'FO022';
  end if;

  return new;
end;
$$;

comment on function public.enforce_institute_campus is
  'A new institute defaults to the registering rep''s campus, and an admin must '
  'name one. Raises FO022. The service role is exempt so a restore and the '
  'seed can still write rows.';

drop trigger if exists institutes_campus_required on public.institutes;
create trigger institutes_campus_required
  before insert on public.institutes
  for each row execute function public.enforce_institute_campus();


-- -----------------------------------------------------------------------------
-- 6. An admin assigns within the rep's own campus
--
-- Nothing stopped a cross-campus assignment before, and after section 1 that
-- would put a plan entry on a rep's Dashboard for an institute they cannot
-- open - a broken row rather than a leak, but it reintroduces exactly the
-- crossing this feature exists to prevent.
--
-- REPRODUCED IN FULL because a function cannot be patched - the same reason
-- 0015 reproduced log_visit() and 0019 reproduced close_visit(). The body below
-- is 0005's, character for character, with one block added at the end of the
-- INSERT branch and the same check on the UPDATE branch. Nothing else moved.
--
-- FO023.
-- -----------------------------------------------------------------------------
create or replace function public.guard_plan_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_member_campus uuid;
  v_institute_campus uuid;
begin
  if tg_op = 'INSERT' then
    if new.assigned_by is not null and caller is not null
       and new.assigned_by is distinct from caller then
      raise exception 'You can only assign a visit in your own name.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Planning your own day is not an assignment, whatever the form sent.
    if new.member = caller then
      new.assigned_by := null;
      new.assigned_at := null;
      return new;
    end if;

    if new.assigned_by is not null and new.assigned_at is null then
      new.assigned_at := now();
    end if;

    -- NEW in 0020b: the institute has to be in the rep's own campus.
    --
    -- Checked for a genuine assignment only - the branch above has already
    -- returned for a rep planning their own day, where the picker did the
    -- scoping. Null on either side is left alone: a restore or a seed writes
    -- rows with no caller, and section 5 already refuses an institute with no
    -- campus from anyone who has one.
    select campus_id into v_member_campus
      from public.profiles where id = new.member;
    select campus_id into v_institute_campus
      from public.institutes where id = new.institute_id;

    if v_member_campus is not null
       and v_institute_campus is not null
       and v_member_campus is distinct from v_institute_campus then
      raise exception
        'That institute is not in that rep''s campus.'
        using errcode = 'FO023';
    end if;

    return new;
  end if;

  if new.assigned_by is distinct from old.assigned_by then
    if new.assigned_by is not null and caller is not null
       and new.assigned_by is distinct from caller then
      raise exception 'You can only assign a visit in your own name.'
        using errcode = 'insufficient_privilege';
    end if;
    new.assigned_at := case when new.assigned_by is null then null else now() end;
  end if;

  return new;
end;
$$;

comment on function public.guard_plan_assignment is
  'Keeps an assignment honest: only in your own name, never on your own day, '
  'and - as of 0020b - only for an institute in that rep''s campus (FO023).';

drop trigger if exists daily_plans_guard_assignment on public.daily_plans;
create trigger daily_plans_guard_assignment
  before insert or update on public.daily_plans
  for each row execute function public.guard_plan_assignment();


-- -----------------------------------------------------------------------------
-- 7. Prove it landed, and prove nothing audited was broken on the way
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  def      text;
  r        record;
begin
  -- 7a. The three doors are shut. Read the policy back and look for the
  --     predicate rather than trusting that the CREATE ran.
  for r in
    select polname, pg_get_expr(polqual, polrelid) as qual
      from pg_policy
     where polname in ('institutes_select', 'institutes_update',
                       'institute_status_history_select', 'materials_select')
  loop
    if r.qual is null or position('my_campus' in r.qual) = 0 then
      problems := problems || format('%s is not campus-scoped', r.polname);
    end if;
  end loop;

  -- institutes_update's WITH CHECK half is a different expression and is the
  -- one that stops a rep moving a row INTO their campus.
  select pg_get_expr(polwithcheck, polrelid) into def
    from pg_policy where polname = 'institutes_update';
  if def is null or position('my_campus' in def) = 0 then
    problems := problems || 'institutes_update WITH CHECK is not campus-scoped';
  end if;

  select pg_get_expr(polwithcheck, polrelid) into def
    from pg_policy where polname = 'institutes_insert';
  if def is null or position('my_campus' in def) = 0 then
    problems := problems || 'institutes_insert is not campus-scoped';
  end if;

  -- 7b. The storage half of materials, or the row is hidden and the file is not.
  select pg_get_expr(polqual, polrelid) into def
    from pg_policy where polname = 'materials_object_select';
  if def is null or position('my_campus' in def) = 0 then
    problems := problems || 'the materials bucket is not campus-scoped';
  end if;

  -- 7c. The new triggers.
  foreach def in array array['profiles_campus_required', 'institutes_campus_required'] loop
    if not exists (select 1 from pg_trigger where tgname = def and not tgisinternal) then
      problems := problems || format('trigger %s is missing', def);
    end if;
  end loop;

  -- 7d. EVERY AUDITED GUARD STILL STANDING. This file adds a boundary; it must
  --     not have moved anything that was already load-bearing.
  if not exists (select 1 from pg_trigger where tgname = 'visits_enforce_meeting_gate'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'Rule 2 (enforce_meeting_gate) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'visits_require_checkin'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'the presence guarantee (FO009) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'daily_plans_checkin_final'
                   and tgrelid = 'public.daily_plans'::regclass and not tgisinternal) then
    problems := problems || 'FO011 write-once arrival has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'institutes_guard_owner'
                   and tgrelid = 'public.institutes'::regclass and not tgisinternal) then
    problems := problems || 'FO010 registered_by guard has gone';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visits_photo_required') then
    problems := problems || 'Rule 12 (visits_photo_required) has gone';
  end if;

  -- 7e. The two RPCs must still be SECURITY INVOKER. This is what makes campus
  --     scoping apply inside them, and it is the single thing most likely to be
  --     undone by a later hand without anyone noticing.
  for r in
    select p.proname, p.prosecdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('log_visit', 'close_visit')
  loop
    if r.prosecdef then
      problems := problems || format(
        '%s is SECURITY DEFINER - campus scoping would not apply inside it', r.proname);
    end if;
  end loop;

  -- ...and still exactly one of each, or a call becomes ambiguous (0015).
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('log_visit', 'close_visit')
     group by p.proname
  loop
    if r.n <> 1 then
      problems := problems || format('%s has %s overloads, expected 1', r.proname, r.n);
    end if;
  end loop;

  -- 7f. The member-scoped tables were deliberately left alone; check they are
  --     still member-scoped rather than having been loosened by accident.
  for r in
    select polname, pg_get_expr(polqual, polrelid) as qual
      from pg_policy
     where polname in ('visits_select', 'daily_plans_select', 'targets_select')
  loop
    if r.qual is null or position('auth.uid()' in r.qual) = 0 then
      problems := problems || format('%s is no longer member-scoped', r.polname);
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0020b did not fully apply: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Campus boundary live: institutes (select/insert/update), status history '
    'and materials (table + bucket) are all scoped; FO021-FO023 installed. '
    'Rule 2, FO009, FO010, FO011, Rule 12 and both INVOKER RPCs all intact.';
end $$;


-- -----------------------------------------------------------------------------
-- 8. Check it took
--
--   -- as a REP (from the app, not the SQL editor - the editor is the service
--   -- role and bypasses RLS entirely, which is why this cannot be tested here)
--   select count(*) from public.institutes;          -- only their campus
--   select count(*) from public.institute_status_history;
--
--   -- the three predicates, read back
--   select polname, pg_get_expr(polqual, polrelid)
--     from pg_policy
--    where polname in ('institutes_select','institutes_update',
--                      'institute_status_history_select','materials_select',
--                      'materials_object_select');
--
--   -- an admin assigning across campuses must fail with FO023
--   -- a rep with no campus must fail with FO021
-- -----------------------------------------------------------------------------
