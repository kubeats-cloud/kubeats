-- =============================================================================
-- 0028 - Rep-owned institutes
--
-- An institute belongs to the rep who registered it, and no other rep sees it -
-- not even one on the same campus. Campus (0020b) stays the outer guardrail;
-- ownership is a second, tighter boundary drawn inside it. A rep must satisfy
-- BOTH. An admin satisfies neither and sees everything, as always.
--
-- Plan: docs/rep-owned-institutes-plan.md, all six decisions locked (its §14).
-- Read alongside 0020b, which this narrows, and 0016, whose FO010 changes
-- meaning here rather than changing behaviour.
--
-- WHY THIS IS SMALL. Every institute read in the app says `from("institutes")`
-- with no explicit filter and lets the policy decide - the registry, the detail
-- page, both pickers, Pending, the report's institute block, the batched name
-- lookup. Narrow the policy and all of them narrow in the same request, with no
-- chance of a caller being forgotten. What is NOT small is where the
-- consequences land, which is the rest of this file.
--
-- NO COLUMN IS ADDED, DROPPED OR BACK-FILLED. `registered_by` has been on
-- `institutes` since 0001 and every institute the app has ever created sets it
-- explicitly (`institute-actions.ts`), with `default auth.uid()` behind that.
-- There is nothing to fill in, and nothing here rewrites an owner: an owner is
-- set at registration, or by an admin through the reassign card, and nowhere
-- else. Section 7's assertion COUNTS the institutes with no owner rather than
-- assuming there are none.
--
-- DEPLOY COUPLING: none, in the sense that matters - the app reads whatever RLS
-- returns and has no hard-coded expectation of seeing a colleague's institutes,
-- so applying this before or after the deploy leaves no screen broken. What it
-- does produce is a VISIBLE behaviour change for every rep the moment it lands,
-- so it should go out with the announcement rather than quietly ahead of it.
-- The one part worth warning an admin about first is section 4: an assignment
-- that worked yesterday can be refused today. That is the rule working.
--
-- The direction of failure is deliberate. This policy NARROWS, so a row with a
-- wrong owner becomes invisible to a rep rather than visible to the wrong one.
-- "I cannot see my own work" is loud and gets reported; "I can see someone
-- else's" is silent and does not.
--
-- New error codes: FO025 (a reassignment that may not happen) and FO026 (a plan
-- row whose institute is not the planner's). FO023 keeps its code and widens
-- its rule.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The institute policies - all four, restated together
--
-- All four, including the two that do not change, so the file stands on its own
-- against a fresh restore and so a reader sees the whole door rather than the
-- hinge someone happened to touch last.
--
-- The predicate a rep must satisfy is now a conjunction:
--
--     campus_id = public.my_campus() and registered_by = (select auth.uid())
--
-- STRICT AND, decided knowingly (plan D-A). `registered_by` normally implies
-- the campus, because a rep can only register into their own - the two drift
-- exactly once, when an admin moves an institute to another campus or moves a
-- REP to another campus without changing the owner. The client's rule stacks on
-- campus, so a rep transferred to another campus stops seeing the institutes
-- they registered in the old one. That is what a campus boundary is FOR, and
-- the consequence is accepted: transferring a rep orphans their pipeline until
-- an admin reassigns it. The admin registry's owner column and "Unassigned"
-- badge, already deployed, are what make that visible rather than mysterious.
--
-- A null `registered_by` matches no rep, exactly as a null `campus_id` already
-- matched nobody but an admin. Same answer, same reason: a row that has fallen
-- out of circulation is invisible rather than visible to everyone. Section 7
-- counts those rows so the state is known at apply time.
-- -----------------------------------------------------------------------------
drop policy if exists institutes_select on public.institutes;
create policy institutes_select on public.institutes
  for select to authenticated
  using (
    public.is_admin()
    or (
      campus_id = public.my_campus()
      and registered_by = (select auth.uid())
    )
  );

-- UNCHANGED, and worth saying so rather than leaving a reader to check.
--
-- 0020b wrote this to stop a rep registering into another campus. It happens to
-- be exactly the ownership rule as well: a rep registers IN THEIR OWN NAME, so
-- every institute they create is already theirs and already passes the narrowed
-- select above. There was nothing to tighten.
drop policy if exists institutes_insert on public.institutes;
create policy institutes_insert on public.institutes
  for insert to authenticated
  with check (
    public.is_admin()
    or (registered_by = (select auth.uid()) and campus_id = public.my_campus())
  );

-- BOTH HALVES, again. 0020b caught this the first time and the reasoning has
-- not changed, only the predicate: `using` decides which rows may be targeted,
-- `with check` decides what they may become. Scope only the first and a rep
-- could move an institute INTO their own name; scope only the second and they
-- could edit a foreign row as long as they left the owner alone.
--
-- The `with check` half is therefore also the second lock on FO010's door - a
-- rep cannot hand an institute to somebody else, which the trigger in section 3
-- already refuses. Two locks on one door is how the rest of this schema is
-- built, and it is what makes dropping either survivable.
drop policy if exists institutes_update on public.institutes;
create policy institutes_update on public.institutes
  for update to authenticated
  using (
    public.is_admin()
    or (
      campus_id = public.my_campus()
      and registered_by = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    or (
      campus_id = public.my_campus()
      and registered_by = (select auth.uid())
    )
  );

-- Unchanged: deleting an institute was always an admin's, and `on delete
-- restrict` from `visits` still refuses one that has history.
drop policy if exists institutes_delete on public.institutes;
create policy institutes_delete on public.institutes
  for delete to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 2. institute_status_history - the quiet one, a second time
--
-- 0020b called it that, and the same trap is here one boundary in. The policy
-- scopes through the parent institute, so tightening only `institutes_select`
-- would MOVE the leak rather than close it: a rep would go on reading the full
-- status journey of every colleague's institute on their campus - the ids, what
-- happened to them and when - without ever selecting from `institutes`.
--
-- Same predicate as the institute itself now uses, reached through the parent
-- rather than by duplicating `registered_by` onto the history rows. One fact,
-- one home - 0011's call about the open/closed category and 0014's about the
-- derived visit status, again.
--
-- The write side stays exactly as it was: the table has no insert, update or
-- delete policy at all, because only the trigger writes it and a rep cannot
-- forge a journey.
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
        and i.registered_by = (select auth.uid())
    )
  );


-- -----------------------------------------------------------------------------
-- 3. FO010 stops being bookkeeping, and gains FO025
--
-- 0016 added this because the audit's N-1 finding was that any rep could
-- rewrite `registered_by`. Its comment still calls the column "administrative
-- bookkeeping that an admin can legitimately fix after a person leaves the
-- team". After this migration that sentence is wrong in a way that matters:
-- THE COLUMN DECIDES WHO CAN SEE THE ROW, so changing it grants and revokes
-- access. It is a security control now, and the comment below says so, because
-- the next reader would otherwise treat it as a tidy-up.
--
-- What does NOT need unlocking: an admin could already reassign. The function
-- refuses a change only when `caller is not null and not is_admin()`, so an
-- admin, the service role and the SQL editor were always free to. What needs
-- ADDING is the constraint on where it may move TO.
--
-- Reproduced in full - a plpgsql function cannot be patched - with two new
-- refusals, both FO025:
--
--   (a) THE NEW OWNER MUST BE ON THE INSTITUTE'S CAMPUS. Without this an admin
--       could hand a Gandhinagar school to a Bangalore rep. The rep's predicate
--       needs both conjuncts, so that rep still could not see it: the institute
--       would simply vanish into a state only an admin can reach. A silent
--       no-op is worse than a refusal.
--
--   (b) NOT WHILE THE CURRENT OWNER IS STANDING IN IT. This is the one that
--       closes the stuck case in (plan §5), and it needs no tampering to reach:
--       rep A is checked in at institute X, mid-visit; an admin reassigns X to
--       rep B; A can no longer see X, so log_visit()'s `update institutes`
--       matches no row and raises FO006 - and A cannot check in anywhere else,
--       because FO013 allows one open visit. A is stuck until the overnight
--       sweep and the visit is lost.
--
--       The alternatives are worse. Letting log_visit() bypass RLS would punch
--       a hole straight through the boundary this migration exists to draw, and
--       auto-closing A's check-in throws away a real visit that really
--       happened. Refusing costs an admin a few hours and a clear sentence.
--
-- Null on either side of (a) is left alone, following FO023's precedent: a
-- restore or a seed writes rows with no caller, and an admin has no campus of
-- their own to compare against.
-- -----------------------------------------------------------------------------
create or replace function public.guard_institute_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Null for the service-role key and the SQL editor, i.e. trusted contexts.
  -- Never null for a signed-in user; the anon role holds no grant here.
  caller uuid := (select auth.uid());
  v_new_owner_campus uuid;
  v_open_visits integer;
begin
  if new.registered_by is distinct from old.registered_by then

    if caller is not null and not public.is_admin() then
      raise exception
        'Who registered an institute cannot be changed.'
        using errcode = 'FO010';
    end if;

    -- (a) The new owner has to be able to see what they are given.
    if new.registered_by is not null and new.campus_id is not null then
      select campus_id into v_new_owner_campus
        from public.profiles where id = new.registered_by;

      if v_new_owner_campus is not null
         and v_new_owner_campus is distinct from new.campus_id then
        raise exception
          'That rep is not on this institute''s campus.'
          using errcode = 'FO025';
      end if;
    end if;

    -- (b) The current owner must not be standing in it.
    --
    -- Exactly the condition FO013's partial index uses for "one open visit":
    -- arrived, not checked out, and not swept. `checkout_missing` matters -
    -- a plan the nightly sweep has already closed is finished business and
    -- must not hold a reassignment hostage for ever.
    if old.registered_by is not null then
      select count(*) into v_open_visits
        from public.daily_plans dp
       where dp.member = old.registered_by
         and dp.institute_id = old.id
         and dp.checkin_at is not null
         and dp.checkout_at is null
         and dp.checkout_missing = false;

      if v_open_visits > 0 then
        raise exception
          'That rep is at this institute now - reassign it when they have finished.'
          using errcode = 'FO025';
      end if;
    end if;

  end if;

  return new;
end;
$$;

comment on function public.guard_institute_owner is
  'A SECURITY CONTROL, not bookkeeping: institutes.registered_by decides who '
  'can see the row, so changing it grants and revokes access. Immutable for a '
  'rep (FO010). An admin, the service role and the SQL editor may reassign, '
  'but only to a rep on the institute''s own campus, and never while the '
  'current owner holds an open check-in there (both FO025).';

-- Recreated so the trigger definitely covers the columns the new checks read.
-- `before update of registered_by` fires on a statement that MENTIONS the
-- column, which is what the reassign card sends; the function then tests the
-- value itself, so an UPDATE that lists it without changing it still costs
-- nothing.
drop trigger if exists institutes_guard_owner on public.institutes;

create trigger institutes_guard_owner
  before update of registered_by on public.institutes
  for each row
  execute function public.guard_institute_owner();


-- -----------------------------------------------------------------------------
-- 4. FO023 widens from campus to ownership
--
-- The second thing that would have been missed. An admin can assign a visit to
-- a rep, and 0020b's check was that the institute is in THAT REP'S CAMPUS.
-- One boundary in, that is no longer sufficient: an institute on B's campus but
-- owned by A, assigned to B, puts an entry on B's Dashboard for an institute B
-- cannot open - precisely the broken row 0020b added the check to prevent.
--
-- So the test becomes ownership, WHICH IMPLIES THE CAMPUS (a rep registers only
-- into their own, and section 3 refuses a reassignment that would break it).
-- Same code, same trigger, wider rule.
--
-- REFUSE RATHER THAN REASSIGN (plan D-C). Assigning a visit is scheduling;
-- moving ownership is a permissions change. Silently reassigning here would not
-- move one visit - it would move the institute's whole pipeline, its history,
-- its status and its row in the other rep's Pending, from a dropdown the admin
-- thinks is about Tuesday. The message names the remedy instead, because the
-- remedy is two taps away on the institute's own page.
--
-- The admin's assign picker has already been narrowed to the chosen rep's
-- institutes (deployed ahead of this migration), so in the app this refusal is
-- unreachable. It is the control; the picker is the courtesy.
--
-- Reproduced in full, including the parts that do not change.
-- -----------------------------------------------------------------------------
create or replace function public.guard_plan_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_institute_owner uuid;
begin
  if tg_op = 'INSERT' then
    if new.assigned_by is not null and caller is not null
       and new.assigned_by is distinct from caller then
      raise exception 'You can only assign a visit in your own name.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Planning your own day is not an assignment, whatever the form sent.
    --
    -- This still returns early, and that is still correct - but the reason has
    -- changed. 0020b's comment said "the picker did the scoping", and trusting
    -- the picker is exactly the gap section 5 closes. The ownership test that
    -- used to live only here now lives in its own trigger, which fires for BOTH
    -- paths, so nothing is skipped by returning.
    if new.member = caller then
      new.assigned_by := null;
      new.assigned_at := null;
      return new;
    end if;

    if new.assigned_by is not null and new.assigned_at is null then
      new.assigned_at := now();
    end if;

    -- WIDENED in 0028: the institute has to BELONG to the rep, not merely sit
    -- in their campus. Null owner is not exempt - an institute nobody owns is
    -- out of circulation, and scheduling a visit to it would put an entry on a
    -- Dashboard for a school the rep cannot open.
    select registered_by into v_institute_owner
      from public.institutes where id = new.institute_id;

    if v_institute_owner is distinct from new.member then
      raise exception
        'That institute belongs to another rep. Reassign it to this rep first, then assign the visit.'
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
  'An assignment is made in the assigner''s own name, and only to an institute '
  'the assigned rep OWNS - widened from 0020b''s campus test, because owning '
  'implies the campus. Raises FO023. A rep planning their own day returns '
  'early; enforce_plan_institute_owned (FO026) covers that path.';


-- -----------------------------------------------------------------------------
-- 5. FO026 - a plan row's institute must be the planner's
--
-- CLOSING A GAP THAT ALREADY EXISTS. `daily_plans_insert` is
-- `with check (member = (select auth.uid()))` and has no institute test at all,
-- and guard_plan_assignment returns early for a rep planning their own day.
-- So the PICKER has been the only thing standing between a rep and an institute
-- id they should not have. That was a modest gap while the boundary was a whole
-- campus; with a per-rep boundary the set they should not touch is far larger.
--
-- What happens today if someone posts a foreign institute id: the plan row
-- inserts, the check-in succeeds, log_visit() inserts the visit (the FK to
-- `institutes` bypasses RLS, as every referential check does), and only then
-- does log_visit()'s `update public.institutes set status = ...` match no row
-- and raise FO006, rolling the transaction back. So logging is ACCIDENTALLY
-- blocked, and only because 0027 made a status compulsory - with a null status
-- the update is skipped and the visit would persist. An accident is not a
-- control.
--
-- And the check-in is not blocked at all, which is the part that bites: a rep
-- can burn their one open-visit slot (FO013) on an institute they cannot see,
-- then be unable to finish it or check in anywhere else. A self-inflicted
-- denial of service through a tampered form - small, but real.
--
-- TWO MOMENTS, ONE PREDICATE:
--
--   PLAN   - INSERT, and any UPDATE that moves institute_id.
--   ARRIVE - the UPDATE that stamps checkin_at, which catches a row that was
--            fine when it was planned and is not now.
--
-- A TRIGGER RATHER THAN AN RLS PREDICATE, because a policy cannot produce a
-- sentence: a rep who hits this deserves to be told the institute is not theirs
-- rather than to watch a write silently affect zero rows.
--
-- `registered_by = new.member` serves both a rep planning their own day and an
-- admin assigning to a rep, because section 4 already guarantees it before an
-- assigned row can exist.
--
-- AN ORPHANED INSTITUTE IS REFUSED by the same predicate, and that is correct:
-- nothing should be planned against an institute that has fallen out of
-- circulation until an admin has assigned it to somebody.
--
-- THE ESCAPE HATCH SURVIVES AND IS LOAD-BEARING. A dead plan row - planned
-- legitimately, then reassigned away, not yet checked in - is still removable:
-- `removeFromDailyPlan` is member-scoped, filters on `checkin_at is null` and
-- touches no institute, so it does not go through the arrive branch below and
-- cannot be refused by it. A rep is never left holding something they cannot
-- clear.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_plan_institute_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_checking_in boolean;
begin
  -- On UPDATE, only the two moments matter. A plan row being edited in any
  -- other way - checked out, swept, given a note - is left alone, so a
  -- reassignment can never trap a visit that is already under way.
  if tg_op = 'UPDATE' then
    v_checking_in := old.checkin_at is null and new.checkin_at is not null;

    if new.institute_id is not distinct from old.institute_id
       and not v_checking_in then
      return new;
    end if;
  end if;

  select registered_by into v_owner
    from public.institutes where id = new.institute_id;

  if v_owner is distinct from new.member then
    raise exception
      'That institute is not yours. Ask an admin to assign it to you first.'
      using errcode = 'FO026';
  end if;

  return new;
end;
$$;

comment on function public.enforce_plan_institute_owned is
  'A daily_plans row may only name an institute the plan''s own member owns - '
  'checked when it is planned and again when the arrival is stamped, so a row '
  'that was valid when planned cannot be walked into after a reassignment. '
  'Raises FO026. SECURITY DEFINER so it can read institutes.registered_by for '
  'a rep who, by construction, cannot select the row.';

drop trigger if exists daily_plans_institute_owned on public.daily_plans;

create trigger daily_plans_institute_owned
  before insert or update of institute_id, checkin_at on public.daily_plans
  for each row
  execute function public.enforce_plan_institute_owned();


-- -----------------------------------------------------------------------------
-- 6. Names for a reassigned institute's own history
--
-- THE PROBLEM. Move institute X from rep A to rep B. A's past visits at X are
-- still A's - `visits` is member-scoped and nothing about those rows changes.
-- But every screen that shows a visit resolves the institute's NAME through
-- `institutes` under the caller's own RLS. A can no longer read X, so the
-- lookup misses and A's own history goes anonymous, with a scoping warning
-- logged on every render.
--
-- Nothing leaks, so it is coherent; a rep's own past work going nameless is
-- poor. And the real cost is the LOG NOISE: without this, one reassignment
-- turns every one of that rep's historical rows into a warning on every render,
-- and an error log that cries wolf is worse than no log at all.
--
-- WHY NOT JUST WIDEN institutes_select TO "INSTITUTES I HAVE VISITED". Because
-- RLS gives one SELECT for all purposes: that would put the institute back in
-- the picker, back in the registry and back in Pending - defeating the whole
-- feature to fix a label.
--
-- So: a SECURITY DEFINER function returning NAMES ONLY, for institutes the
-- caller already provably holds a visit against. It grants no listing, no
-- filtering, no detail and no way to discover an id - the caller must already
-- have the id, and must already have been there. Surgical is the point.
--
-- An admin gets the same answer through the same function; they can read every
-- institute anyway, so there is nothing here they could not already select.
-- A null caller - the service role, the SQL editor - gets nothing rather than
-- everything, which is the safe direction for a definer function and costs
-- those callers nothing, since they bypass RLS to begin with.
-- -----------------------------------------------------------------------------
create or replace function public.institute_names_i_visited(p_ids uuid[])
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.name
    from public.institutes i
   where i.id = any(p_ids)
     and (select auth.uid()) is not null
     and (
       public.is_admin()
       or exists (
         select 1 from public.visits v
          where v.institute_id = i.id
            and v.member = (select auth.uid())
       )
     );
$$;

comment on function public.institute_names_i_visited is
  'Institute NAMES ONLY, for ids the caller already holds a visit against. '
  'Exists so a rep''s own history keeps its institute names after the '
  'institute has been reassigned away from them. Grants no listing, no '
  'filtering and no detail - the caller must already have the id and must '
  'already have been there.';

revoke all on function public.institute_names_i_visited(uuid[]) from public;
revoke all on function public.institute_names_i_visited(uuid[]) from anon;
grant execute on function public.institute_names_i_visited(uuid[]) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Assertions
--
-- Two jobs, and the second is the one that matters most. The first is that what
-- this file installed is actually there. The second is that CAMPUS ISOLATION
-- HAS NOT REGRESSED: this migration rewrites three of 0020b's policies and two
-- of its guards' neighbours, and the failure mode of getting that wrong is
-- silent - a boundary that is merely gone, with nothing on any screen to say
-- so. The audited guards on `visits` are checked for the same reason: they are
-- untouched here, and this is the cheapest place to prove it.
--
-- The null-owner NOTICE is the third job. It reports rather than fixes,
-- because nothing in this plan rewrites an owner; an admin resolves it from the
-- registry's "Unassigned" badge, which is already deployed.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  name text;
  orphans integer;
begin
  -- 1. All four institute policies exist, including the two this file restates
  --    without changing. A restore that lost one would otherwise be silent.
  for name in select unnest(array[
    'institutes_select', 'institutes_insert',
    'institutes_update', 'institutes_delete'
  ])
  loop
    if not exists (
      select 1 from pg_policy
       where polname = name and polrelid = 'public.institutes'::regclass
    ) then
      problems := problems || format('%s is missing', name);
    end if;
  end loop;

  -- 2. The read side is owner-scoped, and BOTH HALVES of the update side are.
  --    The WITH CHECK half is a separate expression and is the one that gets
  --    forgotten - 0020b caught exactly that, one boundary out.
  if coalesce((
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'institutes_select' and polrelid = 'public.institutes'::regclass
  ), '') not like '%registered_by%' then
    problems := problems || 'institutes_select is not owner-scoped';
  end if;

  if coalesce((
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'institutes_update' and polrelid = 'public.institutes'::regclass
  ), '') not like '%registered_by%' then
    problems := problems || 'institutes_update USING is not owner-scoped';
  end if;

  if coalesce((
    select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polname = 'institutes_update' and polrelid = 'public.institutes'::regclass
  ), '') not like '%registered_by%' then
    problems := problems || 'institutes_update WITH CHECK is not owner-scoped';
  end if;

  -- 3. The history policy narrowed with it, or the leak has merely moved.
  if coalesce((
    select pg_get_expr(polqual, polrelid) from pg_policy
     where polname = 'institute_status_history_select'
       and polrelid = 'public.institute_status_history'::regclass
  ), '') not like '%registered_by%' then
    problems := problems || 'institute_status_history_select is not owner-scoped';
  end if;

  -- 4. This file's own triggers are attached, and FO023's is still there. The
  --    function was replaced above and a replace cannot detach a trigger, but
  --    this is the cheapest possible proof the widened rule is reachable.
  for name in select unnest(array[
    'institutes_guard_owner'          -- FO010 + FO025
  ])
  loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.institutes'::regclass
         and tgname = name and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', name);
    end if;
  end loop;

  for name in select unnest(array[
    'daily_plans_institute_owned',    -- FO026
    'daily_plans_guard_assignment'    -- FO023, widened
  ])
  loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.daily_plans'::regclass
         and tgname = name and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', name);
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'institute_names_i_visited'
  ) then
    problems := problems || 'institute_names_i_visited is missing';
  end if;

  -- 5. CAMPUS ISOLATION HAS NOT REGRESSED. This is the assertion that matters
  --    most: the file rewrites three of 0020b's policies, and the failure mode
  --    of getting that wrong is a boundary that is simply gone, with nothing on
  --    any screen to say so.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'my_campus'
  ) then
    problems := problems || 'my_campus() has gone - campus scoping is not there';
  end if;

  for name in select unnest(array[
    'institutes_select', 'institutes_update',
    'institute_status_history_select', 'materials_select'
  ])
  loop
    if coalesce((
      select pg_get_expr(polqual, polrelid) from pg_policy where polname = name
    ), '') not like '%my_campus%' then
      problems := problems || format('%s is no longer campus-scoped', name);
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'profiles_campus_required' and not tgisinternal
  ) then
    problems := problems || 'the profiles_campus_required trigger has gone (FO021)';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.institutes'::regclass
       and tgname = 'institutes_campus_required' and not tgisinternal
  ) then
    problems := problems || 'the institutes_campus_required trigger has gone (FO022)';
  end if;

  -- 6. The audited neighbours on visits. Untouched here, and this is the
  --    cheapest place to prove it - 0027 asserts the same four for the same
  --    reason, plus its own.
  for name in select unnest(array[
    'visits_enforce_meeting_gate',   -- Rule 2
    'visits_require_checkin',        -- the presence guarantee, FO009
    'visits_follow_up_when_open',    -- Rule 5, FO016
    'visits_photo_final',            -- Rule 12's write-once, FO008
    'visits_status_required'         -- FO024
  ])
  loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.visits'::regclass
         and tgname = name and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', name);
    end if;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception '0028 did not leave the schema as intended: %',
      array_to_string(problems, '; ');
  end if;

  -- 7. Report, do not fix. An institute with no owner is now invisible to every
  --    rep at once, with no error and nothing on a rep's screen to say what
  --    happened - the pipeline does not break, it silently empties. Knowing the
  --    count at apply time is the difference between a state an admin resolves
  --    from the registry and one discovered weeks later. Nothing in this plan
  --    rewrites an owner, so this counts and says so.
  select count(*) into orphans
    from public.institutes where registered_by is null;

  if orphans > 0 then
    raise notice
      '0028: % institute(s) have no owner and are invisible to every rep. They '
      'show as "Unassigned" on the admin registry; reassign each from its own '
      'page.', orphans;
  else
    raise notice '0028: every institute has an owner.';
  end if;

  raise notice
    '0028 applied: institutes are rep-owned inside the campus boundary.';
end $$;


-- =============================================================================
-- Afterwards
--
-- What this does NOT do, deliberately:
--
--   * It does not change `registered_by`'s foreign key. It is still
--     `on delete set null`, so deleting a departed rep's profile still orphans
--     every institute they registered rather than refusing the deletion. That
--     was decided knowingly (plan D-B): `on delete restrict` converts a quiet
--     problem into a loud one at the wrong moment - an admin removing a
--     departed rep is doing routine housekeeping and should not be blocked by
--     it. The "Unassigned" badge is what makes the state visible instead, which
--     is why it is red rather than a dash.
--
--   * It does not back-fill or rewrite a single owner. See the header.
--
--   * It does not touch `visits_*` or `daily_plans_*` SELECT policies. They are
--     already `member = auth.uid() or is_admin()` - a rep's own work was never
--     visible to another rep, and this migration does not narrow it further.
--     Note the asymmetry that produces on Pending, and that it is correct: a
--     rep sees an open institute only if they own it, and the visit rows
--     underneath it only if they made them.
--
--   * It does not touch `institute_statuses`. That is a vocabulary, read by
--     everyone, and has nothing to do with who owns a school.
--
-- One consequence worth stating plainly, because nothing on a REP's screen
-- surfaces it: an orphaned institute drops out of every rep's Pending even
-- though its status is still open. Work can go quiet with nobody told. That is
-- what "orphaned until reassigned" means, and it is why the count above is a
-- NOTICE rather than a silence.
--
-- Housekeeping - institutes nobody can see, at any time:
--
--   select i.id, i.name, c.name as campus
--     from public.institutes i
--     left join public.campuses c on c.id = i.campus_id
--    where i.registered_by is null
--       or i.campus_id is null
--    order by c.name nulls first, i.name;
--
-- And owners who no longer match their institute's campus, which section 3
-- refuses to create but a campus move can still produce:
--
--   select i.name, c.name as institute_campus, p.name as owner
--     from public.institutes i
--     join public.profiles p on p.id = i.registered_by
--     left join public.campuses c on c.id = i.campus_id
--    where p.campus_id is distinct from i.campus_id;
-- =============================================================================
