-- =============================================================================
-- 0035 - correcting a rep's campus, and taking their pipeline with them
--
-- The client asked to be able to fix a rep who was put on the wrong campus.
-- That sounds like editing one column and is not, because of what the column
-- decides.
--
-- WHY A BARE UPDATE IS THE WRONG ANSWER. Since 0028 an institute is readable by
--
--     campus_id = public.my_campus() and registered_by = (select auth.uid())
--
-- a STRICT AND. `profiles.campus_id` is the left-hand side of it. So moving a
-- rep from campus A to campus B, on its own, leaves every institute they ever
-- registered sitting at campus A with their name still on it - matching on
-- ownership and failing on campus. The rep does not see an error. They see an
-- empty registry, an empty Pending and an empty daily-plan picker, and if they
-- are mid-visit when it happens, log_visit()'s `update public.institutes`
-- matches no row and raises FO006 - which, with FO013 allowing one open visit
-- at a time, leaves them unable to check in anywhere until the 01:30 sweep.
--
-- 0028's own header names this outcome and accepts it for REASSIGNMENT:
-- "transferring a rep orphans their pipeline until an admin reassigns it". It
-- is the right answer there, where moving a rep between campuses is a real
-- organisational event. It is the wrong answer for a CORRECTION, where the rep
-- was never on campus A in the first place and neither were their institutes.
--
-- SO THE RETAG IS AN ARGUMENT, NOT A DEFAULT IN THE DATABASE. `p_retag` says
-- which of the two this is:
--
--   true   A MIS-ALLOCATION. They were always at B; the row said A. Their
--          institutes move with them, and nothing about the pipeline changes
--          except the campus it was always supposed to carry. This is what the
--          app offers first, because it is what an admin reaching for "edit
--          this rep's campus" almost always means.
--   false  A GENUINE TRANSFER. They really did work campus A, and those
--          institutes really do belong to A's history. They stay, and they go
--          out of that rep's sight until an admin reassigns them to somebody on
--          A - which is exactly 0028's paragraph, deliberately preserved rather
--          than designed away.
--
-- ONE TRANSACTION, because it writes two tables and a half-done correction is
-- the state this function exists to prevent: a rep on B whose institutes are
-- still on A is precisely the broken shape described above, and a crash between
-- two separate statements would create it on purpose.
--
-- REFUSED WHILE THE REP IS MID-VISIT, and this is FO025(b)'s reasoning arriving
-- through a different door. 0028 refuses to reassign an institute while its
-- owner holds an open check-in there, because the rep is left stuck. A campus
-- correction reaches the identical state - the institute stops being readable
-- under the new campus until the retag lands, and in the no-retag case it never
-- does. The predicate here is keyed on MEMBER ALONE rather than on
-- (member, institute), because this moves the rep's whole pipeline rather than
-- one row: any open visit at all is a reason to wait.
--
-- WHAT IS NEVER TOUCHED: nothing is deleted, no visit moves, no institute
-- changes owner, and no plan row is rewritten. `visits` and `daily_plans` are
-- member-scoped (`member = auth.uid() or is_admin()`, 0001) and not
-- campus-scoped at all, so a rep keeps every visit they have ever logged and
-- every weekly figure keeps counting. Only `profiles.campus_id` and, at the
-- admin's word, `institutes.campus_id` move.
--
-- ⚠ DEPLOY COUPLING: APPLY THIS BEFORE THE EDIT UI SHIPS. It is the one
-- direction that matters, and it is the opposite of 0033's.
--
--   OLD CODE, NEW DATABASE   fine. Nothing in the previous build calls this
--                            function; an unused function costs nothing.
--   NEW CODE, OLD DATABASE   updateMember()'s campus half calls
--                            correct_member_campus() through PostgREST, and a
--                            function that is not there comes back as PGRST202
--                            - which errors.ts does NOT map, so the admin gets
--                            the generic fallback and no hint that a migration
--                            is missing. The NAME half of the same editor is an
--                            ordinary profiles update and would keep working,
--                            so the screen would look half-broken rather than
--                            unavailable.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: the function is a create-or-replace and the grants are
--   revoke-then-grant, so running it twice leaves exactly the same state.
--
-- NO SCHEMA CHANGE AT ALL. No table, column, constraint, policy or trigger is
-- added, dropped or altered by this file - which is why scripts/check-schema.mjs
-- cannot probe for it. It adds one function. Its own assertion block below is
-- what proves it landed.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The function
--
-- SECURITY DEFINER, and that decision carries the whole authorisation burden.
-- Under RLS an admin could already write both columns - `profiles_update` and
-- `institutes_update` both permit `is_admin()` - so definer rights are not
-- about reaching past a policy. They are about the RETAG being atomic and
-- complete: as the caller, a retag would be subject to `institutes_update`'s
-- own predicate on every row, and the one thing this must not do is move some
-- of a rep's institutes and not others.
--
-- CLAUDE.md pins log_visit() and close_visit() to SECURITY INVOKER precisely so
-- campus scoping applies INSIDE them. That rule is about the two functions a
-- rep drives. This is the other kind - an administrative act that CHANGES the
-- boundary, like delete_member() (0032) - and its authorisation is the
-- is_admin() line below, not the policy.
--
-- is_admin() IS THE FIRST STATEMENT, WITH NO TRUSTED-CONTEXT BYPASS. 0032 makes
-- the same call and its reasoning applies unchanged: the guard TRIGGERS in 0016,
-- 0018 and 0034 exempt a null auth.uid() because they stand in the way of
-- restores and scheduled jobs that must not be blocked. This is not a guard. It
-- is an action, it moves a security boundary, and there is no cron job that
-- should ever want to. is_admin() reads auth.uid(), so the service role is
-- refused here with 42501 exactly like a rep, and a correction always has a
-- named admin behind it. An operator who genuinely means to do this from the
-- SQL editor runs the two UPDATEs by hand.
--
-- FO029 for every refusal a person can cause.
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

  if v_role <> 'rep' then
    raise exception
      'Only a rep works from a campus. An admin sees every campus and is posted to none.'
      using errcode = 'FO029';
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
  if p_retag then
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
  'Moves a rep to another campus and, when p_retag, takes the institutes they '
  'own with them - one transaction, because a rep on one campus whose '
  'institutes are on another is invisible to them (0028''s strict AND). '
  'Admin-only with no trusted-context bypass; refuses an admin target, an '
  'inactive campus, and a rep who is part-way through a visit. Raises FO029. '
  'Deletes nothing and moves no visit.';

-- Spelled out rather than assumed, the way 0032 and every table since 0011
-- does it: a Supabase project's default privileges grant execute on new
-- functions to everyone, and `public` includes anon.
revoke all on function public.correct_member_campus(uuid, uuid, boolean) from public;
revoke all on function public.correct_member_campus(uuid, uuid, boolean) from anon;
grant execute on function public.correct_member_campus(uuid, uuid, boolean) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Prove it landed, and prove the rules it leans on are still there
--
-- This function REFUSES on behalf of two other rules rather than restating
-- them, so both are asserted: FO021 is what makes "an admin has no campus"
-- true, and daily_plans_one_open_visit is what makes the open-visit predicate
-- mean "this rep is blocked". If either has gone, this file's refusals are
-- arbitrary rather than principled and the reader should be told.
--
-- Every append is array_append(), never `problems || '...'`: problems is text[]
-- and a bare quoted literal is of unknown type, so `||` resolves to array
-- concatenation and fails with 22P02 at the moment a check reports something.
-- That trap is recorded at length in 0032, which was bitten by it.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
  n        integer;
begin
  -- 2a. Exactly one overload. A second would make every call from the app
  --     ambiguous, which is the failure 0015 records for log_visit().
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'correct_member_campus';

  if n = 0 then
    problems := array_append(
      problems,
      'correct_member_campus is missing - the campus half of the member editor answers PGRST202');
  elsif n <> 1 then
    problems := array_append(problems, format(
      'there are %s correct_member_campus overloads, expected exactly 1 - every call would fail as ambiguous', n));
  else
    -- 2b. DEFINER, and with search_path pinned. Without definer rights the
    --     retag would be filtered row by row by institutes_update and could
    --     move some of a rep's institutes and not others.
    if not (select p.prosecdef
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'correct_member_campus') then
      problems := array_append(
        problems,
        'correct_member_campus() is not SECURITY DEFINER - a retag could be partially applied');
    end if;

    -- search_path is pinned, so a caller cannot hijack an unqualified name.
    --
    -- THE SAME LESSON 0032 ALREADY WROTE DOWN, RE-LEARNED IN A NEW DISGUISE,
    -- and it is recorded here because reading 0032's version was evidently not
    -- enough to stop it happening again.
    --
    -- 0032's first version hunted the SOURCE spelling in pg_get_functiondef()'s
    -- output, which is normalised to ` SET search_path TO ''` - so the string
    -- `search_path=` never appears there at all. Its fix was to ask
    -- pg_proc.proconfig instead, and to match with LIKE.
    --
    -- This file took the first half of that lesson and dropped the second. It
    -- read proconfig - correctly - and then tested `proconfig @> array[
    -- 'search_path=']`, which is array CONTAINMENT: true only if some element
    -- is EXACTLY the string `search_path=`. Postgres stores the flattened GUC
    -- value, and an empty search_path is flattened with quoting, so the element
    -- reads `search_path=""` and the containment test is false. The assertion
    -- therefore rolled 0035 back on dev, naming a fault in a function that pins
    -- search_path perfectly - the same false alarm 0032 hit, one layer in.
    --
    -- THE INVARIANT IS THAT THE CLAUSE IS PRESENT, not what it is spelled as.
    -- LIKE 'search_path=%' asks that and nothing more; the VALUE it pins to is
    -- the `set search_path = ''` on the CREATE at the head of this file, which
    -- is where that decision belongs. Identical in form to 0032's, deliberately,
    -- so the two cannot drift again.
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[]))
          as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'correct_member_campus'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(
        problems,
        'correct_member_campus() does not pin search_path - a definer function without one is a privilege hole');
    end if;

    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'correct_member_campus';

    -- 2c. The authorisation is still the first thing it does, and it is still
    --     is_admin() rather than a caller-is-null bypass.
    if position('public.is_admin()' in body) = 0 then
      problems := array_append(
        problems,
        'correct_member_campus() does not call is_admin() - it would be callable by any signed-in user');
    end if;

    -- 2d. The open-visit refusal is still in there. Looked for by the column
    --     that makes it correct rather than by a comment: without
    --     checkout_missing the predicate would treat a swept plan as open and
    --     refuse corrections for ever.
    if position('checkout_missing' in body) = 0 then
      problems := array_append(
        problems,
        'correct_member_campus() no longer reads checkout_missing - it would either strand a mid-visit rep or refuse for ever');
    end if;

    -- 2e. The retag still keys on ownership.
    if position('registered_by' in body) = 0 then
      problems := array_append(
        problems,
        'correct_member_campus() no longer retags by registered_by - the rep''s pipeline would be left behind');
    end if;
  end if;

  -- 2f. THE TWO RULES IT REFUSES ON BEHALF OF.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_campus_required'
       and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    problems := array_append(
      problems,
      'profiles_campus_required (FO021) is gone - "an admin has no campus" is no longer enforced anywhere');
  end if;

  if not exists (
    select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.relname = 'daily_plans_one_open_visit' and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - the open-visit refusal here no longer means a rep is blocked');
  end if;

  -- 2g. And the boundary this whole file is about.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'institutes'
       and policyname = 'institutes_select'
  ) then
    problems := array_append(problems, 'institutes_select is missing');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0035 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0035 applied: correct_member_campus() is available, admin-only, and refuses a rep mid-visit.';
end $$;


-- =============================================================================
-- WHAT THIS DOES NOT CHANGE, WRITTEN DOWN SO NOBODY GOES LOOKING
--
-- NO POLICY MOVED. institutes_select is still the strict AND from 0028, and
-- that is the point: this function does not widen the boundary, it moves a rep
-- and their rows to the same side of it.
--
-- A RETAG DOES NOT SHOW THE INSTITUTES TO THE NEW CAMPUS'S OTHER REPS. The
-- predicate is campus AND ownership, so a colleague on p_campus still cannot
-- see them - `registered_by` is unchanged and still names the same person.
-- Handing an institute to a different rep is reassignInstitute()/FO025, and is
-- deliberately a separate act.
--
-- THE NO-RETAG CASE LEAVES ORPHANS ON PURPOSE. Those institutes match on
-- ownership and fail on campus, so the rep cannot see them and nor can anyone
-- else except an admin. That is 0028's accepted consequence of a transfer, and
-- the admin registry's owner column and "Unassigned" badge are what make it
-- visible rather than mysterious. The fix is to reassign them to a rep on the
-- old campus.
--
-- NOTHING HERE READS OR WRITES profiles.created_by (0034). A correction does
-- not change who opened the account.
--
-- HOW TO CHECK AFTERWARDS
--
--   -- the function, its rights and its search_path
--   select p.proname, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname = 'public' and p.proname = 'correct_member_campus';
--
--   -- reps whose institutes are NOT on their own campus, which is the state
--   -- this function exists to end. Should be empty after a retag.
--   select p.name as rep, c1.name as rep_campus, c2.name as institute_campus,
--          count(*) as institutes
--     from public.institutes i
--     join public.profiles p  on p.id  = i.registered_by
--     left join public.campuses c1 on c1.id = p.campus_id
--     left join public.campuses c2 on c2.id = i.campus_id
--    where i.campus_id is distinct from p.campus_id
--    group by 1, 2, 3
--    order by 1;
-- =============================================================================
