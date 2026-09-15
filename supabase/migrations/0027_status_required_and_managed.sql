-- =============================================================================
-- KUbeats - migration 0027: a visit must say where it left the institute,
--                           and an admin may finally write the vocabulary
--
-- ⚠⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS. ⚠⚠
--
-- THIS IS THE ONE DEPLOY-COUPLED MIGRATION IN THE WHOLE OF PHASE 2. Every other
-- file in this rework - 0023, 0024, 0025's seed aside, 0026 - was written to be
-- applied whenever was convenient. This one cannot be:
--
--   apply early    the LIVE app still offers "No change" on Log Visit, which
--                  sends a null status. Every rep who picks it is refused, and
--                  the refusal lands on a visit they have already walked to,
--                  photographed and checked in for.
--   deploy early   the new app never sends a null, so nothing breaks - but the
--                  rule is not yet enforced and a stale cached page can still
--                  file a visit with no status, which is invisible in Pending
--                  for ever.
--
-- So: apply, then deploy, close together. Deploy-first is survivable and
-- apply-first is not, which is the opposite of the usual advice and worth
-- saying out loud.
--
-- WHY THIS IS A DATABASE RULE AND NOT A FORM RULE
--
-- Stage 5 rebuilds Pending around "institutes whose CURRENT status is open".
-- A visit that sets no status contributes nothing to that - it is not a
-- follow-up owed, it is not a closed loop, it is simply absent, for ever, with
-- nothing anywhere to say it went missing. Form validation would leave that
-- reachable from a stale cached page, a replayed request or any future code
-- path. CLAUDE.md is explicit that a load-bearing rule belongs in the database.
--
-- WHY A TRIGGER AND NOT A NOT NULL
--
-- Because a NOT NULL could not be built. "No change" has been on the form since
-- 0001, so live visits carry a null status_set_to, and a column constraint is
-- validated against every existing row the moment it is added. A trigger only
-- ever sees the rows it is given.
--
-- That is not a workaround, it is the right shape: those old rows are a true
-- record of what the app asked for at the time. They stay legal, readable, and
-- countable. The rule starts now, which is what "this rule starts now" actually
-- means - the same reasoning 0018 gives for four of its five.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A visit says where it left the institute
--
-- INSERT ONLY, and that is load-bearing rather than incidental. On UPDATE this
-- would re-examine rows written years ago and refuse perfectly ordinary edits
-- to them - close_visit() updates a visit to file its report, and a visit
-- logged under "No change" in 2025 must still be able to be reported on.
--
-- The vocabulary itself is not checked here. visits_status_set_to_fk (0026)
-- already refuses a status the table does not have; this only insists that
-- there IS one.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_status_required()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status_set_to is null then
    raise exception
      'Say where this visit leaves the institute before saving it.'
      using errcode = 'FO024';
  end if;

  return new;
end;
$$;

comment on function public.enforce_status_required is
  'Rule 4, as Phase 2 stage 4b finishes it: every visit records a status. '
  'INSERT only, so the visits logged before this rule - when Log Visit offered '
  '"No change" - stay legal and readable. Raises FO024. The vocabulary is the '
  'foreign key''s business (0026); this only insists there is one.';

drop trigger if exists visits_status_required on public.visits;
create trigger visits_status_required
  before insert on public.visits
  for each row execute function public.enforce_status_required();


-- -----------------------------------------------------------------------------
-- 2. An admin may write the vocabulary
--
-- HELD BACK UNTIL NOW ON PURPOSE. 0026 converted the status columns to foreign
-- keys and deliberately added no write policies, because the app still held a
-- hard-coded catalogue at that point: a status added then would have rendered
-- as an unstyled badge, made isClosedStatus() answer false, and been refused by
-- visitSchema. Stage 4a's app-side read fixed all three, so the door can open.
--
-- INSERT and UPDATE, not DELETE. Deleting is already refused by three foreign
-- keys the moment a status has been used, and a status that has NEVER been used
-- can be deleted by... nobody, deliberately. Retiring (is_active = false) is
-- the one removal path, so there is one thing to learn rather than two, and no
-- way to discover the difference by losing something.
--
-- Renaming is an UPDATE of the primary key. institutes_status_fk and
-- visits_status_set_to_fk are ON UPDATE RESTRICT, so this policy permits the
-- attempt and the foreign keys decide: an unused status renames cleanly, one in
-- use is refused with 23503 and the app turns that into a sentence. The
-- permission and the safety are separate mechanisms, which is why neither has
-- to know about the other.
--
-- The grants are spelled out rather than inherited. 0001's blanket
-- `grant ... on all tables` was a one-time statement that cannot reach a table
-- created later, and what has covered institute_statuses since 0010 is the
-- Supabase project's default privileges - so without these, "admin-only" would
-- rest on a policy alone. 0011 makes the same point at length.
-- -----------------------------------------------------------------------------
revoke all on public.institute_statuses from authenticated;
revoke all on public.institute_statuses from anon;
grant select, insert, update on public.institute_statuses to authenticated;

-- Unchanged from 0010, restated so this file stands on its own against a fresh
-- restore. Every signed-in user READS the vocabulary: a rep needs it to render
-- a badge and to fill the status picker.
drop policy if exists institute_statuses_select on public.institute_statuses;
create policy institute_statuses_select on public.institute_statuses
  for select to authenticated
  using (true);

drop policy if exists institute_statuses_insert on public.institute_statuses;
create policy institute_statuses_insert on public.institute_statuses
  for insert to authenticated
  with check (public.is_admin());

-- BOTH HALVES SCOPED, which is the mistake 0020b caught in institutes_update
-- and the one worth not repeating: `using` decides which rows may be targeted,
-- `with check` decides what they may become. Scope only one and a non-admin has
-- a way in from the other side.
drop policy if exists institute_statuses_update on public.institute_statuses;
create policy institute_statuses_update on public.institute_statuses
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy, and no DELETE grant. See above.


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove nothing audited moved
--
-- Seven things:
--
--   the trigger exists, fires on INSERT, and ONLY on insert
--   the visits already carrying a null status are still there and still legal
--   the write policies exist and every one of them is admin-gated
--   nobody can DELETE a status through the API
--   0026's two status foreign keys still restrict both ways
--   FO016, the meeting gate and the presence guarantee are all still attached
--   campus scoping's three policies are untouched
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  nulls     integer;
  pol       record;
  name      text;
  tg        record;
begin
  -- 3a. The trigger, and its timing. A trigger that also fired on UPDATE would
  --     refuse close_visit()'s report write on any pre-0027 visit.
  select t.tgtype into tg
    from pg_trigger t
   where t.tgrelid = 'public.visits'::regclass
     and t.tgname = 'visits_status_required'
     and not t.tgisinternal;

  if not found then
    problems := problems || 'the visits_status_required trigger is missing';
  else
    -- tgtype bit 2 (value 4) is INSERT, bit 4 (16) is UPDATE, bit 3 (8) is
    -- DELETE. BEFORE is bit 0 unset... rather than decode by hand, ask the
    -- catalogue the two questions that matter.
    if (tg.tgtype & 4) = 0 then
      problems := problems || 'visits_status_required does not fire on INSERT';
    end if;
    if (tg.tgtype & 16) <> 0 then
      problems := problems
        || 'visits_status_required ALSO fires on UPDATE - it would refuse a '
           'report filed against a visit logged before this rule';
    end if;
  end if;

  -- 3b. History is untouched. This is the number that proves the rule started
  --     now rather than backwards.
  select count(*) into nulls from public.visits where status_set_to is null;

  -- 3c. The write policies, and that each is admin-gated. A policy whose
  --     expression does not mention is_admin() would be an open door.
  for name in select unnest(array['institute_statuses_insert', 'institute_statuses_update'])
  loop
    select * into pol from pg_policy
     where polname = name and polrelid = 'public.institute_statuses'::regclass;

    if not found then
      problems := problems || format('%s is missing', name);
    else
      if coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') not like '%is_admin%' then
        problems := problems || format('%s does not gate its WITH CHECK on is_admin()', name);
      end if;
      if name = 'institute_statuses_update'
         and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') not like '%is_admin%' then
        problems := problems || 'institute_statuses_update does not gate its USING on is_admin()';
      end if;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policy
     where polname = 'institute_statuses_select'
       and polrelid = 'public.institute_statuses'::regclass
  ) then
    problems := problems
      || 'institute_statuses_select has gone - no rep could render a status badge';
  end if;

  -- 3d. Nobody deletes a status through the API: no policy, and no grant.
  if exists (
    select 1 from pg_policy
     where polrelid = 'public.institute_statuses'::regclass and polcmd = 'd'
  ) then
    problems := problems
      || 'a DELETE policy exists on institute_statuses - retiring is the removal path';
  end if;
  if has_table_privilege('authenticated', 'public.institute_statuses', 'DELETE') then
    problems := problems || 'authenticated still holds DELETE on institute_statuses';
  end if;
  if not has_table_privilege('authenticated', 'public.institute_statuses', 'SELECT')
     or not has_table_privilege('authenticated', 'public.institute_statuses', 'INSERT')
     or not has_table_privilege('authenticated', 'public.institute_statuses', 'UPDATE') then
    problems := problems
      || 'authenticated is missing one of SELECT/INSERT/UPDATE on institute_statuses';
  end if;

  -- 3e. 0026's foreign keys. If either stopped restricting, an admin could
  --     delete or rename a status out from under live rows.
  for name in select unnest(array['institutes_status_fk', 'visits_status_set_to_fk'])
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = name and contype = 'f'
         and confrelid = 'public.institute_statuses'::regclass
         and confupdtype = 'r' and confdeltype = 'r'
    ) then
      problems := problems || format('%s is missing or no longer RESTRICTs both ways', name);
    end if;
  end loop;

  -- 3f. The audited triggers on visits. This file adds one to that table, which
  --     is exactly when a neighbour gets dropped by accident.
  for name in select unnest(array[
    'visits_enforce_meeting_gate',   -- Rule 2
    'visits_require_checkin',        -- the presence guarantee, FO009
    'visits_follow_up_when_open',    -- Rule 5, FO016
    'visits_photo_final'             -- Rule 12's write-once, FO008
  ])
  loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.visits'::regclass and tgname = name and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', name);
    end if;
  end loop;

  -- 3g. Campus scoping. Not touched here; asserted because it is the boundary.
  for name in select unnest(array[
    'institutes_select', 'institutes_update', 'institute_status_history_select'
  ])
  loop
    if not exists (select 1 from pg_policy where polname = name) then
      problems := problems || format('campus scoping policy %s has gone', name);
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception 'Stage 4b did not land cleanly: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'A status is now compulsory on every NEW visit (FO024). % existing visit(s) '
    'carry no status and remain legal and readable. An admin may add, rename '
    'and retire statuses; nobody may delete one. Both status foreign keys still '
    'RESTRICT, and the meeting gate, presence guarantee, FO016, the photo '
    'write-once and campus scoping are all still in place.',
    nulls;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Reading it back
--
--   -- the vocabulary an admin now maintains
--   select status, category, tone, is_active, sort_order,
--          asks_expected_date, asks_session_detail, asks_head_count
--     from public.institute_statuses order by sort_order, status;
--
--   -- visits from before the rule. Legal, readable, and the reason this is a
--   -- trigger rather than a NOT NULL.
--   select date, activity, member from public.visits
--    where status_set_to is null order by date desc;
--
--   -- whether a status can still be renamed or deleted: anything with a count
--   -- is pinned by a foreign key, and retiring is the way to remove it.
--   select s.status, s.is_active,
--          (select count(*) from public.institutes i where i.status = s.status) as institutes,
--          (select count(*) from public.visits v where v.status_set_to = s.status) as visits,
--          (select count(*) from public.institute_status_history h where h.status = s.status) as history
--     from public.institute_statuses s order by s.sort_order, s.status;
-- -----------------------------------------------------------------------------
