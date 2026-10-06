-- =============================================================================
-- KUbeats - migration 0036: a rep may correct an institute once
--
-- ✅ ADDITIVE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- Three columns and one trigger. Nothing is dropped, no policy moves, and the
-- live app - which neither reads nor writes these columns - is unaffected.
-- Applied early it refuses nothing at all, because no rep can reach the editor
-- until the code ships: `/institutes/[id]/edit` is admin-only on three layers
-- today and this file changes none of them.
--
-- WHAT THIS IS FOR
--
-- A rep registers an institute and gets the details wrong. Today their only
-- remedy is to ask an admin, because `updateInstitute()` opens with
-- `requireAdmin()`. The client asked for one correction: create, fix once, then
-- it locks. An admin keeps unlimited edits and never consumes the allowance.
--
-- NO RLS WIDENING, AND THAT IS THE MOST USEFUL FACT ABOUT THIS FILE.
--
-- `institutes_update` has read
--
--     is_admin() or (campus_id = my_campus() and registered_by = auth.uid())
--
-- on BOTH halves since 0028. The owning rep has always been permitted by the
-- policy; what stopped them was app code - `ADMIN_ONLY_PATTERNS` in nav.ts and
-- the action's own gate. So "let reps edit" sounds like a permissions change
-- and is not one. This migration does not touch a single policy.
--
-- ⚠ THE WHOLE DESIGN IS THE COLUMN LIST. READ THIS BEFORE EDITING THE TRIGGER.
--
-- `public.log_visit()` is SECURITY INVOKER (0002, and still invoker as of
-- 0033) and its Rule 4 step does
--
--     update public.institutes set status = p_status_set_to where id = ...
--
-- AS THE REP. So a trigger that spent the allowance on "any UPDATE by a
-- non-admin" would consume it the first time that rep logged a visit -
-- silently, before they had edited anything. The rep would then find the Edit
-- button gone with no explanation, and nothing on any screen would connect the
-- two events. That is the single failure this file is built to avoid, and it
-- is guarded twice:
--
--   1. `before update OF <the 15 detail columns>` - a BEFORE UPDATE OF trigger
--      fires only when one of the named columns appears in the statement's SET
--      list. log_visit() sets `status` alone, which is not in the list, so it
--      never reaches this function at all.
--   2. `is distinct from` across those same columns inside the body, so an
--      UPDATE that merely MENTIONS one without changing its value - and a
--      no-op re-save of an unchanged form - costs nothing either.
--
-- Section 3's assertion checks the trigger's own column list and FAILS if
-- `status` has crept into it, because that is the one way this could break
-- without anything looking wrong.
--
-- THREE TRIGGERS, THREE DISJOINT COLUMN LISTS. `institutes_guard_owner` is
-- `before update of registered_by` (0016/0028) and `institutes_record_status_change`
-- is `after insert or update of status` (0011); `institutes_touch_status` (0001)
-- is unscoped but only ever writes the two status audit columns. None of them
-- overlaps the list below, so the four coexist without ordering mattering.
--
-- NOT RELATED TO COUNSELLORS (migration 0037). A counsellor lives in its own
-- table and touches none of these columns, so adding or removing one never
-- spends an institute's edit. That is deliberate: a contact list is a working
-- record that changes as staff change, while these columns are a registration
-- the rep is correcting once.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The allowance, and the audit stamp that goes with it
--
-- `smallint` with a 0..1 CHECK rather than a boolean, for two reasons: the
-- column reads as what it is, a COUNT of edits spent, and raising the allowance
-- to two later is a CHECK change rather than a column rename and a back-fill.
--
-- `rep_edited_by` is `on delete set null`, following `registered_by` and
-- `status_updated_by` on this same table: removing a departed rep must never be
-- blocked by an audit stamp pointing at them.
-- -----------------------------------------------------------------------------
alter table public.institutes
  add column if not exists rep_edits_used smallint not null default 0,
  add column if not exists rep_edited_at  timestamptz,
  add column if not exists rep_edited_by  uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'institutes_rep_edits_used_valid'
  ) then
    alter table public.institutes add constraint institutes_rep_edits_used_valid
      check (rep_edits_used between 0 and 1);
  end if;
end $$;

comment on column public.institutes.rep_edits_used is
  'How many of the owning rep''s corrections have been spent. 0 or 1. Written '
  'ONLY by guard_rep_institute_edit(); a client that sets it by hand is '
  'refused with FO030. An admin''s edits never touch it.';

comment on column public.institutes.rep_edited_at is
  'When the owning rep spent their one correction. Null if they never have.';

comment on column public.institutes.rep_edited_by is
  'Which rep spent it. Normally the same as registered_by, and not necessarily '
  'so after a reassignment - which is why it is recorded rather than inferred.';


-- -----------------------------------------------------------------------------
-- 2. The guard
--
-- SECURITY DEFINER with search_path pinned, because it calls public.is_admin()
-- and reads public.institutes; `set search_path = ''` is what stops a caller
-- hijacking an unqualified name, and every object below is schema-qualified.
--
-- is_admin() IS THE FIRST TEST AND RETURNS EARLY. An admin's edit is unlimited
-- and does not spend the rep's allowance - the client's words, and it also
-- means an admin fixing a typo cannot cost the rep their one chance.
--
-- THE FUNCTION STAMPS THE COUNTER ITSELF AND REFUSES A CLIENT THAT TRIES TO.
-- That is guard_checkout_missing()'s shape (FO020) and its lesson verbatim:
-- deleting a button never closes the path behind it. `institutes_update`
-- permits the owning rep to write any column on their own row, so without this
-- a rep could POST `rep_edits_used = 0` and have unlimited corrections.
--
-- THE SERVICE ROLE IS EXEMPT, via the `auth.uid() is null` test. A restore, a
-- seed and the SQL editor all run with no caller, and none of them is a rep
-- spending an allowance. Same precedent as FO022 and FO023.
-- -----------------------------------------------------------------------------
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

  -- An admin edits without limit and without spending anything.
  if public.is_admin() then
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

comment on function public.guard_rep_institute_edit is
  'One correction per institute for the owning rep, then FO030. Admins and the '
  'service role are exempt and spend nothing. SCOPED TO THE 15 EDITABLE DETAIL '
  'COLUMNS BY THE TRIGGER: log_visit() is SECURITY INVOKER and sets '
  'institutes.status as the rep, so a wider trigger would spend the allowance '
  'on the rep''s first visit.';

-- Created with EXECUTE to PUBLIC by default, so this is not tidying.
revoke all on function public.guard_rep_institute_edit() from public;
revoke all on function public.guard_rep_institute_edit() from anon;

/*
 * THE COLUMN LIST IS THE SECURITY-RELEVANT PART OF THIS STATEMENT.
 *
 * `status` is deliberately absent. Adding it would make every logged visit
 * consume the rep's correction. Section 3 asserts its absence.
 */
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
-- 3. Prove it landed, and prove the rules it leans on are still there
--
-- Every append is array_append(), never `problems || '...'`: problems is text[]
-- and a bare quoted literal is of unknown type, so `||` resolves to array
-- concatenation and fails with 22P02 at the moment a check reports something.
-- That trap is recorded at length in 0032 and again in 0035.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
  n        integer;
  c        text;
  tg       record;
  guarded  text[];
  expected text[] := array[
    'name', 'type', 'pincode', 'address', 'area', 'city', 'state', 'boards',
    'principal_name', 'principal_mobile',
    'decision_maker_name', 'decision_maker_designation', 'decision_maker_mobile',
    'class11', 'class12'
  ];
begin
  -- 3a. The three columns and their CHECK.
  foreach c in array array['rep_edits_used', 'rep_edited_at', 'rep_edited_by'] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'institutes' and column_name = c
    ) then
      problems := array_append(problems, format('institutes.%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'institutes_rep_edits_used_valid'
  ) then
    problems := array_append(
      problems,
      'institutes_rep_edits_used_valid is missing - the allowance would have no ceiling');
  end if;

  -- 3b. Exactly one overload. A second would make the trigger ambiguous.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_rep_institute_edit';

  if n = 0 then
    problems := array_append(problems, 'guard_rep_institute_edit is missing');
  elsif n <> 1 then
    problems := array_append(problems, format(
      'there are %s guard_rep_institute_edit overloads, expected exactly 1', n));
  else
    -- 3c. DEFINER, so it can read is_admin() whatever the caller's rights.
    if not (select p.prosecdef
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public' and p.proname = 'guard_rep_institute_edit') then
      problems := array_append(
        problems,
        'guard_rep_institute_edit() is not SECURITY DEFINER');
    end if;

    /*
     * search_path is pinned. LIKE 'search_path=%' against proconfig, NEVER
     * array containment: Postgres stores the flattened GUC, and an empty
     * search_path flattens to `search_path=""`, so `@> array['search_path=']`
     * is false for a function that pins it perfectly. That false alarm rolled
     * 0035 back on dev once; the lesson is recorded there in full.
     */
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'guard_rep_institute_edit'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(
        problems,
        'guard_rep_institute_edit() does not pin search_path - a definer function without one is a privilege hole');
    end if;

    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'guard_rep_institute_edit';

    -- 3d. The admin exemption is still there.
    if position('public.is_admin()' in body) = 0 then
      problems := array_append(
        problems,
        'guard_rep_institute_edit() no longer calls is_admin() - an admin would spend the rep''s allowance');
    end if;

    -- 3e. It still stamps the counter rather than trusting the client.
    if position('new.rep_edits_used := 1' in body) = 0 then
      problems := array_append(
        problems,
        'guard_rep_institute_edit() no longer stamps rep_edits_used - a client could send its own');
    end if;
  end if;

  -- 3f. The trigger, its timing, and ITS COLUMN LIST.
  select t.tgtype into tg
    from pg_trigger t
   where t.tgrelid = 'public.institutes'::regclass
     and t.tgname = 'institutes_rep_edit_guard'
     and not t.tgisinternal;

  if tg is null then
    problems := array_append(problems, 'institutes_rep_edit_guard is not attached');
  else
    -- bit 0 = ROW, bit 1 = BEFORE, bit 4 = UPDATE. Must be BEFORE and UPDATE,
    -- and must NOT also fire on INSERT (bit 2) or DELETE (bit 3).
    if (tg.tgtype & 2) = 0 then
      problems := array_append(problems, 'institutes_rep_edit_guard is not a BEFORE trigger');
    end if;
    if (tg.tgtype & 16) = 0 then
      problems := array_append(problems, 'institutes_rep_edit_guard does not fire on UPDATE');
    end if;
    if (tg.tgtype & 4) <> 0 then
      problems := array_append(
        problems,
        'institutes_rep_edit_guard also fires on INSERT - registering an institute would spend the allowance');
    end if;
  end if;

  /*
   * 3g. THE ASSERTION THIS WHOLE FILE EXISTS FOR.
   *
   * `status` must NOT be in the trigger's column list. If it ever is, every
   * visit a rep logs spends their one correction - silently, with nothing on
   * any screen to connect the two. Nothing else would look wrong.
   */
  select coalesce(array_agg(a.attname::text order by a.attname), '{}')
    into guarded
    from pg_trigger t
    cross join lateral unnest(t.tgattr) as col(attnum)
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
   where t.tgrelid = 'public.institutes'::regclass
     and t.tgname = 'institutes_rep_edit_guard'
     and not t.tgisinternal;

  if 'status' = any (guarded) then
    problems := array_append(
      problems,
      'institutes_rep_edit_guard covers `status` - log_visit() would spend the rep''s one edit on their first visit');
  end if;

  foreach c in array array['registered_by', 'campus_id', 'status_updated_at', 'status_updated_by'] loop
    if c = any (guarded) then
      problems := array_append(problems, format(
        'institutes_rep_edit_guard covers `%s`, which is not an editable detail', c));
    end if;
  end loop;

  foreach c in array expected loop
    if not (c = any (guarded)) then
      problems := array_append(problems, format(
        'institutes_rep_edit_guard does not cover `%s` - that detail could be changed without limit', c));
    end if;
  end loop;

  -- 3h. THE POLICY THIS FILE LEANS ON WITHOUT RESTATING. If the owner half of
  --     institutes_update ever goes, a rep cannot edit at all and FO030 is
  --     guarding a door nobody can reach.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'institutes'
       and policyname = 'institutes_update'
       and qual like '%registered_by%' and with_check like '%registered_by%'
  ) then
    problems := array_append(
      problems,
      'institutes_update no longer carries the owner predicate on both halves - the rep editor would be refused by RLS');
  end if;

  -- 3i. The two triggers whose column lists must stay disjoint from ours.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_guard_owner'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_guard_owner (FO010/FO025) is gone');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_touch_status'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_touch_status is gone');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0036 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0036 applied: a rep gets one correction per institute (FO030). Trigger covers % detail columns and NOT status.',
    array_length(guarded, 1);
end $$;
