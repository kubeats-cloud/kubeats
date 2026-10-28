-- =============================================================================
-- KUbeats - migration 0062: reassign to any campus
--
-- ✅ ADDITIVE IN SHAPE, WIDENING IN EFFECT ON ONE DOOR ONLY. No table, no
-- column, no policy. Replaces one function in place; nothing to backfill.
--
-- THE CLIENT'S REQUIREMENT: an admin may reassign any institute to any active
-- rep across all five campuses, regardless of the rep's campus. 0028 built
-- the opposite on purpose — "the new owner must be on the institute's own
-- campus" was FO025 clause (a) in `guard_institute_owner()` — and this
-- migration removes exactly that one clause from exactly that one place.
--
-- WHAT STAYS EXACTLY AS IT WAS, because none of it was the campus rule:
--
--   - Who may reassign at all: an admin, the service role, the SQL editor.
--     A rep is still refused with FO010 — that check is untouched.
--   - FO025 clause (b): a reassignment is still refused while the current
--     owner holds an open check-in at that institute. Unrelated to campus,
--     and the one real control left after this file (see also FO029's
--     mid-visit refusal in `correct_member_campus()`, 0035, which closes the
--     same kind of gap for a REP transfer rather than an institute one).
--   - `institutes_record_reassignment` (0058): the append-only reassignment
--     history fires AFTER this trigger, on the same column, and is untouched.
--     It records from/to/by/time regardless of which campuses are involved.
--   - The institute's own `campus_id` column. Reassigning an institute moves
--     who owns it, never where it lives; nothing here writes that column.
--   - `institutes_select` and every other read policy. They have asked
--     `public.supervises(registered_by)` with NO campus clause since 0042 —
--     "two team leads share a campus" made a campus clause the wrong boundary
--     there, and the same reasoning means the new owner can already see a
--     cross-campus institute the instant this trigger lets the move through.
--     Nothing to widen on the read side; the only door this file opens is the
--     write.
--   - `guard_plan_assignment()` (FO023, 0020b/0028): still refuses an ADMIN
--     assigning a visit to a rep for an institute off that rep's own campus.
--     That is a different feature — the Assign-a-visit screen, not Institute
--     Reassignment — and the client's spec does not ask for it to change. A
--     rep planning their OWN day is unaffected either way (that branch
--     returns before the campus check runs), so the newly-reassigned rep can
--     plan a visit to their own institute from the Dashboard exactly as they
--     could before.
--   - Team Lead scope. `supervises()` (0041) was already ownership-only, not
--     campus-only — unchanged here, and it is why a team lead's view narrows
--     or widens with `registered_by`, never with campus, exactly as before.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0062_reassign_any_campus_down.sql restores the
--   function to its 0028 body, campus check included.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. guard_institute_owner() — drop clause (a), the same-campus check
--
-- Reproduced in full — a plpgsql function cannot be patched — with clause (a)
-- and the `v_new_owner_campus` lookup that fed it removed. Clause (b) is
-- 0028's, unchanged, down to the comment.
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
  v_open_visits integer;
begin
  if new.registered_by is distinct from old.registered_by then

    if caller is not null and not public.is_admin() then
      raise exception
        'Who registered an institute cannot be changed.'
        using errcode = 'FO010';
    end if;

    -- ⚠ (a) IS GONE. 0028 refused a new owner off the institute's own
    -- campus here; the client's spec asks for exactly that move, so the
    -- clause — and the new-owner campus lookup that fed it — is removed
    -- rather than loosened in place, to leave nothing behind that could
    -- silently fire again.

    -- (b) The current owner must not be standing in it. Unchanged from 0028.
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
  'rep (FO010). An admin, the service role and the SQL editor may reassign to '
  'ANY rep on ANY campus since 0062 - the client''s cross-campus requirement - '
  'but never while the current owner holds an open check-in there (FO025).';

-- Recreated so the trigger definitely covers the columns the check reads.
drop trigger if exists institutes_guard_owner on public.institutes;

create trigger institutes_guard_owner
  before update of registered_by on public.institutes
  for each row
  execute function public.guard_institute_owner();


-- -----------------------------------------------------------------------------
-- 2. Prove it landed, and prove nothing else moved
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with
-- a bare literal fails with 22P02 exactly when a check has something to
-- report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_institute_owner';

  if body is null then
    problems := array_append(problems, 'guard_institute_owner() is missing');
  else
    -- 2a. The campus sentence and its lookup are gone.
    if position('not on this institute' in body) > 0 then
      problems := array_append(
        problems,
        'guard_institute_owner() still refuses a cross-campus reassignment');
    end if;
    if position('v_new_owner_campus' in body) > 0 then
      problems := array_append(
        problems,
        'guard_institute_owner() still selects v_new_owner_campus - the removed clause left a trace');
    end if;

    -- 2b. Everything FO010/FO025 that is NOT about campus must still stand.
    if position('FO010' in body) = 0 then
      problems := array_append(problems, 'guard_institute_owner() lost the FO010 rep refusal');
    end if;
    if position('FO025' in body) = 0 then
      problems := array_append(problems, 'guard_institute_owner() lost the FO025 mid-visit refusal');
    end if;
    if position('is_admin' in body) = 0 then
      problems := array_append(problems, 'guard_institute_owner() lost its admin check entirely');
    end if;
    if position('checkout_missing' in body) = 0 then
      problems := array_append(
        problems,
        'guard_institute_owner() lost the checkout_missing exemption - a swept visit would block every reassignment');
    end if;
  end if;

  -- 2c. Still exactly one overload, still SECURITY DEFINER, still pinned.
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'guard_institute_owner') <> 1 then
    problems := array_append(problems, 'guard_institute_owner() is not exactly one overload');
  end if;

  if not (select p.prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname = 'guard_institute_owner') then
    problems := array_append(problems, 'guard_institute_owner() is not SECURITY DEFINER');
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
     where ns.nspname = 'public' and p.proname = 'guard_institute_owner'
       and cfg.setting like 'search_path=%'
  ) then
    problems := array_append(problems, 'guard_institute_owner() does not pin search_path');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_guard_owner'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_guard_owner trigger is not attached');
  end if;

  -- 2d. The things this file must not have touched.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_record_reassignment'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_record_reassignment (0058 audit trail) has gone');
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'institutes_select'
       and pg_get_expr(polqual, polrelid) like '%supervises%'
  ) then
    problems := array_append(
      problems,
      'institutes_select no longer calls supervises() - the read side has moved and should not have');
  end if;

  if exists (
    select 1 from pg_policy
     where polname = 'institutes_select'
       and pg_get_expr(polqual, polrelid) like '%my_campus%'
  ) then
    problems := array_append(
      problems,
      'institutes_select tests my_campus() - that was removed in 0042 and must not come back');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0062 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0062 applied: an institute may be reassigned to any active rep on any campus. FO010 (rep refusal) and FO025''s mid-visit refusal are unchanged. The reassignment history trigger and every read-side policy are untouched.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- a cross-campus reassignment now succeeds (as an admin)
--   update public.institutes set registered_by = '<rep-on-another-campus>'
--    where id = '<institute-id>';
--
--   -- the read side already followed ownership, not campus, since 0042 — see
--   -- that migration's "afterwards" query for the shape.
-- =============================================================================
