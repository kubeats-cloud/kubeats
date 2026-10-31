-- =============================================================================
-- KUbeats - migration 0068: delete_member() and a member's call-report history
--
-- BUG FIX, production. public.delete_member() (0032) refuses to delete a
-- member who ever touched a public.call_report_edits (0063) row, either
-- side of it - and tracing that down turned up a SECOND, older gap it
-- shares the same root cause with.
--
--   * the member MADE a call that an admin later edited (call_report_edits
--     .call_id -> that member's own follow_up_tasks row). delete_member()
--     has never once deleted follow_up_tasks explicitly - 0038 postdates
--     0032, and this function was simply never updated for it - so that row
--     was always left to (what used to be) step (g)'s cascade from deleting
--     the profile (follow_up_tasks_member_fkey, ON DELETE CASCADE). Two
--     different things can refuse that cascade, and a call_report_edits row
--     is only the newer of them:
--
--       - if this member also OWNS the institute the call was against, the
--         OLD step (f) (`delete from institutes where registered_by =
--         p_member`) runs BEFORE the profile delete ever reaches follow_up_
--         tasks, and institutes has its OWN RESTRICT
--         (follow_up_tasks_institute_id_fkey) - refused with 23503, and this
--         has been reachable since 0038 shipped, nothing to do with 0063 at
--         all.
--
--       - call_report_edits.call_id is deliberately NO ACTION (0063's own
--         header - "this app deletes a follow_up_tasks row today, so the
--         default NO ACTION is simply the honest answer"), because nothing
--         had ever tried to delete one until this exact path existed. Also
--         23503, also at whichever point follow_up_tasks finally gets
--         touched.
--
--   * the member WAS THE ADMIN who made an edit (call_report_edits.edited_by)
--     - deleting them should be a no-op for this table, because the column
--     is already `on delete set null` (0063) for precisely that reason. It
--     has never once fired: 0063's OWN append-only trigger
--     (call_report_edits_immutable, BEFORE UPDATE OR DELETE OR TRUNCATE FOR
--     EACH STATEMENT) intercepts the UPDATE that SET NULL action performs,
--     the same as it would intercept one typed by hand, and raises 42501
--     "Call report edit history is append-only" - which is the error an
--     admin actually sees when they try to delete such a member today.
--
-- THE FIX HAS THREE PARTS. Two match the SAME "remove vs null" split
-- delete_member()'s own header comment already draws for every other kind of
-- dependent row, and the third is the one that was always missing:
--
--   1. A call_report_edits row for a call THIS MEMBER MADE is REMOVED
--      outright, like their visits, daily_plans and targets - it is their
--      own data and it is going with them.
--
--   2. A call_report_edits row where THIS MEMBER WAS THE EDITOR is NULLED,
--      not removed - exactly institute_status_history.changed_by's shape
--      (also listed in 0032's own "left to on delete set null" list): the
--      audit row belongs to somebody ELSE's call, this member is only the
--      byline, and the row outlives them.
--
--   3. This member's own follow_up_tasks rows are now deleted EXPLICITLY,
--      and moved earlier - before the institutes they own, not after - so
--      the RESTRICT on institute_id never has anything left pointing at an
--      institute by the time that institute's own delete runs. (1) has to
--      happen first, in turn, so call_id's NO ACTION does not block this.
--
-- (1) and (2) need a way PAST the append-only trigger, because (2) is a
-- literal UPDATE and the trigger does not distinguish an app-level mutation
-- attempt from the one sanctioned teardown. So this file ALSO teaches
-- reject_call_report_edit_mutation() the one bypass: a transaction-local GUC,
-- same mechanism and naming style as 0044's `kubeats.deciding` guards
-- decide_slabs()'s own write past FO035. A GUC rather than a role check or a
-- parameter, because PostgREST has no way for a client to set a session
-- variable - `on` here can only mean the write came from inside
-- delete_member() itself.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * It does not touch call_report_edits' RLS policies or grants - still
--     admin-select, admin-insert, no update, no delete, exactly 0063's shape.
--     The bypass is a trigger-level escape hatch for ONE SECURITY DEFINER
--     function that already passed is_admin() as its first statement, not a
--     new door for anyone holding the `authenticated` role.
--   * It does not add a DELETE or UPDATE grant, and does not touch the
--     policies at all - the trigger still refuses every ordinary caller, with
--     or without the GUC, because nobody but this one function ever sets it.
--   * It does not change WHICH columns delete_member() removes versus nulls
--     anywhere else - every existing step (a)-(g) keeps its own body and
--     comments, byte for byte; only their RELATIVE ORDER moves, because the
--     new steps have to run before (f).
--   * It does not touch follow_up_tasks' own RLS, grants, or its ON DELETE
--     CASCADE from profiles - that cascade is still there and still fires,
--     it just has nothing left to do by the time (g) reaches it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: create or replace throughout, and the assertion block at
--   the foot is read-only.
--
-- VERIFIED ON THE LOCAL REHEARSAL DB ONLY. NOT APPLIED to any shared project.
--
-- DOWN
--   supabase/rollbacks/0068_delete_member_call_report_edits_down.sql restores
--   both functions to their 0032/0063 bodies - the trigger goes back to
--   raising unconditionally, and delete_member() goes back to the version
--   with no call_report_edits step at all (so deleting such a member fails
--   again, exactly as it does today).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. reject_call_report_edit_mutation() - the one bypass.
--
-- STILL `before update or delete or truncate ... for each statement` (the
-- trigger itself is untouched below) - only the FUNCTION BODY gains a first
-- check. Everything that was refused before this file is refused after it:
-- the GUC defaults to unset, and nothing but delete_member() ever sets it.
-- -----------------------------------------------------------------------------
create or replace function public.reject_call_report_edit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('kubeats.deleting_member', true), '') = 'on' then
    return null;
  end if;
  raise exception 'Call report edit history is append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_call_report_edit_mutation() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. delete_member() - one new step, (f2), between the institutes it owns (f)
--    and the profile (g). Everything else in the function is 0032's body,
--    unchanged.
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

  if p_member = v_caller then
    raise exception 'You cannot delete your own account.'
      using errcode = 'FO027';
  end if;

  if v_role = 'admin' then
    select count(*) into v_admins from public.profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception
        'That is the only admin account. Create another admin first.'
        using errcode = 'FO027';
    end if;
  end if;

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

  -- ---------------------------------------------------------------------
  -- (e2)/(e3) NEW IN 0068, and BOTH BEFORE (f), not after it - that ordering
  -- is the fix, not a style choice. `follow_up_tasks.institute_id` is ON
  -- DELETE RESTRICT (0038), so (f)'s `delete from institutes` refuses with
  -- 23503 the moment a call or reminder this member made still points at an
  -- institute they own - which was ALWAYS true (0038 postdates 0032 and this
  -- function was simply never updated for it), not only when a
  -- call_report_edits row is involved. 0063 made it worse by adding a
  -- SECOND reason that same cascade can be refused (below), but the
  -- institute_id one came first and is fixed the same way: delete this
  -- member's own follow_up_tasks rows explicitly, before (f) rather than
  -- leaving them to (g)'s cascade from profiles (0038's ON DELETE CASCADE),
  -- which runs too late to help (f) at all.
  --
  -- THE GUC STAYS ON THROUGH (g), NOT JUST THROUGH THIS BLOCK - the one bug
  -- in this fix worth writing down because it is easy to reintroduce. The
  -- trigger is `FOR EACH STATEMENT`, so it fires once per UPDATE no matter
  -- how many rows that UPDATE actually touches. Case 2 below already nulls
  -- every row where `edited_by = p_member`, so by the time (g) deletes the
  -- profile, the FK's OWN "on delete set null" action generates an UPDATE
  -- that matches ZERO rows - but it is still one UPDATE STATEMENT, the
  -- trigger still fires for it, and turning the GUC off before reaching (g)
  -- means that zero-row no-op gets refused anyway. Verified live: a version
  -- of this file that set it back to 'off' before (g) raised 42501 there,
  -- every time, regardless of how many rows case 2 had already handled.
  -- ---------------------------------------------------------------------
  if to_regclass('public.call_report_edits') is not null then
    -- `true` (is_local) means it is gone the moment this transaction ends,
    -- commit or rollback, whether or not the explicit 'off' below (after
    -- (g), not here) is ever reached.
    perform set_config('kubeats.deleting_member', 'on', true);

    -- (e2) Case 1: a call THIS MEMBER MADE. Its edit history is removed
    -- outright - their own data, going with them - before (e3) deletes the
    -- follow_up_tasks row it points to, which call_report_edits_call_id_fkey
    -- (NO ACTION, not cascade - see 0063's own header) would otherwise
    -- refuse with 23503.
    delete from public.call_report_edits
     where call_id in (
       select id from public.follow_up_tasks where member = p_member
     );
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('call_report_edits', n);

    -- (e2) Case 2: an edit THIS MEMBER MADE, as the admin. Nulled, not
    -- removed - the audit row is somebody else's call. Untracked in the
    -- receipt, same as every other on-delete-set-null column this function
    -- leaves alone (materials.uploaded_by, daily_plans.assigned_by, and so
    -- on).
    update public.call_report_edits set edited_by = null where edited_by = p_member;
  end if;

  -- (e3) This member's own calls and reminders. Explicit, not left to (g)'s
  --      cascade - see this block's own header for why that is too late for
  --      (f) to still work. Guarded by `to_regclass`, same as (e) above, so
  --      this file parses and runs against a database that predates 0038
  --      and has no follow_up_tasks table at all.
  if to_regclass('public.follow_up_tasks') is not null then
    execute 'delete from public.follow_up_tasks where member = $1' using p_member;
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('follow_up_tasks', n);
  end if;

  -- (f) The institutes they own. Only reachable now that (b), (c) and (e3)
  --     have cleared the three restrict-ing references. Cascades
  --     institute_status_history, which is correct: that table's rows are
  --     the journey of an institute, and the institute is going.
  delete from public.institutes where registered_by = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('institutes', n);

  -- (g) The profile. BEFORE the auth user, which the action deletes after this
  --     commits - see the ordering note at the head of 0032. Still inside the
  --     GUC's window from (e2): this is exactly the delete whose own FK
  --     cascade onto call_report_edits.edited_by needs the bypass.
  delete from public.profiles where id = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('profiles', n);

  if to_regclass('public.call_report_edits') is not null then
    perform set_config('kubeats.deleting_member', 'off', true);
  end if;

  return v_removed;
end;
$$;

comment on function public.delete_member(uuid) is
  'Deletes a member and every row that is theirs alone, in one transaction and '
  'in the order the foreign keys allow: visit_people, visits, daily_plans, '
  'targets, the weekly_targets archive under either name, their call-report '
  'edit history either side and their own follow_up_tasks (both 0068, in that '
  'order), the institutes they own, then the profile. Refuses with FO027 when '
  'an owned institute carries another member''s work, rather than wiping it. '
  'Does NOT touch auth.users, storage, or materials. SECURITY DEFINER with '
  'is_admin() as its first statement.';

revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Did it land?
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
begin
  -- 3a. The trigger function has the bypass, and still raises by default.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'reject_call_report_edit_mutation';

  if body is null then
    problems := array_append(problems, 'reject_call_report_edit_mutation() is missing');
  else
    if position('kubeats.deleting_member' in body) = 0 then
      problems := array_append(problems,
        'reject_call_report_edit_mutation() does not check kubeats.deleting_member');
    end if;
    if position('append-only' in body) = 0 then
      problems := array_append(problems,
        'reject_call_report_edit_mutation() no longer raises its append-only refusal');
    end if;
  end if;

  -- 3b. The trigger itself is unchanged: still a statement-level BEFORE
  --     UPDATE OR DELETE OR TRUNCATE.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.call_report_edits'::regclass
       and t.tgname = 'call_report_edits_immutable'
       and not t.tgisinternal
  ) then
    problems := array_append(problems, 'call_report_edits_immutable trigger is missing');
  end if;

  -- 3c. delete_member() still exists exactly once, is SECURITY DEFINER, still
  --     checks is_admin() and FO027, and now also reaches for
  --     call_report_edits and the same GUC.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'delete_member';

  if body is null then
    problems := array_append(problems, 'delete_member() is missing');
  else
    if not (
      select p.prosecdef
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'delete_member'
    ) then
      problems := array_append(problems, 'delete_member() is not SECURITY DEFINER');
    end if;
    if position('public.is_admin()' in body) = 0 then
      problems := array_append(problems, 'delete_member() does not check is_admin()');
    end if;
    if position('FO027' in body) = 0 then
      problems := array_append(problems, 'delete_member() does not raise FO027');
    end if;
    if position('call_report_edits' in body) = 0 then
      problems := array_append(problems,
        'delete_member() does not handle call_report_edits - 0068 did not apply');
    end if;
    if position('kubeats.deleting_member' in body) = 0 then
      problems := array_append(problems,
        'delete_member() does not set kubeats.deleting_member');
    end if;
    if position('delete from public.follow_up_tasks' in body) = 0 then
      problems := array_append(problems,
        'delete_member() does not explicitly delete follow_up_tasks');
    end if;
    -- ORDER MATTERS: follow_up_tasks has to go before institutes, or the
    -- RESTRICT on its institute_id refuses the institute delete - the exact
    -- failure this file exists to fix. `position()` on the rendered body is
    -- enough to catch a future edit that put them back the wrong way round.
    if position('delete from public.follow_up_tasks' in body)
       > position('delete from public.institutes' in body)
    then
      problems := array_append(problems,
        'delete_member() deletes follow_up_tasks AFTER institutes - the institute delete will be refused by 23503');
    end if;
  end if;

  -- 3d. The grants are untouched: authenticated can call delete_member(),
  --     nobody can call the trigger function directly.
  if not has_function_privilege(
    'authenticated', 'public.delete_member(uuid)', 'EXECUTE'
  ) then
    problems := array_append(problems, 'authenticated lost EXECUTE on delete_member()');
  end if;
  if has_function_privilege(
    'authenticated', 'public.reject_call_report_edit_mutation()', 'EXECUTE'
  ) then
    problems := array_append(problems,
      'authenticated can now call reject_call_report_edit_mutation() directly');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0068 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0068 applied: delete_member() now deletes a departing member''s own '
    'follow_up_tasks explicitly, before the institutes they own rather than '
    'after, and removes their own call-report edit history / nulls their '
    'byline on anyone else''s, using the one sanctioned bypass '
    '(kubeats.deleting_member) in reject_call_report_edit_mutation(). Every '
    'other step keeps its own body.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- rehearse: a rep logs a call against their own institute, an admin
--   -- edits it, then the rep is deleted (used to raise 23503)
--   select log_call(p_task_id := '<a call task id>', p_status_set_to := 'RSVP received');
--   select admin_update_call_report(p_task_id := '<that task id>', p_status_set_to := 'Session done');
--   select delete_member(p_member := '<that rep''s id>');
--
--   -- and the reverse: the EDITING admin is deleted instead (used to raise 42501)
--   select delete_member(p_member := '<the editing admin''s id>');
--   select edited_by from call_report_edits where call_id = '<that call task id>';  -- null
-- =============================================================================
