-- =============================================================================
-- KUbeats - migration 0042: the middle tier learns to see
--
-- ⚠ THE HIGHEST-BLAST-RADIUS FILE IN THIS PROJECT. It rewrites every policy on
-- eight tables plus profiles and the visit-photo bucket. Read section 0 before
-- changing a line of it.
--
-- Step H2 of docs/hierarchy-plan.md.
--
-- =============================================================================
-- 0. WHAT THIS DOES, AND WHY IT IS A NO-OP ON THE DAY IT LANDS
-- =============================================================================
--
-- Every predicate of the shape
--
--     member = (select auth.uid()) or public.is_admin()
--
-- becomes `public.supervises(member)`, and every institute-ownership test
--
--     public.is_admin() or (campus_id = public.my_campus()
--                           and registered_by = (select auth.uid()))
--
-- becomes `public.supervises(registered_by)`. Thirty-odd policies get SHORTER.
--
-- ⚠ WITH NO team_lead_id POPULATED, supervises(x) IS EXACTLY `x = auth.uid() or
-- is_admin()`. Its third branch matches no rows, so every policy below computes
-- what it computed before this file ran. 0041 asserts that property and the
-- integration suite measures it from outside. THAT IS WHY THIS CAN BE APPLIED
-- TO A LIVE DATABASE: nothing observable moves until H3 assigns the first rep,
-- and "it appears to have done nothing" is the evidence that it is correct.
--
-- ⚠ `campus_id = public.my_campus()` COMES OUT OF THE INSTITUTE PREDICATES, and
-- that is deliberate rather than an oversight. 0028's own comment notes the
-- campus clause "happens to be exactly the ownership rule as well"; once
-- ownership is the scope it decides nothing, and leaving it would be worse than
-- redundant. A team lead's my_campus() is their OWN campus, and TWO TEAM LEADS
-- SHARE ONE CAMPUS - the brief's own example - so a campus clause would read as
-- a boundary while drawing the wrong one. Ownership is the boundary. FO010 and
-- FO025 keep owner and campus aligned, and `enforce_profile_campus` (FO021)
-- plus FO033 keep a rep and their lead on one campus.
--
-- ⚠ WHAT THIS FILE DOES **NOT** WIDEN, each for a stated reason:
--
--   visits_insert           gains `public.is_rep()`. A team lead HAS a campus,
--   institutes_insert       so without it they could log a visit and register
--                           an institute in their own name - "does NOT log
--                           visits and does NOT own institutes" has to be said
--                           in the policy, not only in the UI.
--   visits_update           stays `member = auth.uid()`. An ADMIN cannot edit a
--                           rep's visit either; a visit is what one person
--                           recorded, and supervision is reading it.
--   visits_delete           stay `member = auth.uid() or is_admin()`, which is
--   daily_plans_delete      the ONE pair this file was corrected for. They were
--                           written as supervises(member) by the uniform
--                           substitution, which handed a team lead the power to
--                           DESTROY a rep's visit while visits_update was
--                           deliberately withholding the power to EDIT one.
--                           A lead who may not correct a record must not be
--                           able to delete it instead, and a deleted visit
--                           takes its photograph's only reference with it -
--                           FO008 makes photo_url immutable but says nothing
--                           about the row. Reading is supervision; erasing is
--                           not. See section 2 for the full reasoning.
--   institutes_delete       stays is_admin(). Deleting a school is not
--   targets_delete          supervision.
--   alert_events insert     stay refused to EVERYONE. E1's guarantee is that
--   alert_events delete     nobody can manufacture or erase a miss, and a team
--                           lead is emphatically included - the missed record
--                           is counted from exactly these rows.
--   registered_by           unchanged and needs no clause here: FO010
--                           (guard_institute_owner, 0028) already refuses the
--                           change to anyone who is not an admin, so a team
--                           lead may edit an institute's DETAILS and can never
--                           take it over or hand it on.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A safe owner test for the storage bucket
--
-- `storage.foldername(name)[1]` is TEXT and is whatever the object key happens
-- to contain. Casting it straight to uuid inside a policy raises 22P02 on any
-- object whose first segment is not one - and a policy that can throw is a
-- policy that can take a page down rather than hide a row.
--
-- So the cast is done here, in plpgsql, where it can fail to FALSE: a folder
-- that is not a member id belongs to nobody, which is the honest answer.
-- -----------------------------------------------------------------------------
create or replace function public.supervises_folder(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  begin
    v_id := p_folder::uuid;
  exception
    when others then
      return false;
  end;

  return public.supervises(v_id);
end;
$$;

comment on function public.supervises_folder is
  'supervises(), for a storage object key. The first path segment of a '
  'visit-photos object is the member id; this casts it safely, answering false '
  'rather than raising 22P02 for a key that is not one.';

revoke all on function public.supervises_folder(text) from public;
revoke all on function public.supervises_folder(text) from anon;
grant execute on function public.supervises_folder(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. The member-keyed tables
--
-- visits, daily_plans, targets, alert_events. The row names a PERSON, so the
-- predicate is supervises() of that person and nothing else - no campus clause,
-- because a person is not a place.
-- -----------------------------------------------------------------------------

-- visits ----------------------------------------------------------------------
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits
  for select to authenticated
  using (public.supervises(member));

/*
 * ⚠ `is_rep()` IS THE "A TEAM LEAD DOES NOT LOG VISITS" RULE. Unchanged for a
 * rep, who is one. Without it a team lead - who has a campus, unlike an admin -
 * could insert a visit naming themselves, and the whole of Rule 7 would start
 * counting a supervisor's desk work as fieldwork.
 */
drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert to authenticated
  with check (member = (select auth.uid()) and public.is_rep());

-- UNCHANGED, and worth saying so. An admin cannot edit a rep's visit either: a
-- visit is what one person recorded standing somewhere, and supervising it
-- means reading it.
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits
  for update to authenticated
  using (member = (select auth.uid()))
  with check (member = (select auth.uid()));

/*
 * ⚠ NOT supervises(member), AND THIS ONE WAS WRONG ON THE FIRST WRITE.
 *
 * The uniform substitution this file performs - `member = auth.uid() or
 * is_admin()` becomes supervises(member) - is correct for every predicate that
 * asks "may this person SEE it". It is wrong here, and the review caught it:
 * it handed a team lead the power to DESTROY a rep's visit ten lines under a
 * visits_update that deliberately withholds the power to EDIT one.
 *
 * A lead who may not correct a record must not be able to delete it instead.
 * The weaker verb cannot be the stronger permission.
 *
 * And a visit is the one row in this schema that is evidence. FO008
 * (visits_photo_final) makes photo_url immutable for everyone, the service
 * role included, precisely so a photograph cannot be swapped after the fact -
 * but it says nothing about the ROW, so deleting the visit is how you would
 * get rid of an inconvenient photograph without ever updating one. The
 * retention sweep then collects the orphaned object and the evidence is gone
 * with nothing to say it existed.
 *
 * So this stays exactly what 0001 wrote: the rep's own, or an admin's. Reading
 * is supervision; erasing is not.
 */
drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits
  for delete to authenticated
  using (member = (select auth.uid()) or public.is_admin());


-- daily_plans ------------------------------------------------------------------
drop policy if exists daily_plans_select on public.daily_plans;
create policy daily_plans_select on public.daily_plans
  for select to authenticated
  using (public.supervises(member));

/*
 * THE ASSIGN SCREEN, one tier down. The second branch was
 * `is_admin() and assigned_by = auth.uid()`; supervises(member) narrows it to
 * the team without changing what it means. A rep cannot reach it for anybody
 * else because supervises(other) is false for them.
 *
 * `guard_plan_assignment` (0005) needs NO change: it only enforces "assign in
 * your own name" and "planning your own day is not an assignment", neither of
 * which mentions a role.
 */
drop policy if exists daily_plans_insert on public.daily_plans;
create policy daily_plans_insert on public.daily_plans
  for insert to authenticated
  with check (
    member = (select auth.uid())
    or (public.supervises(member) and assigned_by = (select auth.uid()))
  );

drop policy if exists daily_plans_update on public.daily_plans;
create policy daily_plans_update on public.daily_plans
  for update to authenticated
  using (public.supervises(member))
  with check (public.supervises(member));

/*
 * ⚠ NOT supervises(member), for the reason visits_delete gives, and with one
 * of its own.
 *
 * A plan row is the other half of a visit's record: it carries the check-in,
 * the coordinates, the manual-location reason and the duration. Deleting it
 * destroys the presence record for a visit that still exists - and because
 * `daily_plans_one_open_visit` (FO013) is keyed on the member alone, deleting
 * an OPEN row is also how a lead would silently clear a rep's one-open-visit
 * slot, which is a write to that rep's working day dressed as housekeeping.
 *
 * A lead who needs a stuck visit cleared has the supported path: the "Still
 * checked in" panel on Overview, which goes through `checkout_missing` and
 * stamps who did it (FO020). That is the audited door, and it is an admin's.
 *
 * `daily_plans_update` IS supervises()-scoped and stays so, because that is
 * what the Assign screen writes through. Withdrawing an assignment you made is
 * an update, not a delete.
 */
drop policy if exists daily_plans_delete on public.daily_plans;
create policy daily_plans_delete on public.daily_plans
  for delete to authenticated
  using (member = (select auth.uid()) or public.is_admin());


-- targets -----------------------------------------------------------------------
drop policy if exists targets_select on public.targets;
create policy targets_select on public.targets
  for select to authenticated
  using (public.supervises(member));

-- A rep commits for themselves. Unchanged.
drop policy if exists targets_insert on public.targets;
create policy targets_insert on public.targets
  for insert to authenticated
  with check (member = (select auth.uid()));

-- Rule 6's reopen, one tier down. `enforce_target_lock` learns the middle tier
-- in section 5 - widening this alone would give a team lead a button that
-- always failed.
drop policy if exists targets_update on public.targets;
create policy targets_update on public.targets
  for update to authenticated
  using (public.supervises(member))
  with check (public.supervises(member));

-- UNCHANGED: deleting a commitment is not supervision.
drop policy if exists targets_delete on public.targets;
create policy targets_delete on public.targets
  for delete to authenticated
  using (public.is_admin());


-- alert_events --------------------------------------------------------------------
drop policy if exists alert_events_select on public.alert_events;
create policy alert_events_select on public.alert_events
  for select to authenticated
  using (public.supervises(member));

drop policy if exists alert_events_update on public.alert_events;
create policy alert_events_update on public.alert_events
  for update to authenticated
  using (public.supervises(member))
  with check (public.supervises(member));

/*
 * ⚠ STILL REFUSED TO EVERYONE, INCLUDING A TEAM LEAD, and this is the one place
 * in the file where the middle tier gains nothing.
 *
 * `kind = 'follow_ups_missed'` rows ARE the missed-follow-up record. An insert
 * grant is a way to manufacture a miss against somebody; a delete grant is a
 * way to erase one. 0040 made both impossible by withholding the GRANT as well
 * as the policy, so these two are the visible half of a refusal the privilege
 * system already enforces - re-stated here so that a reader of 0042 sees the
 * decision rather than an absence.
 */
drop policy if exists alert_events_no_insert on public.alert_events;
create policy alert_events_no_insert on public.alert_events
  for insert to authenticated
  with check (false);

drop policy if exists alert_events_no_delete on public.alert_events;
create policy alert_events_no_delete on public.alert_events
  for delete to authenticated
  using (false);


-- -----------------------------------------------------------------------------
-- 3. The institute-keyed tables
--
-- institutes and its three children. The row names a PLACE, owned by a person
-- through `registered_by`, so the predicate reaches that person - through the
-- parent for the children, exactly as 0028/0037/0038 already do.
--
-- ⚠ REACHING THROUGH THE PARENT IS NOT CEREMONY. 0020b and 0028 both call
-- institute_status_history "the quiet one": its policy reaches through
-- `institutes`, so scoping only the parent MOVES a leak rather than closing it -
-- a reader would go on reading the full status journey of every colleague's
-- institute without ever selecting from `institutes`. Same trap, one tier up.
-- -----------------------------------------------------------------------------

-- institutes -------------------------------------------------------------------
drop policy if exists institutes_select on public.institutes;
create policy institutes_select on public.institutes
  for select to authenticated
  using (public.supervises(registered_by));

-- `is_rep()`, for the reason visits_insert has it: a team lead has a campus and
-- would otherwise be able to register an institute in their own name.
drop policy if exists institutes_insert on public.institutes;
create policy institutes_insert on public.institutes
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      registered_by = (select auth.uid())
      and campus_id = public.my_campus()
      and public.is_rep()
    )
  );

/*
 * BOTH HALVES, as 0020b caught and 0028 restates: `using` decides which rows
 * may be targeted, `with check` what they may become.
 *
 * A team lead may edit their reps' institutes and can NEVER take one over:
 * FO010 (guard_institute_owner, 0028) refuses any `registered_by` change to a
 * caller who is not an admin, so the `with check` needs no owner clause of its
 * own and gains no hole from not having one.
 */
drop policy if exists institutes_update on public.institutes;
create policy institutes_update on public.institutes
  for update to authenticated
  using (public.supervises(registered_by))
  with check (public.supervises(registered_by));

-- UNCHANGED: removing a school from the registry is not supervision.
drop policy if exists institutes_delete on public.institutes;
create policy institutes_delete on public.institutes
  for delete to authenticated
  using (public.is_admin());


-- institute_status_history ------------------------------------------------------
drop policy if exists institute_status_history_select on public.institute_status_history;
create policy institute_status_history_select on public.institute_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and public.supervises(i.registered_by)
    )
  );


-- follow_up_tasks ---------------------------------------------------------------
--
-- FO031 is unchanged and still correct: a task's institute must belong to the
-- MEMBER it is for, which stops a team lead creating a task for themselves
-- against a rep's institute.
drop policy if exists follow_up_tasks_select on public.follow_up_tasks;
create policy follow_up_tasks_select on public.follow_up_tasks
  for select to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists follow_up_tasks_insert on public.follow_up_tasks;
create policy follow_up_tasks_insert on public.follow_up_tasks
  for insert to authenticated
  with check (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists follow_up_tasks_update on public.follow_up_tasks;
create policy follow_up_tasks_update on public.follow_up_tasks
  for update to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  )
  with check (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists follow_up_tasks_delete on public.follow_up_tasks;
create policy follow_up_tasks_delete on public.follow_up_tasks
  for delete to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );


-- institute_counsellors ----------------------------------------------------------
drop policy if exists institute_counsellors_select on public.institute_counsellors;
create policy institute_counsellors_select on public.institute_counsellors
  for select to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists institute_counsellors_insert on public.institute_counsellors;
create policy institute_counsellors_insert on public.institute_counsellors
  for insert to authenticated
  with check (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists institute_counsellors_update on public.institute_counsellors;
create policy institute_counsellors_update on public.institute_counsellors
  for update to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  )
  with check (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists institute_counsellors_delete on public.institute_counsellors;
create policy institute_counsellors_delete on public.institute_counsellors
  for delete to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );


-- -----------------------------------------------------------------------------
-- 4. profiles, and the visit-photo bucket
--
-- ⚠ THE TWO EVERYBODY FORGETS, and they fail in opposite ways.
--
-- profiles_select too narrow leaks nothing and breaks every name: admin-workspace.ts
-- falls back to the string "Unknown" in five places, so a team lead's Review,
-- Assign and Overview would render a column of "Unknown" and look like a data
-- fault rather than a policy one.
--
-- The storage bucket is a SEPARATE POLICY SYSTEM. Table access without object
-- access gives a team lead a Review screen of broken images and no error
-- anywhere. Verify it by opening a real photo, not by reading the policy.
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.supervises(id));

/*
 * profiles_update is UNCHANGED - `id = auth.uid() or is_admin()`.
 *
 * A team lead does not rename or re-campus their reps in H2; the one column
 * they may write is `team_lead_id`, and that arrives in H3 as a SECURITY
 * DEFINER RPC guarded by FO033 clause (e), not as a widened policy. Widening it
 * here would hand a team lead every column on their reps' rows - role included -
 * which `guard_profile_role` would then have to be the only thing standing in
 * front of.
 */

drop policy if exists visit_photos_select on storage.objects;
create policy visit_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and public.supervises_folder((storage.foldername(name))[1])
  );


-- -----------------------------------------------------------------------------
-- 5. Two triggers that would otherwise go out of step with the policies
--
-- A policy that permits and a trigger that refuses is worse than either: the
-- control appears, the reader presses it, and the failure names a rule they
-- cannot see.
-- -----------------------------------------------------------------------------

/*
 * Rule 6's reopen. targets_update now lets a team lead write their rep's row;
 * without this the trigger still answers "Only an admin can reopen".
 */
create or replace function public.enforce_target_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A row created already submitted still gets its timestamp.
    if new.locked and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if old.locked then
    if new.locked then
      raise exception
        'This target period is locked. Ask an admin to reopen it before editing.'
        using errcode = 'check_violation';
    end if;

    /*
     * ⚠ THE ONE LINE THAT CHANGES, and everything around it is 0013's verbatim.
     *
     * It read `if not public.is_admin()`. A team lead reopens THEIR OWN REP'S
     * week and nobody else's — `supervises(new.member)` rather than
     * `is_team_lead()`, because targets_update has already narrowed which rows
     * can be reached and a trigger that trusted that would be one RLS mistake
     * away from letting any lead reopen any week. Asking the same question the
     * policy asks costs one call and means the two cannot disagree.
     *
     * `or public.is_rep()` is what keeps a rep out: supervises() is true for
     * one's own row, so without it a rep could reopen the week they submitted
     * and Rule 6's lock would mean nothing.
     *
     * The service role still passes, as it always did — it has no auth.uid(),
     * so is_admin() was false for it before too and the reopen path was never
     * reachable without a caller. Left exactly as it was.
     */
    if not public.supervises(new.member) or public.is_rep() then
      raise exception
        'Only an admin or your team lead can reopen a locked target period.'
        using errcode = 'insufficient_privilege';
    end if;

    new.reopened_by := (select auth.uid());
    new.reopened_at := now();
    return new;
  end if;

  if new.locked then
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_target_lock is
  'Rule 6 for public.targets, for every period. Stamps submitted_at and the '
  'reopen credentials itself so the audit trail cannot be forged by a client. '
  'Since 0042 a team lead may reopen their own rep''s week; a rep may not '
  'reopen their own.';

drop trigger if exists targets_enforce_lock on public.targets;
create trigger targets_enforce_lock
  before insert or update on public.targets
  for each row execute function public.enforce_target_lock();

/*
 * FO030's allowance. "An admin edits without limit and without spending
 * anything" - a team lead is the same kind of reader, and an edit of theirs
 * must not cost the rep their one correction. institutes_update has already
 * narrowed them to their own team, so is_team_lead() is enough here.
 */
create or replace function public.guard_rep_institute_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := (select auth.uid());
  v_changed boolean;
begin
  -- No caller: a restore, a seed, or the SQL editor. Not a rep's correction.
  if v_caller is null then
    return new;
  end if;

  /*
   * ⚠ THE ONE LINE 0042 CHANGES. Everything else in this function is 0036's,
   * lifted verbatim rather than retyped — the counter reset in the `not
   * v_changed` branch is what stops a client sending `rep_edits_used = 0`, and
   * rewriting this from memory is how that gets lost.
   *
   * A team lead reads like an admin here: their edit is unlimited and must not
   * cost the rep their one correction. `institutes_update` has already narrowed
   * them to their own team, so is_team_lead() is enough — a lead cannot reach
   * another team's institute to edit it at all.
   */
  if public.is_admin() or public.is_team_lead() then
    return new;
  end if;

  /*
   * DID ANY EDITABLE DETAIL ACTUALLY CHANGE?
   *
   * The trigger's own `update of` list already decided that one of these
   * columns is in the SET list; this decides whether its VALUE moved. Without
   * it, a form re-saved unchanged - or a statement that lists a column and
   * assigns it its current value - would spend the allowance for nothing.
   *
   * `is distinct from` rather than `<>` throughout, so a null on either side
   * compares correctly; most of these columns are nullable.
   *
   * The list is exactly instituteSchema's editable set. NOT `status`,
   * `status_updated_at`, `status_updated_by`, `registered_by` or `campus_id` -
   * see this file's header for why `status` in particular must never appear.
   */
  v_changed :=
       new.name                       is distinct from old.name
    or new.type                       is distinct from old.type
    or new.pincode                    is distinct from old.pincode
    or new.address                    is distinct from old.address
    or new.area                       is distinct from old.area
    or new.city                       is distinct from old.city
    or new.state                      is distinct from old.state
    or new.boards                     is distinct from old.boards
    or new.principal_name             is distinct from old.principal_name
    or new.principal_mobile           is distinct from old.principal_mobile
    or new.decision_maker_name        is distinct from old.decision_maker_name
    or new.decision_maker_designation is distinct from old.decision_maker_designation
    or new.decision_maker_mobile      is distinct from old.decision_maker_mobile
    or new.class11                    is distinct from old.class11
    or new.class12                    is distinct from old.class12;

  if not v_changed then
    -- Nothing moved. Leave the counter exactly as it was, including any
    -- attempt to rewrite it - see the stamp below.
    new.rep_edits_used := old.rep_edits_used;
    new.rep_edited_at  := old.rep_edited_at;
    new.rep_edited_by  := old.rep_edited_by;
    return new;
  end if;

  -- The allowance, spent once per institute.
  if old.rep_edits_used >= 1 then
    raise exception
      'You have already made your one correction to this institute. Ask an admin for any further changes.'
      using errcode = 'FO030';
  end if;

  /*
   * STAMPED HERE, NEVER TRUSTED FROM THE CLIENT.
   *
   * Assigning all three unconditionally is what makes a hand-written
   * `rep_edits_used = 0` in the payload irrelevant: whatever the client sent is
   * overwritten with the computed value before the row is written.
   */
  new.rep_edits_used := 1;
  new.rep_edited_at  := now();
  new.rep_edited_by  := v_caller;

  return new;
end;
$$;

drop trigger if exists institutes_rep_edit_guard on public.institutes;
create trigger institutes_rep_edit_guard
  before update of
    name, type, pincode, address, area, city, state, boards,
    principal_name, principal_mobile,
    decision_maker_name, decision_maker_designation, decision_maker_mobile,
    class11, class12
  on public.institutes
  for each row execute function public.guard_rep_institute_edit();


-- -----------------------------------------------------------------------------
-- 6. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  pol      record;
  n        integer;
  body     text;
  t        text;
begin
  -- 6a. EVERY policy that should now ask supervises() does.
  --     Named one by one rather than counted, so a failure says which.
  for pol in
    select tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and tablename in (
         'visits', 'daily_plans', 'targets', 'alert_events',
         'institutes', 'institute_status_history',
         'follow_up_tasks', 'institute_counsellors', 'profiles'
       )
  loop
    -- The ones that are deliberately NOT supervises()-scoped.
    --
    -- ⚠ visits DELETE and daily_plans DELETE are on this list by CORRECTION,
    -- not by original design - see section 2. They are asserted positively in
    -- 6c, because an exemption here only stops a complaint; it is 6c that
    -- refuses to let the widening come back.
    continue when (pol.tablename = 'visits' and pol.cmd in ('INSERT', 'UPDATE', 'DELETE'));
    continue when (pol.tablename = 'daily_plans' and pol.cmd = 'DELETE');
    continue when (pol.tablename = 'targets' and pol.cmd in ('INSERT', 'DELETE'));
    continue when (pol.tablename = 'institutes' and pol.cmd in ('INSERT', 'DELETE'));
    continue when (pol.tablename = 'alert_events' and pol.cmd in ('INSERT', 'DELETE'));
    continue when (pol.tablename = 'profiles' and pol.cmd <> 'SELECT');

    if coalesce(pol.qual, '') || coalesce(pol.with_check, '') not like '%supervises%' then
      problems := array_append(problems, format(
        '%s.%s (%s) does not call supervises() - the middle tier cannot see through it',
        pol.tablename, pol.policyname, pol.cmd));
    end if;
  end loop;

  /*
   * 6b. ⚠ THE CAMPUS CLAUSE IS OUT OF THE INSTITUTE PREDICATES.
   *
   * Leaving it would be the leak this whole migration exists to close: two team
   * leads SHARE a campus, so a surviving my_campus() clause reads as a boundary
   * while drawing the wrong one. institutes_insert keeps it on purpose - a rep
   * still registers into their own campus and only their own.
   */
  for pol in
    select tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and tablename in ('institutes', 'institute_status_history',
                         'follow_up_tasks', 'institute_counsellors')
       and not (tablename = 'institutes' and cmd in ('INSERT', 'DELETE'))
  loop
    if coalesce(pol.qual, '') || coalesce(pol.with_check, '') like '%my_campus%' then
      problems := array_append(problems, format(
        '%s.%s still tests my_campus() - two team leads share a campus, so that is the wrong boundary',
        pol.tablename, pol.policyname));
    end if;
  end loop;

  /*
   * 6c. THE ONES THAT MUST NOT HAVE WIDENED.
   *
   * ⚠ THE TWO DELETES ARE CHECKED POSITIVELY: they must test auth.uid() and
   * must NOT test supervises(). Asserting only the absence of supervises()
   * would pass a policy rewritten to `using (true)`, and asserting only the
   * presence of auth.uid() would pass `auth.uid() is not null`. Both halves,
   * for the reason 0020b gives about using/with_check.
   *
   * This is the assertion the review's finding earns. The uniform substitution
   * is right for every reader predicate in this file and wrong for these two,
   * so the next person applying a sweeping change needs the file itself to
   * refuse rather than a comment asking them not to.
   */
  for pol in
    select tablename, policyname, cmd, qual from pg_policies
     where schemaname = 'public'
       and cmd = 'DELETE'
       and tablename in ('visits', 'daily_plans')
  loop
    if coalesce(pol.qual, '') like '%supervises%' then
      problems := array_append(problems, format(
        '%s.%s calls supervises() - a team lead could DESTROY a rep''s record '
        'while being refused permission to EDIT it',
        pol.tablename, pol.policyname));
    end if;

    if coalesce(pol.qual, '') not like '%auth.uid()%'
       or coalesce(pol.qual, '') not like '%is_admin%' then
      problems := array_append(problems, format(
        '%s.%s is not "the member''s own row, or an admin" - it reads: %s',
        pol.tablename, pol.policyname, coalesce(pol.qual, '(null)')));
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'visits' and cmd = 'INSERT'
       and with_check like '%is_rep%'
  ) then
    problems := array_append(
      problems,
      'visits_insert does not require is_rep() - a team lead could log a visit in their own name');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'institutes' and cmd = 'INSERT'
       and with_check like '%is_rep%'
  ) then
    problems := array_append(
      problems,
      'institutes_insert does not require is_rep() - a team lead could register an institute');
  end if;

  for pol in
    select policyname, cmd, qual, with_check from pg_policies
     where schemaname = 'public' and tablename = 'alert_events'
       and cmd in ('INSERT', 'DELETE')
  loop
    if coalesce(pol.qual, pol.with_check, '') not like '%false%' then
      problems := array_append(problems, format(
        'alert_events %s is no longer a flat refusal - a miss could be manufactured or erased', pol.cmd));
    end if;
  end loop;

  -- 6d. The storage bucket, which is a separate policy system and the one most
  --     easily forgotten. Without it a team lead gets broken images, silently.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'visit_photos_select'
       and qual like '%supervises_folder%'
  ) then
    problems := array_append(
      problems,
      'visit_photos_select does not call supervises_folder() - a team lead would see broken images with no error');
  end if;

  -- 6e. supervises_folder() itself: one overload, definer, search_path pinned.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'supervises_folder';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 supervises_folder, found %s', n));
  else
    if not (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'supervises_folder') then
      problems := array_append(problems, 'supervises_folder() is not SECURITY DEFINER');
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
       where ns.nspname = 'public' and p.proname = 'supervises_folder'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(problems, 'supervises_folder() does not pin search_path');
    end if;
  end if;

  -- 6f. The two triggers that had to learn the middle tier, and the rules they
  --     sit beside which must still be standing.
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_target_lock';
  if body is null or position('supervises' in body) = 0 then
    problems := array_append(
      problems,
      'enforce_target_lock() does not call supervises() - a team lead would see a reopen button that always fails');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_rep_institute_edit';
  if body is null or position('is_team_lead' in body) = 0 then
    problems := array_append(
      problems,
      'guard_rep_institute_edit() does not exempt a team lead - their edit would spend the rep''s one allowance');
  end if;

  foreach t in array array[
    'institutes_rep_edit_guard', 'institutes_guard_owner', 'targets_enforce_lock'
  ] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = t and not tgisinternal
    ) then
      -- Reported rather than fatal: trigger names have moved before (0018
      -- renamed the presence guarantee), so this names what to go and look at.
      raise notice '0042 note: trigger % not found under that name - check it was not lost.', t;
    end if;
  end loop;

  -- 6g. RLS is still ON everywhere. A policy on a table with RLS disabled is
  --     inert, and that mistake looks exactly like success.
  foreach t in array array[
    'visits', 'daily_plans', 'targets', 'alert_events', 'institutes',
    'institute_status_history', 'follow_up_tasks', 'institute_counsellors',
    'profiles'
  ] loop
    if not (select c.relrowsecurity from pg_class c
              join pg_namespace ns on ns.oid = c.relnamespace
             where ns.nspname = 'public' and c.relname = t) then
      problems := array_append(problems, format(
        'row level security is NOT enabled on %s - every policy on it is inert', t));
    end if;
  end loop;

  -- 6h. The rules the whole app leans on, unchanged by this file.
  if not exists (
    select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
     where cl.relname = 'daily_plans_one_open_visit' and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - FO013 no longer holds');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0042 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0042 applied: every supervision predicate now reads supervises(); campus is out of the institute boundary; visits and institutes stay rep-only to insert; alert_events stays unwritable; visits_delete and daily_plans_delete stay the rep''s own or an admin''s, so supervision reads a record and never erases one. NOTHING MOVES until a team_lead_id is set.';
end $$;


-- =============================================================================
-- Afterwards, to see that it is a no-op
--
--   -- still nobody assigned, so every predicate is the old one
--   select count(*) from public.profiles where team_lead_id is not null;   -- 0
--
--   -- and the shape of what changed
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public'
--      and (qual like '%supervises%' or with_check like '%supervises%')
--    order by tablename, cmd;
-- =============================================================================
