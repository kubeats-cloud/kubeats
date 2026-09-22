-- =============================================================================
-- 0032 - Deleting a member, and everything that is theirs
--
-- The client asked for a Delete beside Add Member: an account and ALL of that
-- member's own data goes, permanently, and nothing of anybody else's does.
--
-- WHY THIS IS AN RPC AND NOT SEVEN DELETES IN A SERVER ACTION
--
-- It touches eight tables. Through PostgREST that is eight round trips with no
-- transaction between them, so a failure part-way leaves a member with no
-- visits, no plans and no targets but a live account and their institutes still
-- standing - half deleted, with nothing able to finish it and nothing able to
-- undo it. CLAUDE.md is explicit that a write touching more than one table goes
-- through a Postgres function so it is one transaction, and this is the
-- sharpest case of that rule in the app.
--
-- THIS IS THE ONE SECURITY DEFINER FUNCTION THAT DELETES APPLICATION DATA, and
-- it is definer for a specific reason rather than for convenience:
-- institute_status_history has NO delete policy at all (0011 makes append-only
-- a privilege fact, not merely a missing grant), and weekly_targets /
-- weekly_targets_pre_0013 may sit outside anything a current admin holds. An
-- invoker function would be refused halfway through.
--
-- CLAUDE.md's "log_visit() and close_visit() MUST stay SECURITY INVOKER" is
-- about those two specifically, because campus scoping has to apply INSIDE
-- them. This function's entire job is to cross that boundary, once, under an
-- explicit admin check - so it is guarded the way every other definer function
-- here is: is_admin() as the FIRST statement, search_path = '', every
-- reference schema-qualified, revoked from public and anon, granted to
-- authenticated alone.
--
-- WHAT IT DOES NOT DO
--
--   * It does not touch the auth user. That is auth.users, which PostgREST
--     cannot reach at all; the server action finishes the job with the
--     service-role admin client after this returns. Deliberately last - see
--     the ordering note below.
--   * It does not touch storage. The visit-photos objects are removed by the
--     action too, after this commits and before the auth user goes.
--   * It does not touch MATERIALS. The library is shared by the whole team and
--     `materials.uploaded_by` is an audit stamp, not ownership: deleting a
--     departing admin's uploads would take the team's posters and fee sheets
--     with them. The FK is `on delete set null` and that is the wanted
--     behaviour - the file stays, the byline goes.
--
-- NEW ERROR CODE: FO027 - a member whose institutes carry somebody else's work.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: create or replace throughout, and the assertion block at
--   the foot is read-only.
--
-- DEPLOY COUPLING: none in the dangerous direction. Applied before the code
-- ships, the function simply sits there uncalled. Applied after, the Delete
-- button reports a missing function rather than half-deleting anybody.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. public.delete_member()
--
-- THE ORDER IS FORCED, not chosen, and it is worth writing down which parts:
--
--   visits and daily_plans BEFORE institutes, because visits.institute_id and
--   daily_plans.institute_id are both `on delete restrict` (0001). The other
--   way round, the institute delete fails with 23503 and takes the whole
--   transaction with it.
--
--   profiles BEFORE the auth user, which happens outside this function.
--   profiles.id references auth.users `on delete cascade`, so deleting the auth
--   user would take the profile silently. Deleting it here is what makes this
--   function the thing that does the work and the auth call merely the
--   cleanup - and it means that between this committing and the auth call, the
--   member has no profile, so requireAdmin() and getCurrentUser() both refuse
--   them rather than letting a ghost session act.
--
-- visit_people is deleted explicitly even though `visit_people.visit_id`
-- cascades. Redundant and cheap, and it makes this function read as a complete
-- inventory of what belongs to a member rather than resting on a cascade a
-- later migration could quietly change.
--
-- WHAT IS DELIBERATELY LEFT TO `on delete set null`, because the row is not the
-- member's to take:
--
--   institutes.status_updated_by        the institute is somebody's now
--   daily_plans.assigned_by             another member's plan row
--   daily_plans.checkout_closed_by      another member's plan row
--   targets.reopened_by                 another member's week
--   institute_status_history.changed_by an append-only audit row
--   institute_status_history.visit_id   likewise - 0011 chose set null over
--                                       cascade precisely so that deleting a
--                                       visit cannot erase the record that an
--                                       institute's status moved
--   materials.uploaded_by               the shared library, see above
--   visits.closes_visit_id              another member's Set, closed by this
--                                       one. Rare but real across a reassign.
-- -----------------------------------------------------------------------------
create or replace function public.delete_member(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller   uuid := (select auth.uid());
  v_role     text;
  v_admins   integer;
  v_blocked  integer;
  v_names    text;
  v_removed  jsonb := '{}'::jsonb;
  n          integer;
begin
  -- ---------------------------------------------------------------------
  -- THE FIRST STATEMENT, and it has to be. Everything below runs with the
  -- definer's rights, so this check is not a courtesy like requireAdmin() in
  -- the action above it - it is the whole of the authorisation.
  --
  -- NO TRUSTED-CONTEXT BYPASS, and this is a deliberate departure from the
  -- guard triggers in 0016 and 0018. Those read `caller is not null and not
  -- public.is_admin()`, so a null auth.uid() - the service role, the SQL editor,
  -- the nightly cron job - passes: they are guards standing in the way of
  -- automated work that must not be blocked.
  --
  -- This is the opposite kind of function. It destroys a person's whole history
  -- and there is no scheduled job that should ever want to. `is_admin()` reads
  -- auth.uid(), so the service role is refused here with 42501 exactly like a
  -- rep, and a delete always has a named admin behind it. An operator who
  -- genuinely means to do this from the SQL editor runs the DELETE statements
  -- below by hand, which is the right amount of friction for the one
  -- irreversible action in the app.
  -- ---------------------------------------------------------------------
  if not public.is_admin() then
    raise exception 'Only an admin can delete a member.'
      using errcode = '42501';
  end if;

  if p_member is null then
    raise exception 'No member was named.'
      using errcode = 'FO027';
  end if;

  select role into v_role from public.profiles where id = p_member;
  if v_role is null then
    raise exception 'That member no longer exists.'
      using errcode = 'FO027';
  end if;

  -- An admin deleting themselves would delete the session they are acting
  -- through, mid-transaction. Said in the action too; this is the copy a
  -- hand-made request also has to hear.
  if p_member = v_caller then
    raise exception 'You cannot delete your own account.'
      using errcode = 'FO027';
  end if;

  -- The last admin. There is no self-signup and no other route to an admin
  -- account, so removing the only one leaves the app unadministrable with
  -- nothing in the product able to put it right.
  if v_role = 'admin' then
    select count(*) into v_admins from public.profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception
        'That is the only admin account. Create another admin first.'
        using errcode = 'FO027';
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- FO027 - the safety net for legacy cross-member data.
  --
  -- Since 0028 an institute belongs to exactly one rep and only that rep can
  -- plan or visit it (FO026 at planning AND at arrival, institutes_select
  -- hiding the rest). So a NEW cross-member visit cannot be made. Two ways one
  -- exists anyway:
  --
  --   * rows from before 0028, when campus was the only boundary and two reps
  --     on one campus shared the registry;
  --   * an admin reassigning an institute AFTER somebody visited it -
  --     reassignInstitute moves registered_by and leaves the history where it
  --     is, which is legal today and produces exactly this shape.
  --
  -- The `on delete restrict` on visits.institute_id would refuse the delete
  -- anyway, so the outcome is the same either way. What this adds is a
  -- SENTENCE with the institutes NAMED in it, instead of a bare 23503 that
  -- tells an admin nothing about which school is in the way or what to do.
  --
  -- It refuses the WHOLE teardown. Everything above is inside this
  -- transaction, so nothing has been lost when this raises - which is the
  -- point. Silently wiping another rep's visits to get a delete through would
  -- be the one outcome worse than refusing.
  -- ---------------------------------------------------------------------
  select count(*), string_agg(distinct i.name, ', ' order by i.name)
    into v_blocked, v_names
    from public.institutes i
   where i.registered_by = p_member
     and (
       exists (
         select 1 from public.visits v
          where v.institute_id = i.id and v.member <> p_member
       )
       or exists (
         select 1 from public.daily_plans dp
          where dp.institute_id = i.id and dp.member <> p_member
       )
     );

  if coalesce(v_blocked, 0) > 0 then
    raise exception
      'Nothing was deleted. % institute(s) owned by this member carry work '
      'logged by somebody else (%). Reassign them to another rep first, then '
      'delete.', v_blocked, v_names
      using errcode = 'FO027';
  end if;

  -- ---------------------------------------------------------------------
  -- The teardown, in the one order the foreign keys allow.
  -- ---------------------------------------------------------------------

  -- (a) The people met on this member's visits. Cascades anyway; explicit so
  --     this function is a full inventory.
  delete from public.visit_people vp
   where exists (
     select 1 from public.visits v
      where v.id = vp.visit_id and v.member = p_member
   );
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('visit_people', n);

  -- (b) The visits. Cascades visit_people, nulls institute_status_history.
  --     visit_id and any other member's visits.closes_visit_id.
  delete from public.visits where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('visits', n);

  -- (c) The plan rows. Nulls visits.daily_plan_id on nothing, since (b) has
  --     already taken every visit that could have pointed here.
  delete from public.daily_plans where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('daily_plans', n);

  -- (d) The weekly commitments.
  delete from public.targets where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('targets', n);

  -- (e) The pre-0013 commitments, under EITHER name.
  --
  --     Which of these exists depends entirely on how far a given database has
  --     been migrated, and on whether anybody has run the optional
  --     `drop table public.weekly_targets_pre_0013;` that 0013 offers at the
  --     end. scripts/tables.mjs documents the same fork for the same reason,
  --     and lists both names for it. Guarded with to_regclass and run through
  --     EXECUTE so this file parses against a database that has neither.
  if to_regclass('public.weekly_targets') is not null then
    execute 'delete from public.weekly_targets where member = $1' using p_member;
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('weekly_targets', n);
  end if;

  if to_regclass('public.weekly_targets_pre_0013') is not null then
    execute 'delete from public.weekly_targets_pre_0013 where member = $1'
      using p_member;
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('weekly_targets_pre_0013', n);
  end if;

  -- (f) The institutes they own. Only reachable now that (b) and (c) have
  --     cleared the two restrict-ing references. Cascades
  --     institute_status_history, which is correct: that table's rows are the
  --     journey of an institute, and the institute is going.
  delete from public.institutes where registered_by = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('institutes', n);

  -- (g) The profile. BEFORE the auth user, which the action deletes after this
  --     commits - see the ordering note at the head of this section.
  delete from public.profiles where id = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('profiles', n);

  return v_removed;
end;
$$;

comment on function public.delete_member(uuid) is
  'Deletes a member and every row that is theirs alone, in one transaction and '
  'in the order the foreign keys allow: visit_people, visits, daily_plans, '
  'targets, the weekly_targets archive under either name, the institutes they '
  'own, then the profile. Refuses with FO027 when an owned institute carries '
  'another member''s work, rather than wiping it. Does NOT touch auth.users, '
  'storage, or materials. SECURITY DEFINER with is_admin() as its first '
  'statement.';

-- The service role and the SQL editor keep their implicit access; nobody else
-- does. Same shape as close_visit()'s grants in 0018/0030.
revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Did it land?
--
-- Read-only, and it raises rather than notices: a half-applied file here is
-- worse than an unapplied one, because the Delete button would exist and would
-- do something other than what it says.
-- -----------------------------------------------------------------------------
--
-- EVERY APPEND BELOW IS array_append(), NEVER `problems || '...'`, and that is
-- not a style choice. `problems` is text[], so `||` with a bare quoted literal
-- is ambiguous: the literal is of unknown type, Postgres prefers the
-- anyarray || anyarray operator, and it then tries to read the sentence as an
-- array literal. The result is
--     ERROR 22P02 malformed array literal: "<the message>"
-- raised at the moment a check FAILS - so the block works perfectly until the
-- first time it has something to report, and then hides the real finding behind
-- a parse error. `problems || format(...)` happens to be safe because format()
-- is typed text, which is exactly what makes the mixed idiom a trap: the two
-- spellings look identical and only one of them survives a failure.
do $$
declare
  problems text[] := '{}';
  body     text;
  n        integer;
begin
  -- 2a. It exists, exactly once.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'delete_member';

  if n <> 1 then
    problems := array_append(problems, format(
      'there are %s delete_member overloads, expected exactly 1', n));
  else
    -- 2b. It is SECURITY DEFINER. An invoker version would be refused by
    --     institute_status_history, which has no delete policy at all.
    if not (
      select p.prosecdef
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'delete_member'
    ) then
      problems := array_append(
        problems,
        'delete_member() is not SECURITY DEFINER - the history cascade would be refused');
    end if;

    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'delete_member';

    -- 2c. The admin check is there. A definer function that deletes eight
    --     tables without one is the worst thing this file could ship.
    if position('public.is_admin()' in body) = 0 then
      problems := array_append(
        problems,
        'delete_member() does not check is_admin() - any authenticated user could call it');
    end if;

    -- 2d. FO027 is raised, so the cross-member guard is present.
    if position('FO027' in body) = 0 then
      problems := array_append(
        problems,
        'delete_member() does not raise FO027 - the cross-member guard is missing');
    end if;

    -- 2e. search_path is pinned, so a caller cannot hijack an unqualified name.
    --
    -- ASKED OF pg_proc.proconfig, NOT OF THE RENDERED DEFINITION, and the first
    -- version of this check got that wrong in a way worth recording.
    --
    -- It read `position('search_path=''''' in replace(body, ' ', ''))`, hunting
    -- the source spelling `set search_path = ''` in pg_get_functiondef()'s
    -- output. That output is NORMALISED: ruleutils.c emits every SET clause as
    -- ` SET <name> TO <value>`, so the body says `SET search_path TO ''` and the
    -- string `search_path=` never appears in it at all. The check therefore
    -- failed on a function that pins search_path perfectly - a false alarm, and
    -- one that would have sent a reader looking for a fault in the function
    -- rather than in the test of it.
    --
    -- proconfig is the catalogue's own record of the clause, one `name=value`
    -- entry per setting, and it does not depend on how anything is printed.
    -- Matched with LIKE rather than against the exact empty value, because the
    -- invariant that matters is that the clause is PRESENT - the value it pins
    -- to is the `set search_path = ''` on the CREATE at the head of this file.
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[]))
          as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'delete_member'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(problems, 'delete_member() does not pin search_path');
    end if;
  end if;

  -- 2f. anon cannot execute it.
  if has_function_privilege('anon', 'public.delete_member(uuid)', 'execute') then
    problems := array_append(problems, 'anon can execute delete_member()');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0032 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0032 applied: public.delete_member() is in place.';
end $$;


-- =============================================================================
-- AFTERWARDS - what the app still has to do, and what this file cannot
--
-- The server action (src/lib/admin-actions.ts, deleteMember) finishes the job
-- in this order, and the order is the point:
--
--   1. guards (admin, not self, not the last admin, typed name matches the
--      profiles.name read from THIS database, never a name posted beside it)
--   2. collect visits.photo_url for the member, before (3) deletes them
--   3. rpc('delete_member')                      <- this file
--   4. storage: remove visit-photos under the <member-id>/ prefix
--   5. auth.admin.deleteUser(member)             <- service role, last
--
-- STORAGE SITS BETWEEN THE ROWS AND THE AUTH USER because it is not
-- transactional. After the rows, so a teardown that rolls back has not already
-- destroyed the evidence; before the auth user, so the member id naming the
-- folder is still meaningful if it fails. Files with no rows are recoverable by
-- prefix; rows with no files would be a visit whose photograph vanished under a
-- teardown that never happened.
--
-- WHAT A RESTORE CANNOT BRING BACK. This is a true delete: the rows are gone
-- from the database and the objects from the bucket. docs/BACKUP-RESTORE.md is
-- the only thing that can undo it, and only from a backup taken beforehand.
--
-- ONE RESIDUE, STATED SO IT IS NOT A SURPRISE. Deleting this member's visits
-- sets institute_status_history.visit_id to null on history rows belonging to
-- OTHER reps' institutes, where one of this member's visits caused the status
-- change. The history row itself survives - only its attribution link goes.
-- That is 0011's deliberate choice (set null, never cascade, so that deleting a
-- visit cannot erase the record that an institute's status moved), and it is
-- the one place where deleting a member touches a row that is not theirs.
--
-- HOW TO CHECK AFTERWARDS
--
--   -- nothing of theirs is left
--   select 'visits' t, count(*) from public.visits where member = '<id>'
--   union all select 'plans',  count(*) from public.daily_plans where member = '<id>'
--   union all select 'targets', count(*) from public.targets where member = '<id>'
--   union all select 'owned',  count(*) from public.institutes where registered_by = '<id>'
--   union all select 'profile', count(*) from public.profiles where id = '<id>';
--
--   -- and no photographs
--   select count(*) from storage.objects
--    where bucket_id = 'visit-photos' and (storage.foldername(name))[1] = '<id>';
-- =============================================================================
