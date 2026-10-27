-- =============================================================================
-- KUbeats - migration 0061: a team lead's team is not a campus
--
-- ✅ ADDITIVE IN SHAPE, NARROWING IN EFFECT. No table, no column, no policy.
-- Replaces two functions in place; nothing to backfill.
--
-- THE CLIENT'S REQUIREMENT: an admin may put any rep under any team lead, on
-- any campus. 0041/0042/0043 built the opposite on purpose — "a rep and their
-- team lead must work from the same campus" was FO033 clause (d) and FO034's
-- own re-check in assign_rep_to_team() — and this migration removes exactly
-- that one rule from exactly those two places.
--
-- WHAT STAYS EXACTLY AS IT WAS, because none of it was the campus rule:
--
--   - A rep belongs to a team lead, never the reverse (FO033 clause a).
--   - Nobody is their own team lead (clause b).
--   - The parent must actually BE a team lead, not an admin or another rep
--     (clause c) - unchanged, renumbered to (c) below with (d) gone.
--   - Who may write the link at all - an admin, or the lead taking a rep
--     onto their OWN team / releasing one of their own (clause e, and
--     assign_rep_to_team()'s own "where are they coming from" check). A lead
--     still cannot poach across teams; that was never about campus.
--   - `enforce_profile_campus` (FO021): a rep and a team lead still each work
--     from exactly one campus of their OWN. This migration only stops that
--     campus being compared between the TWO of them - it does not touch
--     either person's own campus field, and `correct_member_campus()` (0035)
--     is untouched.
--   - `supervises()` (0041) and every policy 0042 rewrote onto it: visibility
--     was already OWNERSHIP, not campus - 0042's own header is explicit that
--     a campus clause on an institute predicate would be "a boundary while
--     drawing the wrong one", because two team leads already share a campus.
--     So a team lead whose reps now span several campuses sees exactly their
--     reps' institutes and nobody else's, with no RLS change needed here.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0061_team_lead_cross_campus_down.sql restores both
--   functions to their 0043 bodies, campus check included.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. assign_rep_to_team() — drop the same-campus re-check
--
-- Everything else is 0043's body, unchanged: who may call it, which direction
-- a lead may move a rep, and the poaching guard that asks where the rep is
-- coming FROM. `v_rep_campus` and `v_lead_campus` existed only to feed the
-- removed check, so neither is selected any more.
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
  v_rep_name      text;
  v_lead_role     text;
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

  select role, name, team_lead_id
    into v_rep_role, v_rep_name, v_old_lead
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
   * Unchanged from 0043 - this was never about campus. Without it a lead
   * could take a colleague's rep straight off their team - same campus or
   * not, destination themselves, both earlier checks satisfied. That is a
   * cross-team WRITE, the one thing H2 exists to prevent, through the one
   * function that bypasses the policy which would otherwise stop it.
   *
   * Poaching is an ADMIN'S act, deliberately: moving somebody between two
   * teams is a decision about both of them, and only one of the two leads
   * would ever know it had happened.
   */
  if not public.is_admin()
     and v_old_lead is not null
     and v_old_lead is distinct from (select auth.uid()) then
    raise exception
      'That rep is already on another team. Ask an admin to move them.'
      using errcode = 'FO034';
  end if;

  if p_lead is not null then
    select role, name into v_lead_role, v_lead_name
      from public.profiles where id = p_lead;

    if v_lead_role is null then
      raise exception 'That team lead no longer exists.' using errcode = 'FO034';
    end if;

    if v_lead_role <> 'team_lead' then
      raise exception
        'A rep can only be assigned to a team lead.'
        using errcode = 'FO034';
    end if;

    -- ⚠ NO CAMPUS CHECK HERE, AND THAT IS THIS MIGRATION. 0043 refused a
    -- cross-campus pairing with "a rep and their team lead must work from the
    -- same campus"; the client's spec asks for exactly that pairing to be
    -- allowed. Nothing else in this branch changed.
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
  'auth.uid() is the caller even here. Since 0061, a rep and their team lead '
  'need not share a campus. Raises FO034.';

revoke all on function public.assign_rep_to_team(uuid, uuid) from public;
revoke all on function public.assign_rep_to_team(uuid, uuid) from anon;
grant execute on function public.assign_rep_to_team(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. enforce_team_lead_link() — FO033 loses clause (d), nothing else
--
-- Lifted from 0043 verbatim and clause (d) removed, rather than retyped - (a),
-- (b), (c) and (e) are what keep every OTHER rule on this link standing, and
-- rewriting them from memory is how one of them quietly goes missing.
-- `v_lead_campus` existed only to feed (d), so it is no longer selected.
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
   * A team lead may be on EITHER side of the change: taking a rep on, or
   * releasing one of their own. An admin may do anything. Everything else —
   * including a rep editing the row they are allowed to write — is refused.
   */
  if (tg_op = 'INSERT' and new.team_lead_id is not null)
     or (tg_op = 'UPDATE' and new.team_lead_id is distinct from old.team_lead_id)
  then
    /*
     * BOTH SIDES, NOT EITHER — unchanged from 0043. A lead may move a rep
     * only BETWEEN "no team" and their own. Poaching is an admin's act.
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

  select p.role into v_lead_role
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

  -- ⚠ (d) IS GONE. 0043 refused a lead and rep on different campuses here;
  -- the client's spec asks for exactly that to be allowed, so the clause -
  -- and the campus lookup that fed it - is removed rather than loosened in
  -- place, to leave nothing behind that could silently fire again.

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
  body     text;
begin
  -- 3a. The campus sentence is gone from both functions.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'assign_rep_to_team';

  if body is null then
    problems := array_append(problems, 'assign_rep_to_team() is missing');
  elsif position('must work from the same campus' in body) > 0 then
    problems := array_append(
      problems,
      'assign_rep_to_team() still refuses a cross-campus pairing');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_team_lead_link';

  if body is null then
    problems := array_append(problems, 'enforce_team_lead_link() is missing');
  elsif position('must work from the same campus' in body) > 0 then
    problems := array_append(
      problems,
      'enforce_team_lead_link() still refuses a cross-campus pairing');
  end if;

  -- 3b. Everything FO033/FO034 is NOT about campus must still be standing.
  if body is null
     or position('coalesce(new.team_lead_id = caller, true)' in body) = 0
     or position('old.team_lead_id = caller' in body) = 0 then
    problems := array_append(
      problems,
      'enforce_team_lead_link() lost the both-sides-null-or-caller rule - unrelated to campus and must survive');
  end if;

  if body is null or position('Nobody is their own team lead' in body) = 0 then
    problems := array_append(problems, 'enforce_team_lead_link() lost the no-self-lead rule (b)');
  end if;

  if body is null or position('A rep can only be assigned to a team lead' in body) = 0 then
    problems := array_append(problems, 'enforce_team_lead_link() lost the lead-must-be-a-lead rule (c)');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'assign_rep_to_team';

  if body is null
     or position('v_old_lead is not null' in body) = 0
     or position('v_old_lead is distinct from' in body) = 0 then
    problems := array_append(
      problems,
      'assign_rep_to_team() lost the poaching guard - unrelated to campus and must survive');
  end if;

  -- 3c. Still exactly one overload each, still SECURITY DEFINER, still pinned.
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'assign_rep_to_team') <> 1 then
    problems := array_append(problems, 'assign_rep_to_team() is not exactly one overload');
  end if;

  if not (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'assign_rep_to_team') then
    problems := array_append(problems, 'assign_rep_to_team() is not SECURITY DEFINER');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_team_lead_link'
       and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'profiles_team_lead_link (FO033) is not attached');
  end if;

  -- 3d. enforce_profile_campus (FO021) is untouched by this file - a person's
  --     OWN campus requirement is not the rule being removed.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_campus_required' and not tgisinternal
  ) then
    raise notice '0061 note: profiles_campus_required not found under that name - check FO021 was not lost.';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0061 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0061 applied: a rep and their team lead no longer need to share a campus. Every other FO033/FO034 rule - direction, self-lead, poaching, who may write the link - is unchanged.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- cross-campus teams now possible to see
--   select l.name as lead, l.campus_id as lead_campus,
--          r.name as rep,  r.campus_id as rep_campus
--     from public.profiles r
--     join public.profiles l on l.id = r.team_lead_id
--    where l.campus_id is distinct from r.campus_id;
-- =============================================================================
