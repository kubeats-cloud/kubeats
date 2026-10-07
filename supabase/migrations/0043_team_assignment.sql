-- =============================================================================
-- KUbeats - migration 0043: staffing a team
--
-- ✅ ADDITIVE. SAFE TO APPLY AT ANY TIME. No table, no column, no policy.
--
-- Step H3 of docs/hierarchy-plan.md. Two functions:
--
--   assign_rep_to_team()   an admin divides reps among team leads; a team lead
--                          takes a rep onto THEIR OWN team and releases one.
--   correct_member_campus() learns the middle tier, and closes the trap the
--                          plan flagged (§10 item 3) rather than leaving it.
--
-- ⚠ WHY AN RPC AND NOT A WIDER POLICY. `profiles_update` is still
-- `id = auth.uid() or is_admin()` — 0042 deliberately left it alone, because
-- widening it would hand a team lead EVERY column on their reps' rows, `role`
-- included, with guard_profile_role the only thing then standing in front. One
-- function that writes one column is the smaller door, and FO033 clause (e)
-- already exists to guard exactly it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. assign_rep_to_team()
--
-- SECURITY DEFINER because it writes a row the caller's own policy will not let
-- them reach: a team lead updating another profile matches NO ROWS under
-- profiles_update, silently. search_path pinned, and the authorisation test is
-- the FIRST thing in the body — the house rule for a boundary-crossing RPC.
--
-- ⚠ DEFINER DOES NOT HIDE THE CALLER. `auth.uid()` reads a request setting, not
-- the function owner, so FO033 (enforce_team_lead_link) still sees the real
-- caller and re-checks every one of its five refusals inside this write. That
-- is deliberate belt and braces: this function's own guard and the trigger's
-- clause (e) ask the same question, so a mistake in one is caught by the other.
--
-- RELEASING IS PASSING NULL. A lead may take a rep on and let one go, and FO033
-- (e) permits both because it tests either side of the change. An admin may do
-- anything. A rep reaches neither — they cannot execute this at all.
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
  -- (1) WHO IS ASKING. First, as the house rule requires.
  --
  -- A team lead may only ever name THEMSELVES or nobody as the destination.
  -- Whether the rep was already somebody else's is a second question, asked
  -- below once their current team is known.
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

  /*
   * ⚠ A LEAD MAY ONLY MOVE A REP BETWEEN "NO TEAM" AND THEIR OWN.
   *
   * THIS CHECK WAS MISSING AND THE INTEGRATION SUITE CAUGHT IT. The guard above
   * only asks where the rep is GOING; this asks where they are COMING FROM, and
   * without it a lead could take a colleague's rep straight off their team —
   * same campus, destination themselves, both earlier checks satisfied. That is
   * a cross-team WRITE, the one thing H2 exists to prevent, through the one
   * function that bypasses the policy which would otherwise stop it.
   *
   * Poaching is an ADMIN'S act, deliberately: moving somebody between two teams
   * is a decision about both of them, and only one of the two leads would ever
   * know it had happened.
   */
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

    -- Said here as well as in FO033, because this is the layer the app reads
    -- and "a rep and their team lead must work from the same campus" is a
    -- sentence an admin can act on.
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
-- 2. correct_member_campus() learns the middle tier — and the trap it opens
--
-- ⚠ THE PLAN FLAGGED THIS AS AN OPEN DECISION (§10 item 3) AND THIS CLOSES IT.
--
-- FO033 keeps a rep and their lead on ONE campus, and it fires on the REP'S
-- row. Moving the LEAD'S campus is the other half of the same rule and no
-- trigger on profiles can see it: the lead's own UPDATE touches only their own
-- row, which satisfies every check on it, and their whole team is left pointing
-- at a lead who now works somewhere else. Nothing would refuse it, nothing
-- would report it, and the team would be visible in the roster and invisible in
-- the work - institutes are campus-scoped.
--
-- So it is refused HERE, in the one function that moves a campus, with a
-- sentence that says what to do about it. The alternative - cascading the whole
-- team - was rejected: moving six people's campus as a side effect of
-- correcting one person's is a bigger act than the admin asked for, and
-- `retag` already makes "did they move, or was it wrong?" a question this
-- function answers one person at a time.
--
-- WHAT IS NEWLY ALLOWED: a team lead's campus may now be corrected AT ALL. The
-- function refused every non-rep outright, which was right while team_lead did
-- not exist and is now a lead posted to the wrong campus for ever.
-- -----------------------------------------------------------------------------
create or replace function public.correct_member_campus(
  p_member uuid,
  p_campus uuid,
  p_retag  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role         text;
  v_old_campus   uuid;
  v_campus_name  text;
  v_active       boolean;
  v_open_visits  integer;
  v_moved        integer := 0;
  v_team         integer;
begin
  -- ---------------------------------------------------------------------
  -- THE FIRST STATEMENT, and it has to be: everything below runs with the
  -- definer's rights, so this is the whole of the authorisation.
  -- ---------------------------------------------------------------------
  if not public.is_admin() then
    raise exception 'Only an admin can change which campus a rep works from.'
      using errcode = '42501';
  end if;

  if p_member is null then
    raise exception 'No member was named.'
      using errcode = 'FO029';
  end if;

  if p_campus is null then
    raise exception 'No campus was named.'
      using errcode = 'FO029';
  end if;

  -- ---------------------------------------------------------------------
  -- The target has to be a rep.
  --
  -- An admin has NO campus and must not be given one - enforce_profile_campus
  -- (FO021) refuses it, and 0020b explains why at length: an admin sees every
  -- campus, so a campus on one would be a fact that decides nothing and could
  -- later be mistaken for a scope. Refused here with a sentence rather than
  -- left to the trigger's, because this is the layer the app reads.
  -- ---------------------------------------------------------------------
  select role, campus_id into v_role, v_old_campus
    from public.profiles where id = p_member;

  if v_role is null then
    raise exception 'That member no longer exists.'
      using errcode = 'FO029';
  end if;

  -- An ADMIN still has no campus. Unchanged: on them it would be a fact that
  -- decides nothing and could later be mistaken for a scope (0020b).
  if v_role = 'admin' then
    raise exception
      'Only a rep or a team lead works from a campus. An admin sees every campus and is posted to none.'
      using errcode = 'FO029';
  end if;

  /*
   * ⚠ A TEAM LEAD WITH REPS CANNOT BE MOVED, and this closes the trap
   * docs/hierarchy-plan.md flagged as open (§10 item 3).
   *
   * FO033 holds "a rep and their lead share one campus" from the REP'S side and
   * fires on the rep's row. Moving the LEAD'S campus is the other half of the
   * same rule and no trigger on profiles can see it: the lead's UPDATE touches
   * only their own row, which satisfies every check on it, and their whole team
   * is left pointing at a lead who now works somewhere else. Nothing refuses it,
   * nothing reports it, and the team stays visible in the roster and invisible
   * in the work - institutes are campus-scoped.
   *
   * Refused here, in the one function that moves a campus, with the COUNT in
   * the message so the admin knows the size of what they must do first.
   * Cascading the team instead was rejected: moving six people's campus as a
   * side effect of correcting one person's is a bigger act than was asked for.
   */
  if v_role = 'team_lead' then
    select count(*) into v_team
      from public.profiles r where r.team_lead_id = p_member;

    if v_team > 0 then
      raise exception
        'This team lead still has % rep(s). Move or reassign the team first, then change their campus.', v_team
        using errcode = 'FO029';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- The campus has to exist AND be one somebody may be posted to.
  --
  -- `active` is not decoration: 0020a added it for the demo campus, which
  -- exists so the demonstration rows have a home that is not one of the five.
  -- Posting a real rep there would hide their whole pipeline behind a campus
  -- nobody looks at. The app's picker already filters on it (listCampuses);
  -- this is the control behind that courtesy.
  -- ---------------------------------------------------------------------
  select name, active into v_campus_name, v_active
    from public.campuses where id = p_campus;

  if v_campus_name is null then
    raise exception 'That campus does not exist.'
      using errcode = 'FO029';
  end if;

  if not v_active then
    raise exception 'That campus is not in use. Choose one of the active campuses.'
      using errcode = 'FO029';
  end if;

  -- ---------------------------------------------------------------------
  -- NOT WHILE THEY ARE STANDING IN A SCHOOL.
  --
  -- Exactly the predicate daily_plans_one_open_visit indexes for FO013 -
  -- arrived, not checked out, and not swept - so this asks precisely the
  -- question "is this rep inside a visit right now". `checkout_missing`
  -- matters: a plan the nightly sweep has already closed is finished business
  -- and must not hold a correction hostage for ever.
  --
  -- KEYED ON MEMBER ALONE, which is the one difference from FO025(b). That
  -- refusal is about one institute being reassigned, so it asks about that
  -- institute. This moves the rep's ENTIRE pipeline between campuses, so any
  -- open visit anywhere is affected and any open visit anywhere is a reason to
  -- wait. It is also the same shape as FO013 itself, which is keyed on
  -- (member) alone and reads neither the date nor the institute.
  --
  -- The cost of refusing is that an admin waits a few hours. The cost of not
  -- refusing is a rep stranded mid-visit with a photograph they cannot file.
  -- ---------------------------------------------------------------------
  select count(*) into v_open_visits
    from public.daily_plans dp
   where dp.member = p_member
     and dp.checkin_at is not null
     and dp.checkout_at is null
     and dp.checkout_missing = false;

  if v_open_visits > 0 then
    raise exception
      'That rep is part-way through a visit - correct their campus once they have finished.'
      using errcode = 'FO029';
  end if;

  -- ---------------------------------------------------------------------
  -- The correction itself. Both halves, one transaction.
  -- ---------------------------------------------------------------------
  update public.profiles
     set campus_id = p_campus
   where id = p_member;

  /*
   * THE RETAG. `registered_by = p_member` and nothing else - deliberately NOT
   * `and campus_id = v_old_campus`.
   *
   * The narrower predicate looks safer and is worse. An institute of this
   * rep's that has already drifted to a third campus - reassigned by hand, or
   * left behind by an earlier half-done correction - is exactly the row that
   * needs fixing, and the narrow version is the one that would skip it. The
   * rep owns it; after this they are on p_campus; so that is where it belongs.
   *
   * WHICH TRIGGERS THIS FIRES, checked rather than assumed. institutes_touch_
   * status and institutes_record_status_change both test `status is distinct
   * from` and this statement does not mention status, so both are no-ops.
   * institutes_guard_owner is `before update of registered_by`, which this does
   * not mention, so FO010/FO025 do not fire - correct, since ownership is not
   * moving. enforce_institute_campus is INSERT-only. So this really is one
   * column, and the pipeline's history is untouched.
   */
  -- Only a rep owns institutes, so a team lead's move retags nothing. Stated
  -- rather than left to the update matching no rows, so `institutes_moved: 0`
  -- is an answer rather than an accident.
  if p_retag and v_role = 'rep' then
    update public.institutes
       set campus_id = p_campus
     where registered_by = p_member
       and campus_id is distinct from p_campus;

    get diagnostics v_moved = row_count;
  end if;

  return jsonb_build_object(
    'campus', v_campus_name,
    'institutes_moved', v_moved
  );
end;
$$;

comment on function public.correct_member_campus is
  'Moves a rep or a TEAM LEAD to another campus, optionally retagging the '
  'institutes a rep owns. Admin only. Refuses a team lead who still has reps - '
  'FO033 holds the rep-and-lead-share-a-campus rule from the rep''s side and '
  'cannot see this edit, so it is refused here with the count and what to do. '
  'Raises FO029.';

revoke all on function public.correct_member_campus(uuid, uuid, boolean) from public;
revoke all on function public.correct_member_campus(uuid, uuid, boolean) from anon;
grant execute on function public.correct_member_campus(uuid, uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- 2b. FO033 clause (e) had the SAME hole, and a trigger must not disagree
--
-- ⚠ assign_rep_to_team() is not the only way this column can be written: an
-- ADMIN writes it directly through profiles_update, and the trigger is what
-- guards that path. Fixing only the RPC would leave the weaker rule in the
-- place that is harder to see.
--
-- Clause (e) tested `new.team_lead_id = caller OR old.team_lead_id = caller`.
-- The OR is the hole: naming yourself as the destination satisfied it however
-- the rep got there. Both sides must now be "nobody, or me".
--
-- Lifted from 0041 verbatim and changed in one clause, rather than retyped -
-- the four data checks above it are what stop a restore installing a link the
-- app could never have made, and rewriting them from memory is how that is
-- lost.
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
    /*
     * ⚠ BOTH SIDES, NOT EITHER. This read
     *
     *     (new.team_lead_id = caller or old.team_lead_id = caller)
     *
     * and the OR was a cross-team hole: naming YOURSELF as the destination
     * satisfied it however the rep got there, so a lead could take a colleague's
     * rep straight off their team. The integration suite caught it through
     * assign_rep_to_team(), which asked the same question the same wrong way.
     *
     * A lead may move a rep only BETWEEN "no team" and their own. Poaching is an
     * admin's act: moving somebody between two teams is a decision about both,
     * and only one of the two leads would ever know it had happened.
     *
     * `coalesce` because old.team_lead_id is null on INSERT and for every rep
     * nobody has assigned yet, and `null = caller` is null rather than false.
     */
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

drop trigger if exists profiles_team_lead_link on public.profiles;
create trigger profiles_team_lead_link
  before insert or update of role, campus_id, team_lead_id on public.profiles
  for each row execute function public.enforce_team_lead_link();


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  fn       text;
  n        integer;
  body     text;
begin
  -- 3a. Exactly one overload of each. A second makes every call from the app
  --     ambiguous, which is the failure 0015 records for log_visit().
  foreach fn in array array['assign_rep_to_team', 'correct_member_campus'] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;

    if n <> 1 then
      problems := array_append(problems, format(
        'expected exactly 1 %s, found %s - every call from the app would be ambiguous', fn, n));
      continue;
    end if;

    if not (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = fn) then
      problems := array_append(problems, format('%s() is not SECURITY DEFINER', fn));
    end if;

    /*
     * search_path pinned. LIKE 'search_path=%' against proconfig, NEVER array
     * containment: an empty search_path flattens to `search_path=""`, so
     * `@> array['search_path=']` is false for a function that pins it
     * perfectly. That false alarm rolled 0035 back on dev once.
     */
    if not exists (
      select 1 from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public' and p.proname = fn
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(problems, format('%s() does not pin search_path', fn));
    end if;
  end loop;

  -- 3b. THE AUTHORISATION TEST IS IN THE BODY. A definer function without one
  --     is a hole: anyone who may execute it may do what it does.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'assign_rep_to_team';

  if body is null or position('public.is_admin()' in body) = 0
     or position('public.is_team_lead()' in body) = 0 then
    problems := array_append(
      problems,
      'assign_rep_to_team() does not check is_admin()/is_team_lead() - any signed-in user could restaff a team');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'correct_member_campus';

  if body is null or position('public.is_admin()' in body) = 0 then
    problems := array_append(
      problems,
      'correct_member_campus() no longer checks is_admin()');
  end if;

  /*
   * 3b-ii. ⚠ THE CROSS-TEAM HOLE BOTH GUARDS HAD, asserted in BOTH places —
   * the RPC and the trigger each guard a different path to the same column.
   *
   * ⚠ AND IT IS ASSERTED ON THE CODE, NOT THE COMMENTS. pg_get_functiondef()
   * returns the whole definition, prose included, and the first version of this
   * check searched for the OLD form — which the function's own comment QUOTES in
   * order to explain it. The result was a migration that refused to apply
   * because of its own documentation, with an error message confidently
   * describing a bug that was not there. Three test suites in this repo have hit
   * the same trap; this is the one that cost a rollback.
   *
   * Both halves are POSITIVE checks. "The wrong thing is absent" is fragile —
   * it passes for a function that does neither — so each one names the shape
   * that must be PRESENT, and the comment-stripping only guards the one
   * remaining negative.
   */
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_team_lead_link';

  -- BOTH sides null-or-caller. The `coalesce(... , true)` pair IS the rule:
  -- null means "no team", which a lead may move a rep to and from.
  if body is null
     or position('coalesce(new.team_lead_id = caller, true)' in body) = 0
     or position('old.team_lead_id = caller' in body) = 0 then
    problems := array_append(
      problems,
      'enforce_team_lead_link() does not require BOTH sides of the link to be null-or-caller - a team lead could take another team''s rep');
  end if;

  -- And the OR form is gone from the CODE, whatever the comments say about it.
  if body is not null
     and position('new.team_lead_id = caller or old.team_lead_id = caller' in body) > 0 then
    problems := array_append(
      problems,
      'enforce_team_lead_link() still ORs the two sides of the link in its body');
  end if;

  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'assign_rep_to_team';

  -- The RPC asks where the rep is coming FROM, not only where they are going.
  if body is null
     or position('v_old_lead is not null' in body) = 0
     or position('v_old_lead is distinct from' in body) = 0 then
    problems := array_append(
      problems,
      'assign_rep_to_team() does not check where the rep is coming FROM - a team lead could poach');
  end if;

  -- 3c. THE TRAP THE PLAN FLAGGED. Without this clause a lead's campus can be
  --     moved out from under their whole team, silently.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'correct_member_campus';

  if body is null or position('team_lead_id = p_member' in body) = 0 then
    problems := array_append(
      problems,
      'correct_member_campus() does not count a team lead''s reps - their campus could be moved out from under the team');
  end if;

  -- 3d. Executable by a signed-in user, never by anon.
  if not has_function_privilege('authenticated', 'public.assign_rep_to_team(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.correct_member_campus(uuid, uuid, boolean)', 'execute') then
    problems := array_append(problems, 'a function is not executable by authenticated');
  end if;

  if has_function_privilege('anon', 'public.assign_rep_to_team(uuid, uuid)', 'execute') then
    problems := array_append(problems, 'anon may execute assign_rep_to_team()');
  end if;

  -- 3e. THE RULES THIS FILE LEANS ON, unchanged by it. FO033 is what re-checks
  --     every assignment inside the RPC; profiles_update staying narrow is why
  --     the RPC has to exist at all.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_team_lead_link'
       and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    problems := array_append(
      problems,
      'profiles_team_lead_link (FO033) is not attached - assign_rep_to_team() would be the only guard');
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'
       and qual like '%supervises%'
  ) then
    problems := array_append(
      problems,
      'profiles_update was widened to supervises() - a team lead would hold every column on their reps'' rows, role included');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0043 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0043 applied: assign_rep_to_team() staffs a team under FO034 and FO033; correct_member_campus() moves a team lead only when their team is empty.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- the three tiers as they stand
--   select p.role, p.name, c.name as campus, l.name as team_lead
--     from public.profiles p
--     left join public.campuses c on c.id = p.campus_id
--     left join public.profiles l on l.id = p.team_lead_id
--    order by p.role, l.name nulls first, p.name;
--
--   -- reps nobody supervises yet
--   select name from public.profiles
--    where role = 'rep' and team_lead_id is null order by name;
-- =============================================================================
