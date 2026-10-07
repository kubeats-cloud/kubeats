-- =============================================================================
-- KUbeats - migration 0044: admission slabs
--
-- ✅ ADDITIVE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- One table, four policies, two functions and one RPC pair. Nothing existing is
-- rewritten; the live app, which knows none of it, is unaffected.
--
-- =============================================================================
-- WHAT A SLAB IS, AND WHAT IT IS NOT YET
-- =============================================================================
--
-- A slab is a RANGE OF ADMISSION COUNTS against an institute. Per institute
-- there are two kinds of scope, and they are different shapes rather than two
-- values of one thing:
--
--   PROGRAM-WISE   one set per (College, Program) pair.
--   TOTAL          one set for the institute, across all programs, carrying no
--                  College and no Program at all.
--
-- ⚠ THE ADMISSION-COUNT NUMBER HAS NO SOURCE YET. Nothing in this schema reads
-- a real count and decides which slab applies — that is deliberately deferred,
-- so this file stores the RANGES and nothing consumes them. No column holds a
-- current count, no function picks a slab, and no screen shows "you are in slab
-- 3". When the number arrives it joins on (institute, scope, college, program)
-- and reads `start_count`/`end_count`; until then anything that pretended to
-- know would be inventing data.
--
-- =============================================================================
-- THE SET IS THE UNIT, NOT THE ROW
-- =============================================================================
--
-- Slabs in one scope are a CONTIGUOUS COVER: Start and End inclusive, the next
-- starting at the previous End + 1, and exactly one open-ended slab at the end.
-- That makes a half-edited set invalid by definition — set the first slab's End
-- without adding the next and there is a gap; add the next without closing the
-- first and there are two open-ended ones.
--
-- ⚠ SO A ROW-LEVEL TRIGGER CANNOT ENFORCE IT. Any sequence of single-row writes
-- passes through states the rules forbid, so a trigger validating each write
-- would make a legal edit impossible. The whole SET is therefore replaced in one
-- call — `save_slabs()` — which validates the array and then deletes and
-- inserts inside one transaction. The intermediate state never exists.
--
-- What IS enforced per row, because it is true of a row on its own:
--   * end_count is null or >= start_count          (slab_range_ordered)
--   * start_count >= 0                             (slab_start_non_negative)
--   * scope 'total' carries no college or program, 'program' carries both
--                                                  (slab_scope_shape)
--   * exactly one open-ended slab per set          (slab_one_open_ended, a
--                                                   partial unique index)
--
-- =============================================================================
-- STATUS, AND WHY THERE IS NO "REVOKED"
-- =============================================================================
--
--   pending    the rep has submitted it; still editable by them.
--   approved   frozen. The institute counts as EMPANELLED.
--   rejected   editable again, with the approver's note attached.
--
-- REVOKING AN APPROVED SET REUSES 'rejected', deliberately, and the client
-- asked for it that way: a revoked set is one the rep must edit and resubmit,
-- which is exactly what a rejected set is. A fourth status would be a second
-- name for one state, and every screen and query would have to learn it.
--
-- ⚠ REVOKE MOVES THE WHOLE SCOPE'S SET. Revoking one slab of a contiguous cover
-- would leave a gap — which the rules above forbid — so the set moves together.
-- `decide_slabs()` has no single-row form for that reason.
--
-- EMPANELLED IS COMPUTED, NEVER STORED. `public.institute_is_empanelled()` asks
-- whether any approved slab exists; revoking the last one drops the badge with
-- no second write and nothing to go stale. A column would be a cached answer
-- that the revoke path would have to remember to clear.
--
-- APPROVAL IS ADMIN-ONLY. The brief asked for a team lead to approve their own
-- team's and the client chose otherwise, so `decide_slabs()` tests is_admin()
-- and nothing else. The hook for widening it later is one predicate: swap
-- is_admin() for `is_admin() or supervises(i.registered_by)`, which is the
-- shape every policy in 0042 already uses. Said here because the brief and the
-- code disagree on purpose, and the next reader deserves to know which won.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------
create table if not exists public.institute_slabs (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references public.institutes (id) on delete cascade,

  -- 'program' carries a College and a Program; 'total' carries neither.
  scope         text not null,
  college       text,
  program       text,

  start_count   integer not null,
  -- NULL IS THE OPEN-ENDED LAST SLAB, not a missing value. "1200 and above" is
  -- the shape the client's own sheet uses, and a sentinel like 999999 would be
  -- a number somebody eventually compares against.
  end_count     integer,

  status        text not null default 'pending',
  -- Why it was rejected or revoked. The rep reads this before resubmitting, so
  -- it is the one field here written by an approver.
  note          text,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,

  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint slab_scope_valid check (scope in ('program', 'total')),
  constraint slab_status_valid check (status in ('pending', 'approved', 'rejected')),

  /*
   * THE SHAPE OF EACH SCOPE, as a constraint rather than a convention.
   *
   * `else false` is not decoration: a CHECK only rejects FALSE, so a CASE with
   * no ELSE lets an unrecognised scope through. 0001's
   * visits_lifecycle_matches_activity documents the same trap and 0013 repeats
   * it; this is the third place it would have bitten.
   */
  constraint slab_scope_shape check (
    case scope
      when 'total'   then college is null and program is null
      when 'program' then btrim(coalesce(college, '')) <> ''
                      and btrim(coalesce(program, '')) <> ''
      else false
    end
  ),

  constraint slab_range_ordered check (end_count is null or end_count >= start_count),
  constraint slab_start_non_negative check (start_count >= 0),
  constraint slab_note_length check (note is null or length(note) <= 500)
);

comment on table public.institute_slabs is
  'Admission-count ranges per institute, in two scopes: program-wise (College '
  '+ Program) and total. A SET is the unit - contiguous, inclusive, exactly one '
  'open-ended slab at the end - so it is replaced whole by save_slabs() rather '
  'than edited row by row. The admission-count NUMBER has no source yet and '
  'nothing here reads one.';

comment on column public.institute_slabs.end_count is
  'NULL is the open-ended last slab ("1200 and above"), never a missing value. '
  'A sentinel would be a number somebody eventually compares against.';

comment on column public.institute_slabs.status is
  'pending (submitted, still editable) | approved (frozen; the institute counts '
  'as empanelled) | rejected (editable again, with the note). A REVOKED set is '
  'moved to rejected: a revoked set is one the rep must edit and resubmit, '
  'which is what rejected already means.';

/*
 * ⚠ EXACTLY ONE OPEN-ENDED SLAB PER SET, as an index rather than a trigger.
 *
 * Partial on `end_count is null`, which is the open-ended predicate - the same
 * shape daily_plans_one_open_visit uses for "one open visit per rep", and for
 * the same reason: the constraint is about a SUBSET of the rows, and a unique
 * index over the whole table would forbid the ordinary case.
 *
 * coalesce() on the two nullable key columns because NULL is distinct from NULL
 * in a unique index — without it the 'total' scope, whose college and program
 * are both null, would permit any number of open-ended slabs.
 */
create unique index if not exists slab_one_open_ended
  on public.institute_slabs (
    institute_id, scope, coalesce(college, ''), coalesce(program, '')
  )
  where end_count is null;

-- Every read is "the slabs for this institute", and the admin queue asks for
-- one status across institutes.
create index if not exists slab_by_institute
  on public.institute_slabs (institute_id, scope);

create index if not exists slab_pending
  on public.institute_slabs (status)
  where status = 'pending';


-- -----------------------------------------------------------------------------
-- 2. RLS - the same predicate the institute itself carries, reached through it
--
-- IDENTICAL IN SHAPE TO institute_counsellors (0037) and follow_up_tasks
-- (0038), narrowed by 0042 to supervises(). 0028 section 2 names the trap: a
-- child table whose policy does not reach through the parent lets a reader see
-- rows belonging to an institute they cannot select, so tightening only the
-- parent MOVES a leak rather than closing it.
--
-- ⚠ WRITES ARE THE RPCs', NOT THE POLICIES'. insert/update/delete are granted
-- so `save_slabs()` can run SECURITY INVOKER — which is what keeps RLS applying
-- inside it, the rule CLAUDE.md states for log_visit() and close_visit(). What
-- stops a rep approving their own slabs is not a policy; it is that `status`,
-- `decided_by` and `decided_at` are stamped by decide_slabs() and overwritten by
-- a trigger on any other path. See section 4.
-- -----------------------------------------------------------------------------
alter table public.institute_slabs enable row level security;

revoke all on public.institute_slabs from authenticated;
revoke all on public.institute_slabs from anon;
grant select, insert, update, delete on public.institute_slabs to authenticated;

drop policy if exists institute_slabs_select on public.institute_slabs;
create policy institute_slabs_select on public.institute_slabs
  for select to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists institute_slabs_insert on public.institute_slabs;
create policy institute_slabs_insert on public.institute_slabs
  for insert to authenticated
  with check (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );

drop policy if exists institute_slabs_update on public.institute_slabs;
create policy institute_slabs_update on public.institute_slabs
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

drop policy if exists institute_slabs_delete on public.institute_slabs;
create policy institute_slabs_delete on public.institute_slabs
  for delete to authenticated
  using (
    exists (
      select 1 from public.institutes i
      where i.id = institute_id and public.supervises(i.registered_by)
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Empanelled, computed
--
-- ⚠ NEVER STORED. A column would be a cached answer, and the revoke path would
-- have to remember to clear it — which is exactly the kind of second write that
-- goes missing and leaves a badge on an institute that has nothing approved.
-- Asking the question costs one indexed lookup.
--
-- SECURITY INVOKER, deliberately: the caller should see "empanelled" only for an
-- institute they can read, and RLS already decides that. A definer here would
-- answer for institutes the reader cannot see, which is a one-bit leak.
-- -----------------------------------------------------------------------------
create or replace function public.institute_is_empanelled(p_institute uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.institute_slabs s
    where s.institute_id = p_institute
      and s.status = 'approved'
  );
$$;

comment on function public.institute_is_empanelled is
  'True when the institute has at least one APPROVED slab. Computed on every '
  'read and never stored, so revoking the last approved set drops the badge '
  'with no second write. SECURITY INVOKER so it answers only for institutes the '
  'caller may read.';

revoke all on function public.institute_is_empanelled(uuid) from public;
revoke all on function public.institute_is_empanelled(uuid) from anon;
grant execute on function public.institute_is_empanelled(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. FO035 - a rep cannot approve their own slabs
--
-- `institute_slabs_update` lets a rep write any column on a row they own, which
-- is what `save_slabs()` needs. Without this they could POST status='approved'
-- and empanel themselves.
--
-- THE SAME SHAPE guard_checkout_missing() (FO020) and guard_rep_institute_edit()
-- (FO030) both use, and the same lesson: deleting a button never closes the path
-- behind it. The three decision columns are stamped by decide_slabs() and reset
-- by this trigger on every other path, so what a client sends is irrelevant.
-- -----------------------------------------------------------------------------
create or replace function public.guard_slab_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  /*
   * ⚠ DELETE IS GUARDED TOO, and it was not at first.
   *
   * `institute_slabs_delete` lets a rep remove rows on their own institute —
   * which save_slabs() needs in order to replace a set. Without this clause a
   * rep could delete an APPROVED set outright: the empanelled badge drops, the
   * approver's record goes with it, and nothing refuses or reports it. "An
   * approved set is frozen" has to mean frozen against every verb, not only the
   * two a BEFORE INSERT OR UPDATE trigger sees.
   *
   * An ADMIN may delete one — removing a set is an administrative act, and they
   * can revoke it first in any case. save_slabs() reaches here only for a set
   * that is NOT approved, because it refuses an approved one before deleting.
   */
  if tg_op = 'DELETE' then
    if caller is not null
       and old.status = 'approved'
       and not public.is_admin() then
      raise exception
        'These slabs are approved and cannot be removed. Ask an admin to revoke them first.'
        using errcode = 'FO035';
    end if;
    return old;
  end if;

  -- No caller: a restore, a seed, or decide_slabs() is not in play. The service
  -- role and the SQL editor are trusted contexts, the exemption FO022, FO023,
  -- FO028 and FO031 all carry.
  if caller is null then
    return new;
  end if;

  /*
   * decide_slabs() sets this GUC for the length of its transaction. It is the
   * ONE path allowed to move a status, and it checks is_admin() first.
   *
   * A GUC rather than a column flag because it cannot be sent by a client:
   * PostgREST has no way to set a session variable, so `on` here means the
   * write came from inside that function.
   */
  if coalesce(current_setting('kubeats.deciding', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new or resubmitted set is always pending, whatever was sent.
    new.status := 'pending';
    new.note := null;
    new.decided_by := null;
    new.decided_at := null;
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception
      'Only an admin can approve, reject or revoke slabs.'
      using errcode = 'FO035';
  end if;

  -- An APPROVED set is frozen. Editing it is revoking it first, which is an
  -- admin's act — so a rep changing a range here is refused rather than
  -- silently un-approving their own work.
  if old.status = 'approved' then
    raise exception
      'These slabs are approved and cannot be edited. Ask an admin to revoke them first.'
      using errcode = 'FO035';
  end if;

  -- Whatever else moved, the decision columns did not.
  new.note := old.note;
  new.decided_by := old.decided_by;
  new.decided_at := old.decided_at;

  return new;
end;
$$;

comment on function public.guard_slab_decision is
  'FO035 - a rep submits slabs and never decides them. Forces a new row to '
  'pending, refuses a status change outside decide_slabs(), and freezes an '
  'approved set. Exempts the service role, which has no caller.';

revoke all on function public.guard_slab_decision() from public;
revoke all on function public.guard_slab_decision() from anon;

drop trigger if exists institute_slabs_guard_decision on public.institute_slabs;
create trigger institute_slabs_guard_decision
  before insert or update or delete on public.institute_slabs
  for each row execute function public.guard_slab_decision();


-- -----------------------------------------------------------------------------
-- 5. save_slabs() - the whole set, validated and replaced in one transaction
--
-- ⚠ SECURITY INVOKER, so RLS and every trigger still apply inside it. That is
-- the rule CLAUDE.md states for log_visit() and close_visit(), and the reason is
-- the same one campus scoping gave: a DEFINER rewrite would punch a hole
-- straight through the boundary 0042 just drew.
--
-- THE VALIDATION IS HERE AND IN THE APP, both, which the client asked for. The
-- app's copy turns a mistake into a sentence beside the field; this one is what
-- holds against a hand-rolled request. They are two statements of one rule, and
-- `tests/unit/slabs.test.ts` checks the TypeScript against the same cases.
-- -----------------------------------------------------------------------------
create or replace function public.save_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_slabs     jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count   integer;
  v_prev_end integer;
  v_start   integer;
  v_end     integer;
  v_i       integer;
  v_owner   uuid;
begin
  if p_institute is null then
    raise exception 'No institute was named.' using errcode = 'FO036';
  end if;

  if p_scope not in ('program', 'total') then
    raise exception 'A slab set is either program-wise or total.' using errcode = 'FO036';
  end if;

  -- The scope's shape, said before anything is written so the message names the
  -- field rather than arriving as a constraint violation.
  if p_scope = 'total' and (btrim(coalesce(p_college, '')) <> '' or btrim(coalesce(p_program, '')) <> '') then
    raise exception
      'A total slab set covers every programme, so it carries no college or programme.'
      using errcode = 'FO036';
  end if;

  if p_scope = 'program'
     and (btrim(coalesce(p_college, '')) = '' or btrim(coalesce(p_program, '')) = '') then
    raise exception
      'A program-wise slab set needs both a college and a programme.'
      using errcode = 'FO036';
  end if;

  if jsonb_typeof(p_slabs) <> 'array' then
    raise exception 'Slabs must be a list.' using errcode = 'FO036';
  end if;

  /*
   * ⚠ AN APPROVED SET IS FROZEN, AND THIS IS WHERE THAT IS ENFORCED FOR THIS
   * PATH. The integration suite caught its absence.
   *
   * FO035 is `before insert or update` and this function REPLACES — delete then
   * insert — so the approved rows were removed by a statement the trigger never
   * saw, and the inserts that followed were new rows, legitimately pending. The
   * rep silently un-approved their own work, which is exactly what the freeze
   * exists to stop, through the one mechanism that makes set-editing possible
   * at all.
   *
   * Checked before anything is deleted, so a refusal leaves the set whole.
   */
  if exists (
    select 1 from public.institute_slabs s
     where s.institute_id = p_institute
       and s.scope = p_scope
       and coalesce(s.college, '') = coalesce(p_college, '')
       and coalesce(s.program, '') = coalesce(p_program, '')
       and s.status = 'approved'
  ) then
    raise exception
      'These slabs are approved and cannot be edited. Ask an admin to revoke them first.'
      using errcode = 'FO035';
  end if;

  v_count := jsonb_array_length(p_slabs);
  if v_count = 0 then
    raise exception 'Add at least one slab.' using errcode = 'FO036';
  end if;

  /*
   * THE SET RULES, IN ORDER, each with the sentence the rep will read.
   *
   * Walked in the order given rather than sorted first: the order IS part of
   * what is being validated. Sorting would silently repair "1-10, 21-30, 11-20"
   * into something the rep did not type, and the next slab's start is the whole
   * point of the rule.
   */
  v_prev_end := null;
  for v_i in 0 .. v_count - 1 loop
    v_start := (p_slabs -> v_i ->> 'start')::integer;
    v_end   := nullif(p_slabs -> v_i ->> 'end', '')::integer;

    if v_start is null then
      raise exception 'Slab %: a start is required.', v_i + 1 using errcode = 'FO036';
    end if;

    if v_start < 0 then
      raise exception 'Slab %: a start cannot be negative.', v_i + 1 using errcode = 'FO036';
    end if;

    -- Only the LAST slab may be open-ended, and it MUST be.
    if v_i < v_count - 1 and v_end is null then
      raise exception
        'Slab % needs an end. Only the last slab is open-ended.', v_i + 1
        using errcode = 'FO036';
    end if;

    if v_i = v_count - 1 and v_end is not null then
      raise exception
        'The last slab must be open-ended - leave its end blank for "% and above".', v_start
        using errcode = 'FO036';
    end if;

    if v_end is not null and v_end < v_start then
      raise exception
        'Slab %: the end cannot be before the start.', v_i + 1
        using errcode = 'FO036';
    end if;

    -- CONTIGUOUS: no gap and no overlap, which is one rule, not two.
    if v_prev_end is not null and v_start <> v_prev_end + 1 then
      raise exception
        'Slab % must start at %, right after the previous slab ends.', v_i + 1, v_prev_end + 1
        using errcode = 'FO036';
    end if;

    v_prev_end := v_end;
  end loop;

  /*
   * REPLACED, NOT MERGED. The delete and the inserts are one statement pair in
   * one transaction, so the half-edited states the rules forbid never exist -
   * which is the whole reason this is an RPC rather than row-level writes.
   *
   * RLS applies to both halves because this is SECURITY INVOKER: a rep who
   * cannot see the institute deletes nothing and inserts nothing.
   */
  delete from public.institute_slabs s
   where s.institute_id = p_institute
     and s.scope = p_scope
     and coalesce(s.college, '') = coalesce(p_college, '')
     and coalesce(s.program, '') = coalesce(p_program, '');

  insert into public.institute_slabs
    (institute_id, scope, college, program, start_count, end_count)
  select
    p_institute,
    p_scope,
    case when p_scope = 'total' then null else p_college end,
    case when p_scope = 'total' then null else p_program end,
    (value ->> 'start')::integer,
    nullif(value ->> 'end', '')::integer
  from jsonb_array_elements(p_slabs) as value;

  -- Nothing was written: the institute is not one this caller may touch. Said
  -- rather than returning 0 quietly, because "saved" and "silently discarded"
  -- must not look the same.
  select registered_by into v_owner from public.institutes where id = p_institute;
  if not found then
    raise exception
      'That institute is not yours to add slabs to.'
      using errcode = 'FO036';
  end if;

  return v_count;
end;
$$;

comment on function public.save_slabs is
  'Validates and REPLACES one scope''s slab set in a single transaction. The '
  'set is the unit: a contiguous inclusive cover with exactly one open-ended '
  'slab last, so no sequence of row-level writes could reach it legally. '
  'SECURITY INVOKER, so RLS and FO035 apply inside. Raises FO036.';

revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from public;
revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from anon;
grant execute on function public.save_slabs(uuid, text, text, text, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. decide_slabs() - approve, reject, and revoke
--
-- SECURITY DEFINER with is_admin() FIRST, the house rule for a boundary-crossing
-- RPC. Definer because it writes `status` on rows whose own trigger refuses that
-- write to everybody — the GUC it sets is what tells FO035 the write came from
-- here.
--
-- ⚠ APPROVAL IS ADMIN-ONLY BY DECISION, not by omission. The brief asked for a
-- team lead to approve their own team's; the client chose otherwise. To widen
-- it later, this one test becomes
--
--     public.is_admin() or public.supervises(v_owner)
--
-- which is the predicate every policy in 0042 already uses, and v_owner is
-- already read below for exactly that reason.
--
-- ⚠ REVOKE IS 'rejected' AND MOVES THE WHOLE SET. Revoking one slab of a
-- contiguous cover would leave a gap the rules forbid, so there is no
-- single-row form. 'revoked' is not a fourth status: a revoked set is one the
-- rep must edit and resubmit, which is what rejected already means.
-- -----------------------------------------------------------------------------
create or replace function public.decide_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_status    text,
  p_note      text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
  v_owner uuid;
  v_was   text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve or reject slabs.'
      using errcode = 'FO037';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'A decision is approve or reject.' using errcode = 'FO037';
  end if;

  select registered_by into v_owner from public.institutes where id = p_institute;
  if not found then
    raise exception 'That institute no longer exists.' using errcode = 'FO037';
  end if;

  select min(status) into v_was
    from public.institute_slabs s
   where s.institute_id = p_institute
     and s.scope = p_scope
     and coalesce(s.college, '') = coalesce(p_college, '')
     and coalesce(s.program, '') = coalesce(p_program, '');

  if v_was is null then
    raise exception 'There are no slabs to decide on.' using errcode = 'FO037';
  end if;

  -- REVOKE ONLY ON APPROVED. Rejecting a set that is already rejected is a
  -- no-op dressed as an action, and approving an approved set says nothing.
  if v_was = p_status then
    raise exception
      'These slabs are already %.', p_status
      using errcode = 'FO037';
  end if;

  -- Tells FO035 that this write is the one path allowed to move a status.
  -- `true` is is_local: it lasts for this transaction and no longer.
  perform set_config('kubeats.deciding', 'on', true);

  update public.institute_slabs s
     set status = p_status,
         note = case when p_status = 'rejected' then p_note else null end,
         decided_by = (select auth.uid()),
         decided_at = now()
   where s.institute_id = p_institute
     and s.scope = p_scope
     and coalesce(s.college, '') = coalesce(p_college, '')
     and coalesce(s.program, '') = coalesce(p_program, '');

  get diagnostics v_moved = row_count;

  perform set_config('kubeats.deciding', 'off', true);

  return v_moved;
end;
$$;

comment on function public.decide_slabs is
  'Approves or rejects a whole scope''s slab set. REVOKING an approved set is '
  'rejecting it - the rep edits and resubmits, which is what rejected already '
  'means, so there is no fourth status. Moves the SET because revoking one slab '
  'of a contiguous cover would leave a gap. Admin only; raises FO037.';

revoke all on function public.decide_slabs(uuid, text, text, text, text, text) from public;
revoke all on function public.decide_slabs(uuid, text, text, text, text, text) from anon;
grant execute on function public.decide_slabs(uuid, text, text, text, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
--
-- ⚠ AND EVERY FUNCTION-BODY CHECK READS THE CODE, NOT THE COMMENTS.
-- pg_get_functiondef() returns the whole definition, prose included, and 0043
-- rolled back because an assertion matched the function's own explanation of
-- the thing it had just stopped doing. Comments are stripped first, and every
-- check names what must be PRESENT rather than what must be absent.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  fn       text;
  n        integer;
  body     text;
begin
  -- 7a. The table and its columns.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'institute_slabs'
  ) then
    problems := array_append(problems, 'public.institute_slabs is missing');
  else
    foreach c in array array[
      'institute_id', 'scope', 'college', 'program',
      'start_count', 'end_count', 'status', 'note',
      'decided_by', 'decided_at', 'created_by', 'created_at'
    ] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'institute_slabs'
           and column_name = c
      ) then
        problems := array_append(problems, format('institute_slabs.%s is missing', c));
      end if;
    end loop;

    -- RLS is ON. Policies with RLS disabled are inert, and that mistake looks
    -- exactly like success.
    if not (select cl.relrowsecurity from pg_class cl
              join pg_namespace ns on ns.oid = cl.relnamespace
             where ns.nspname = 'public' and cl.relname = 'institute_slabs') then
      problems := array_append(
        problems,
        'row level security is NOT enabled on institute_slabs - every policy is inert');
    end if;

    -- end_count MUST be nullable: null is the open-ended last slab.
    if (select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'institute_slabs'
           and column_name = 'end_count') <> 'YES' then
      problems := array_append(
        problems,
        'institute_slabs.end_count is NOT NULL - the open-ended last slab could not exist');
    end if;
  end if;

  -- 7b. The four constraints that hold per row.
  foreach c in array array[
    'slab_scope_valid', 'slab_status_valid', 'slab_scope_shape',
    'slab_range_ordered', 'slab_start_non_negative'
  ] loop
    if not exists (select 1 from pg_constraint where conname = c) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  -- 7c. ONE OPEN-ENDED SLAB PER SET, and it must be UNIQUE and PARTIAL. A
  --     non-partial index here would forbid every ordinary closed slab.
  if not exists (
    select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
     where cl.relname = 'slab_one_open_ended' and i.indisunique and i.indpred is not null
  ) then
    problems := array_append(
      problems,
      'slab_one_open_ended is missing, not unique, or not partial - a set could have two open-ended slabs');
  end if;

  -- 7d. Four policies, each reaching through the parent institute.
  n := 0;
  for body in
    select coalesce(qual, '') || coalesce(with_check, '')
      from pg_policies
     where schemaname = 'public' and tablename = 'institute_slabs'
  loop
    n := n + 1;
    if position('supervises' in body) = 0 or position('institutes' in body) = 0 then
      problems := array_append(
        problems,
        'an institute_slabs policy does not reach through the parent institute with supervises()');
    end if;
  end loop;

  if n <> 4 then
    problems := array_append(problems, format(
      'expected 4 policies on institute_slabs, found %s', n));
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'institute_slabs' and grantee = 'anon'
  ) then
    problems := array_append(problems, 'anon holds a grant on institute_slabs');
  end if;

  -- 7e. The three functions: one overload each, and the right security mode.
  --     save_slabs MUST be INVOKER (RLS applies inside); decide_slabs MUST be
  --     DEFINER (it writes a column its own trigger refuses).
  foreach fn in array array['save_slabs', 'decide_slabs', 'institute_is_empanelled', 'guard_slab_decision'] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if n <> 1 then
      problems := array_append(problems, format(
        'expected exactly 1 %s, found %s', fn, n));
    end if;
  end loop;

  if (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'save_slabs') then
    problems := array_append(
      problems,
      'save_slabs() is SECURITY DEFINER - RLS would stop applying inside it and a rep could write another team''s slabs');
  end if;

  if not (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'decide_slabs') then
    problems := array_append(
      problems,
      'decide_slabs() is not SECURITY DEFINER - it could not move a status past FO035');
  end if;

  foreach fn in array array['save_slabs', 'decide_slabs', 'institute_is_empanelled', 'guard_slab_decision'] loop
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

  -- 7f. THE AUTHORISATION TEST IS IN THE CODE, not in a comment about it.
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'decide_slabs';

  if body is null or position('if not public.is_admin() then' in body) = 0 then
    problems := array_append(
      problems,
      'decide_slabs() does not check is_admin() first - any signed-in user could approve slabs');
  end if;

  -- And FO035 refuses a status change outside that one path.
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_slab_decision';

  if body is null
     or position('kubeats.deciding' in body) = 0
     or position('FO035' in body) = 0 then
    problems := array_append(
      problems,
      'guard_slab_decision() does not gate status on the deciding flag - a rep could approve their own slabs');
  end if;

  if body is null or position('tg_op = ''DELETE''' in body) = 0 then
    problems := array_append(
      problems,
      'guard_slab_decision() does not cover DELETE - a rep could delete an approved set outright');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institute_slabs_guard_decision'
       and tgrelid = 'public.institute_slabs'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institute_slabs_guard_decision is not attached');
  end if;

  /*
   * ⚠ AND IT MUST FIRE ON DELETE. Attached without that, every other check here
   * passes and an approved set is still deletable - the hole the integration
   * suite found. tgtype bit 3 (value 8) is DELETE.
   */
  if not exists (
    select 1 from pg_trigger
     where tgname = 'institute_slabs_guard_decision'
       and tgrelid = 'public.institute_slabs'::regclass
       and (tgtype & 8) <> 0
  ) then
    problems := array_append(
      problems,
      'institute_slabs_guard_decision is not attached for DELETE - an approved set could be removed');
  end if;

  /*
   * save_slabs() refuses to REPLACE an approved set, which is the same freeze
   * reached by the other path: it deletes then inserts, so without this the
   * trigger above never sees the approved rows go.
   */
  select regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^' || chr(10) || ']*', '', 'g')
    into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'save_slabs';

  if body is null or position('FO035' in body) = 0 then
    problems := array_append(
      problems,
      'save_slabs() does not refuse an approved set - delete-then-insert would silently un-approve it');
  end if;

  -- 7g. The rules this file sits beside, unchanged by it.
  if not exists (
    select 1 from pg_class cl join pg_index i on i.indexrelid = cl.oid
     where cl.relname = 'daily_plans_one_open_visit' and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - FO013 no longer holds');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0044 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0044 applied: institute_slabs is live with 4 policies scoped through the parent institute, save_slabs() replaces a set under FO036, decide_slabs() is admin-only under FO037, and FO035 keeps a rep from approving their own.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- every set, and where it stands
--   select i.name, s.scope, s.college, s.program,
--          s.start_count, s.end_count, s.status
--     from public.institute_slabs s
--     join public.institutes i on i.id = s.institute_id
--    order by i.name, s.scope, s.college, s.program, s.start_count;
--
--   -- who is empanelled (computed, never stored)
--   select i.name, public.institute_is_empanelled(i.id) as empanelled
--     from public.institutes i order by i.name;
-- =============================================================================
