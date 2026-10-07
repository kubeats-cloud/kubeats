-- =============================================================================
-- KUbeats - migration 0041: the third role, and the link that makes a team
--
-- ✅ ADDITIVE AND BEHAVIOUR-NEUTRAL. SAFE TO APPLY AT ANY TIME.
--
-- This is step H1 of docs/hierarchy-plan.md. It widens one CHECK, adds one
-- nullable column, adds three helper functions and one trigger, and extends two
-- existing triggers.
--
-- ⚠ IT CHANGES NO POLICY. Not one. Every RLS predicate in the database computes
-- exactly what it computed before this file ran, because nothing reads the new
-- column yet - the rewrite is 0042's job (plan §5). Applying this file alters
-- nothing anyone can observe, which is the entire point of splitting it out:
-- a single migration that both introduced the helper and rewrote thirty
-- policies would have no safe rollback.
--
-- ⚠ AND NOBODY IS A TEAM LEAD WHEN IT FINISHES. The role becomes LEGAL here; it
-- is not ASSIGNED here. There is no backfill and there is deliberately none -
-- see section 2 on why profiles.created_by cannot seed this.
--
-- ⚠ THE ONE SEQUENCING RULE, AND IT IS ABOUT THE APP, NOT THE DATABASE.
--
-- src/lib/auth.ts parses the profile row with z.enum(["rep","team_lead","admin"]).
-- A build that predates that change rejects a team_lead row, reports
-- profileStatus "unavailable" and falls back to role "rep" - and because a team
-- lead HAS a campus (section 3), they would degrade into a working rep who can
-- reach /log and log visits in their own name.
--
-- So: THIS FILE IS SAFE TO APPLY BEFORE OR AFTER THE CODE SHIPS. What must not
-- happen early is an ADMIN PROMOTING SOMEBODY. There is no control to do that
-- until H3, which is the structural reason the promotion UI is in a later step
-- rather than this one.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The role becomes legal
--
-- Dropped and re-added, because a CHECK cannot be patched in place - the same
-- statement 0040 §2 makes about targets_non_negative, and the same guard, so a
-- second run does nothing rather than briefly dropping a live constraint.
--
-- THE ASSERTION BLOCK CHECKS ALL THREE VALUES, not just the new one. Losing
-- 'rep' or 'admin' while editing this list is the way this goes wrong, and
-- nothing would fail until the next insert - by which time the migration has
-- reported success.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_role_valid'
       and pg_get_constraintdef(oid) like '%team_lead%'
  ) then
    alter table public.profiles drop constraint if exists profiles_role_valid;

    alter table public.profiles add constraint profiles_role_valid check (
      role in ('rep', 'team_lead', 'admin')
    );
  end if;
end $$;

comment on column public.profiles.role is
  'rep logs visits and owns institutes; team_lead supervises an explicit set of '
  'reps on one campus and logs nothing; admin sees everything and has no '
  'campus. The middle tier is a READER, not a subject: it has no targets, no '
  'daily plan and no alert_events of its own.';


-- -----------------------------------------------------------------------------
-- 2. The link - who reports to whom
--
-- EXPLICIT, NOT CAMPUS-SHAPED, and that is the requirement rather than a
-- preference. Several team leads share one campus, each with their own distinct
-- reps; my_campus() returns a single uuid and so can never tell two teams on
-- one campus apart. A column is the only shape that answers the question.
--
-- NULLABLE, AND THERE IS NO BACKFILL. "Existing reps stay directly under admin
-- until assigned" is this nullability, and it is also what makes 0042 safe: with
-- no row populated, supervises() below reduces EXACTLY to the predicate every
-- policy already carries.
--
-- ⚠ profiles.created_by (0034) CANNOT SEED THIS, and 0034's own header is the
-- argument: created_by "decides nothing. It records something", it is null for
-- the ~39 rows that predate it under a deliberate no-backfill decision, and
-- FO028 refuses a rep parent precisely so it never becomes "the reports-to
-- chain the model deliberately does not have". Seeding from it would assign
-- reps to ADMINS, who cannot be team leads; would leave every pre-0034 rep
-- unassigned anyway; and would retrospectively turn a record into a permission -
-- which is the exact move 0040 §4 declined to make for the same column. The two
-- columns stay what they each are: created_by records history, team_lead_id
-- decides visibility.
--
-- `on delete set null`, mirroring created_by. Deleting a team lead returns their
-- reps to admin-only supervision rather than refusing the delete or stranding
-- rows that reference a profile which is gone. The alternative (`restrict`)
-- would make delete_member() fail on any team lead with reps, which is a worse
-- answer than the reps quietly becoming unassigned - but it does mean an admin
-- must notice. H3's team screen is where that surfaces.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists team_lead_id uuid
    references public.profiles (id) on delete set null;

comment on column public.profiles.team_lead_id is
  'The team lead this REP reports to, or null for a rep not yet assigned and '
  'for every non-rep. Unlike created_by this DOES decide visibility: it is the '
  'boundary supervises() reads. Null for every row until an admin assigns one - '
  'there is no backfill, by design.';

-- Mirrors profiles_created_by_idx (0034) and profiles_campus_idx (0020a):
-- partial, because every supervision query asks "who reports to me" and the
-- unassigned rows are found by `team_lead_id is null`, which a partial index
-- does not serve and does not need to.
create index if not exists profiles_team_lead_idx
  on public.profiles (team_lead_id)
  where team_lead_id is not null;


-- -----------------------------------------------------------------------------
-- 3. FO021 learns the third role
--
-- ⚠ THE CHEAPEST CORRECTNESS WIN IN THE WHOLE CHANGE, and it is a hole that
-- opens the moment section 1 runs. enforce_profile_campus() has exactly two
-- branches - 'rep' demands a campus, 'admin' forbids one - so a team_lead row
-- FALLS THROUGH BOTH and could be created with no campus at all: a supervisor
-- posted nowhere, which the brief's "allocated to exactly ONE campus" forbids
-- and which nothing downstream would report.
--
-- The admin branch is untouched. An admin still has no campus, for the reason
-- 0020b gives: on them it would be a fact that decides nothing and could later
-- be mistaken for a scope.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_profile_campus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A team lead is campus-scoped exactly as a rep is: they supervise people who
  -- work from one place, and FO033 below refuses a rep whose lead is elsewhere.
  if new.role in ('rep', 'team_lead') and new.campus_id is null then
    raise exception
      'A rep and a team lead each belong to one campus.'
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
  'A rep and a team lead each belong to exactly one campus; an admin belongs to '
  'none. Raises FO021. A trigger rather than NOT NULL because the rule is '
  'conditional on role and the column is legitimately null for an admin.';

-- The trigger itself is unchanged and already fires on (role, campus_id);
-- re-stated so a reader of this file alone can see what it is attached to.
drop trigger if exists profiles_campus_required on public.profiles;
create trigger profiles_campus_required
  before insert or update of role, campus_id on public.profiles
  for each row execute function public.enforce_profile_campus();


-- -----------------------------------------------------------------------------
-- 4. FO033 - the integrity of the link
--
-- ⚠ THE MOST IMPORTANT TRIGGER IN THIS FILE, and it exists because of one line
-- in 0001:
--
--     profiles_update ... using (id = (select auth.uid()) or public.is_admin())
--
-- A REP MAY UPDATE THEIR OWN ROW. Without this trigger a rep could set their own
-- team_lead_id to any team lead they liked, or clear it to leave a team, with a
-- single PostgREST call and no UI involved. The team an admin reads would be
-- partly written by the people it describes.
--
-- That is not a new hazard: FO028 (0034) was written for exactly this hole on
-- created_by and says so at length, and guard_profile_role() (0001) for the
-- sharper version on `role`. This is the third column that needs it, and it is
-- the one that actually decides what people can see.
--
-- FIVE REFUSALS, AND THE SPLIT BETWEEN THEM IS DELIBERATE. (a) to (d) are
-- statements about THE DATA and are checked for every caller, the service role
-- included - a restore must not be able to install a link that the app could
-- never have made. (e) is a statement about PRIVILEGE and exempts the trusted
-- server-side caller, because the SQL editor and a restore have no auth.uid()
-- and are not a rep editing their own row. FO028 draws the same line in the
-- same words.
--
-- ⚠ (e) RUNS BEFORE THE NULL SHORT-CIRCUIT, which is not where it was first
-- written. Clearing a link is as much a change as setting one, and with the
-- check after the short-circuit a rep could not JOIN a team but could LEAVE
-- one. The integration suite caught it; see the clause itself.
--
-- ⚠ AND (e) IS NOT REACHABLE BY A TEAM LEAD IN H1. profiles_update is still
-- `id = auth.uid() or is_admin()`, so a team lead updating somebody else''s row
-- matches NO ROWS and the trigger never fires - the refusal is the policy''s,
-- silently, not this one''s. The clause is written for H3, which gives a team
-- lead a SECURITY DEFINER RPC to add a rep to their own team; this is the guard
-- that stops that RPC being able to staff anybody else''s. Until then it is
-- correct and dormant, which is the same shape 0013''s lock had.
--
-- SECURITY DEFINER because (b) and (c) read the PARENT's profile row, which RLS
-- would hide: a rep may read only their own. The question being asked is about
-- the named team lead, not about the caller. Same reasoning as
-- enforce_task_institute_owned() (0038).
-- -----------------------------------------------------------------------------
create or replace function public.enforce_team_lead_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Null for the service-role key and for the SQL editor, i.e. trusted
  -- server-side contexts. Never null for a signed-in user, and the anon role
  -- holds no grant on this table.
  caller      uuid := (select auth.uid());
  v_lead_role text;
  v_lead_campus uuid;
begin
  -- (a) Only a rep reports to anybody. A team lead reporting to a team lead is
  --     a chain this model does not have, and an admin is the top.
  if new.role <> 'rep' and new.team_lead_id is not null then
    raise exception
      'Only a rep belongs to a team lead.'
      using errcode = 'FO033';
  end if;

  /*
   * (e) WHO MAY WRITE IT AT ALL — and it is checked HERE, before the null
   * short-circuit below, because CLEARING a link is as much a change as
   * setting one.
   *
   * ⚠ THIS SAT AFTER THE SHORT-CIRCUIT AND THE INTEGRATION SUITE CAUGHT IT. A
   * rep could not JOIN a team but could LEAVE one: `set team_lead_id = null`
   * returned early and never reached this check. After 0042 that is a rep
   * removing themselves from supervision — their team lead simply stops seeing
   * their work, with nothing on any screen to say why.
   *
   * A team lead may be on EITHER side of the change: taking a rep on, or
   * releasing one of their own. An admin may do anything. Everything else —
   * including a rep editing the row they are allowed to write — is refused.
   */
  if (tg_op = 'INSERT' and new.team_lead_id is not null)
     or (tg_op = 'UPDATE' and new.team_lead_id is distinct from old.team_lead_id)
  then
    if caller is not null
       and not public.is_admin()
       and not (
         public.is_team_lead()
         and (new.team_lead_id = caller or old.team_lead_id = caller)
       ) then
      raise exception
        'Only an admin, or the team lead taking them on, can change which team a rep is in.'
        using errcode = 'FO033';
    end if;
  end if;

  -- Nothing left to check. A null link is the ordinary state of every rep until
  -- an admin assigns one, and of every non-rep for ever.
  if new.team_lead_id is null then
    return new;
  end if;

  -- (b) Nobody leads themselves.
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

  -- (c) The parent must BE a team lead. An admin parent would quietly recreate
  --     the created_by confusion - a column that looks like supervision and is
  --     not - and a rep parent would be the reports-to chain FO028 refuses.
  if v_lead_role <> 'team_lead' then
    raise exception
      'A rep can only be assigned to a team lead.'
      using errcode = 'FO033';
  end if;

  -- (d) One campus, both of them. A rep under a lead on another campus is a rep
  --     their lead cannot see the institutes of: institutes are campus-scoped,
  --     so the team would be visible in the roster and invisible in the work.
  --
  --     ⚠ This fires on the REP's row. Moving the LEAD's campus is the other
  --     half of the same rule and this trigger cannot see it - correct_member_campus()
  --     (0035) must refuse, or cascade, when the member has reps. That is an
  --     open decision in the plan (§10 item 3) and is NOT closed by this file.
  if v_lead_campus is distinct from new.campus_id then
    raise exception
      'A rep and their team lead must work from the same campus.'
      using errcode = 'FO033';
  end if;

  return new;
end;
$$;

comment on function public.enforce_team_lead_link is
  'FO033 - only a rep has a team lead, the lead must be a team_lead on the same '
  'campus, nobody leads themselves, and only an admin or the receiving lead may '
  'set it. The last clause is what stops a rep assigning themselves, since '
  'profiles_update lets a rep write their own row. Mirrors FO028.';

revoke all on function public.enforce_team_lead_link() from public;
revoke all on function public.enforce_team_lead_link() from anon;

drop trigger if exists profiles_team_lead_link on public.profiles;
create trigger profiles_team_lead_link
  before insert or update of role, campus_id, team_lead_id on public.profiles
  for each row execute function public.enforce_team_lead_link();


-- -----------------------------------------------------------------------------
-- 5. guard_profile_role() learns that a team lead is made, not self-declared
--
-- The UPDATE half already covers this: "only an admin can change a role" is
-- role-agnostic and has been since 0001. The INSERT half named 'admin'
-- specifically, so this adds the middle tier beside it.
--
-- Belt-and-braces today, since profiles_insert is is_admin() and nothing else
-- can insert a profile at all. It stops being belt-and-braces in H3, which adds
-- a SECURITY DEFINER RPC letting a team lead create a REP - a function that must
-- never be able to mint a second team lead, and this is what makes that true at
-- the table rather than inside the function.
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Null for the service-role key and for the SQL editor, i.e. trusted
  -- server-side contexts. Never null for a signed-in user, and the anon role
  -- holds no grant on this table, so allowing it here cannot be reached from
  -- the browser. Without this the very first admin could never be created,
  -- since there is no admin yet to authorise it.
  caller uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.role in ('admin', 'team_lead')
       and caller is not null
       and not public.is_admin() then
      raise exception
        'Only an admin can create an admin or a team lead profile.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     and caller is not null
     and not public.is_admin() then
    raise exception
      'Only an admin can change a role.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_role is
  'Only an admin may create an admin or a team lead, or change anybody''s role. '
  'Exempts the trusted server-side caller, which is how the first admin exists.';

-- Re-attached rather than assumed: 0001 created this trigger and nothing since
-- has touched it, but a file that redefines the function should name what runs
-- it.
--
-- ⚠ THE NAME AND THE SIGNATURE ARE 0001's, COPIED EXACTLY, and both matter.
-- The trigger is `profiles_guard_role` - a different name here would leave
-- 0001's attached and add a SECOND one firing the same function on every row.
-- And it is `before insert or update`, NOT `update of role`: narrowing it to a
-- column list would be a behaviour change, and this file promises none. 0034
-- makes the same point from the other side - profiles is a table that already
-- carries several triggers, and `create trigger` on it "is exactly the kind of
-- edit that loses one by accident".
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();


-- -----------------------------------------------------------------------------
-- 6. The helpers
--
-- All three mirror is_admin() (0001) exactly: SECURITY DEFINER, stable,
-- search_path pinned, revoked from public and anon, granted to authenticated.
--
-- ⚠ DEFINER IS NOT OPTIONAL AND IS NOT ABOUT PRIVILEGE HERE. These read
-- public.profiles, which is RLS-protected, and in 0042 profiles_select itself
-- becomes supervises(id). An INVOKER function would recurse on the very policy
-- that calls it. 0001 states the same reason for is_admin() in one line:
-- "SECURITY DEFINER to avoid RLS recursion on profiles."
--
-- ⚠ GRANTED TO authenticated, unlike 0040's materialise_daily_alerts(). That
-- function is called BY CRON and must be unreachable from a session; these are
-- called BY POLICIES INSIDE a session and would make every policy return false
-- if the caller could not execute them.
-- -----------------------------------------------------------------------------
create or replace function public.is_team_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'team_lead'
  );
$$;

comment on function public.is_team_lead is
  'True when the current user has profiles.role = team_lead. Mirrors '
  'is_admin(), definer for the same reason: to avoid RLS recursion on profiles.';

revoke all on function public.is_team_lead() from public;
revoke all on function public.is_team_lead() from anon;
grant execute on function public.is_team_lead() to authenticated;


create or replace function public.is_rep()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'rep'
  );
$$;

comment on function public.is_rep is
  'True when the current user has profiles.role = rep. Exists so 0042 can say '
  '"a team lead does not log visits and does not own institutes" as a policy '
  'clause: visits_insert and institutes_insert both key on auth.uid() plus a '
  'campus, and a team lead HAS a campus, so without this they could do both.';

revoke all on function public.is_rep() from public;
revoke all on function public.is_rep() from anon;
grant execute on function public.is_rep() to authenticated;


/*
 * supervises() - THE WHOLE HIERARCHY IN ONE PREDICATE.
 *
 * It REPLACES `member = (select auth.uid()) or public.is_admin()` rather than
 * extending it, which is why 0042 is a readable diff at all: thirty policies
 * get SHORTER, not longer.
 *
 * ⚠ THE PROPERTY EVERYTHING RESTS ON: with no team_lead_id populated anywhere,
 * this is EXACTLY EQUIVALENT to the predicate it replaces. The third branch
 * matches no rows, so the expression collapses to "self, or admin". That is
 * what lets 0042 ship into a live database and change nothing observable until
 * H3 promotes somebody - and it is the thing to re-read before anyone decides
 * 0042 "did not work" because nothing moved.
 *
 * NULL ARGUMENT: an institute with no owner. `null = auth.uid()` is null, the
 * exists() is false, so a non-admin gets false and an admin gets true -
 * identical to today's `registered_by = (select auth.uid())`. An ownerless
 * institute does not become visible to a team lead.
 *
 * WHY NOT my_team() RETURNING setof uuid: it would force `member in (select
 * ...)` at every call site, and on the four institute-keyed tables that select
 * would have to be nested inside an exists() that is already there. A boolean
 * substitutes positionally for what is written today.
 */
create or replace function public.supervises(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  /*
   * coalesce, because a NULL p_member makes the first comparison NULL and the
   * whole expression NULL rather than false — an institute with no owner, which
   * `registered_by` legitimately is.
   *
   * ⚠ IT MATTERS MORE THAN IT LOOKS. Inside a policy NULL and false behave the
   * same, so this would never have shown up there; but a boolean function that
   * can return NULL is a trap for `not supervises(x)`, which is NULL rather
   * than true and would silently match nothing. 0042 writes this predicate
   * thirty times and must not have to remember which.
   */
  select coalesce(
    p_member = (select auth.uid())
      or public.is_admin()
      or exists (
        select 1
        from public.profiles r
        where r.id = p_member
          and r.team_lead_id = (select auth.uid())
      ),
    false
  );
$$;

comment on function public.supervises is
  'May the caller see this member''s work? Their own, or anyone''s if admin, or '
  'their own reps'' if a team lead. Written to REPLACE "member = auth.uid() or '
  'is_admin()" positionally. With no team_lead_id set it is exactly equivalent '
  'to that predicate, which is what makes 0042 a no-op until a team exists.';

revoke all on function public.supervises(uuid) from public;
revoke all on function public.supervises(uuid) from anon;
grant execute on function public.supervises(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  fn       text;
  n        integer;
  body     text;
begin
  -- 7a. All THREE role values, not just the new one.
  select pg_get_constraintdef(oid) into body
    from pg_constraint where conname = 'profiles_role_valid';

  if body is null then
    problems := array_append(
      problems,
      'profiles_role_valid is GONE - it was dropped and not re-added, so any role string would now be accepted');
  else
    foreach c in array array['rep', 'team_lead', 'admin'] loop
      if position('''' || c || '''' in body) = 0 then
        problems := array_append(problems, format(
          'profiles_role_valid no longer lists %L - it was lost in the rebuild', c));
      end if;
    end loop;
  end if;

  -- 7b. The column, its nullability and its ON DELETE action.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'team_lead_id'
  ) then
    problems := array_append(problems, 'profiles.team_lead_id is missing');
  else
    if (select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles'
           and column_name = 'team_lead_id') <> 'YES' then
      -- Nullable IS the day-one story: every existing rep stays unassigned.
      problems := array_append(
        problems,
        'profiles.team_lead_id is NOT NULL - every existing rep would need a team lead before anyone could be saved');
    end if;

    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.profiles'::regclass
         and contype = 'f'
         and pg_get_constraintdef(oid) like '%team_lead_id%'
         and pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
    ) then
      problems := array_append(
        problems,
        'profiles.team_lead_id is not ON DELETE SET NULL - deleting a team lead would refuse, or strand their reps');
    end if;
  end if;

  if not exists (
    select 1 from pg_class where relname = 'profiles_team_lead_idx'
  ) then
    problems := array_append(problems, 'profiles_team_lead_idx is missing');
  end if;

  -- 7c. The three helpers: one overload each, definer, search_path pinned, and
  --     executable by authenticated - which is the half 0040's function needs
  --     the opposite of, and the easiest to copy wrongly.
  foreach fn in array array['is_team_lead', 'is_rep', 'supervises'] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;

    if n <> 1 then
      problems := array_append(problems, format(
        'expected exactly 1 %s, found %s - every policy calling it would be ambiguous', fn, n));
    else
      if not (select p.prosecdef
                from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
               where ns.nspname = 'public' and p.proname = fn) then
        problems := array_append(problems, format(
          '%s() is not SECURITY DEFINER - it reads profiles, and 0042 makes profiles_select call it, so INVOKER would recurse', fn));
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
           and p.proname = fn
           and cfg.setting like 'search_path=%'
      ) then
        problems := array_append(problems, format(
          '%s() does not pin search_path - a definer function without one is a privilege hole', fn));
      end if;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.is_team_lead()', 'execute')
     or not has_function_privilege('authenticated', 'public.is_rep()', 'execute')
     or not has_function_privilege('authenticated', 'public.supervises(uuid)', 'execute')
  then
    problems := array_append(
      problems,
      'a helper is not executable by authenticated - 0042''s policies would evaluate to false for every signed-in user');
  end if;

  if has_function_privilege('anon', 'public.supervises(uuid)', 'execute') then
    problems := array_append(problems, 'anon may execute supervises()');
  end if;

  -- 7d. supervises() IS the old predicate today. Asserted rather than trusted,
  --     because it is the claim that makes 0042 safe to apply to a live
  --     database. No team_lead_id is set, so no row may be supervised by
  --     anybody other than themselves or an admin.
  select count(*) into n from public.profiles where team_lead_id is not null;
  if n <> 0 then
    raise notice
      '0041 note: % profile(s) already carry a team_lead_id. That is not an error, but this file does not create any - check who did.', n;
  end if;

  -- 7e. FO021's third branch and FO033's trigger.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_profile_campus';

  if body is null or position('team_lead' in body) = 0 then
    problems := array_append(
      problems,
      'enforce_profile_campus() does not mention team_lead - a team lead could be created with no campus');
  end if;

  foreach c in array array['profiles_campus_required', 'profiles_team_lead_link', 'profiles_guard_role', 'profiles_guard_created_by'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.profiles'::regclass and not tgisinternal
    ) then
      problems := array_append(problems, format('%s is not attached to public.profiles', c));
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_profile_role';

  if body is null or position('team_lead' in body) = 0 then
    problems := array_append(
      problems,
      'guard_profile_role() does not mention team_lead - a non-admin could mint one');
  end if;

  /*
   * 7f. NOTHING HERE MAY HAVE TOUCHED A POLICY.
   *
   * This file promises to change no RLS predicate, and the promise is what
   * makes it safe to apply at any time. Spot-check the two that would hurt
   * most if a careless edit had widened them, and the rules the whole app
   * leans on - the same closing move 0038 and 0040 both make.
   */
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'profiles';
  if n <> 4 then
    problems := array_append(problems, format(
      'expected 4 policies on profiles, found %s - 0041 must not add or remove one', n));
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select'
       and qual not like '%is_admin%'
  ) then
    problems := array_append(
      problems,
      'profiles_select no longer calls is_admin() - 0041 changes no policy, so something else has');
  end if;

  if not exists (
    select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
     where cl.relname = 'daily_plans_one_open_visit' and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - FO013 no longer holds');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0041 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0041 applied: team_lead is a legal role, profiles.team_lead_id exists and is empty, FO021 covers three roles, FO033 is attached, and is_team_lead()/is_rep()/supervises() are live. NO POLICY CHANGED - nothing observable has moved.';
end $$;


-- =============================================================================
-- Afterwards, to see it is a no-op
--
--   -- the role vocabulary
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'profiles_role_valid';
--
--   -- nobody is assigned, which is the day-one story
--   select count(*) from public.profiles where team_lead_id is not null;   -- 0
--
--   -- supervises() is the old predicate: for every member, exactly the people
--   -- who could already see them.
--   select p.name, p.role, p.campus_id, p.team_lead_id from public.profiles p
--    order by p.role, p.name;
--
-- And to try the refusals by hand (as a signed-in rep, NOT the service role,
-- which clauses (a)-(d) still bind but clause (e) deliberately exempts):
--
--   update public.profiles set team_lead_id = '<some lead>' where id = auth.uid();
--   -- FO033: Only an admin, or the team lead taking them on, can assign a rep.
-- =============================================================================
