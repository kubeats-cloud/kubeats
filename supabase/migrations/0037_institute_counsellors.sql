-- =============================================================================
-- KUbeats - migration 0037: counsellors, several per institute
--
-- ✅ ADDITIVE AND STANDALONE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- One new table, four policies, its grants and its CHECKs. Nothing existing is
-- touched: no column moves, no policy on another table is rewritten, and the
-- live app - which does not know this table exists - is unaffected. It does not
-- depend on 0036 and 0036 does not depend on it; either order works.
--
-- WHAT THIS IS FOR
--
-- An institute has two fixed contacts today - `principal_name` /
-- `principal_mobile` (the pair the detail page labels "Principal / owner") and
-- the `decision_maker_*` trio. Both stay exactly as they are. What the client
-- asked for is a LIST: however many counsellors a school has, added and removed
-- as staff change.
--
-- A CHILD TABLE, NOT AN ARRAY COLUMN AND NOT THREE MORE FLAT COLUMNS.
-- A jsonb array would put each phone outside the reach of the 10-digit CHECK
-- every other phone in this schema has to satisfy, and three more columns would
-- cap the list at three and write that cap into the schema.
--
-- THE RLS SHAPE IS institute_status_history's, AND THAT IS NOT A COINCIDENCE.
-- 0028 §2 calls that table "the quiet one" and names the trap this file has to
-- avoid: a child table whose policy does NOT reach through the parent lets a
-- rep read rows belonging to a colleague's institute without ever selecting
-- from `institutes` - so tightening only the parent MOVES a leak rather than
-- closing it. Every policy below therefore reaches through
-- `public.institutes` and repeats its predicate rather than duplicating
-- `registered_by` onto this table. One fact, one home.
--
-- BOTH HALVES ON EVERY WRITE POLICY. `using` decides which rows may be
-- targeted; `with check` decides what they may become. Scope one and a door is
-- left open on the other side - 0020b caught exactly that in
-- `institutes_update` and 0027 restates it for `institute_statuses`.
--
-- NOT PART OF 0036'S ONE-TIME EDIT ALLOWANCE, deliberately. Adding or removing
-- a counsellor is uncapped for the owning rep. A contact list is a working
-- record that changes as staff change; the allowance is for correcting a
-- REGISTRATION. The two cannot interact even by accident, because 0036's
-- trigger is scoped to a column list on `institutes` and nothing here touches
-- that table at all.
--
-- A REAL DELETE, NOT A RETIREMENT - unlike a status (0027) or a purpose (0025),
-- and for precisely the reason those two are retired instead: nothing
-- references a counsellor row. No visit, no plan, no history points at one, so
-- removing it strands nothing and leaves no past record unreadable.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `on delete cascade`, where `visits.institute_id` is `on delete restrict`.
-- The difference is what the row IS: a visit is evidence that must outlive a
-- tidy-up, a contact card is not, and an admin deleting an institute should not
-- be blocked by one. Nothing is lost that anybody could want back, and
-- `institutes_delete` is admin-only with `visits`' own `restrict` still
-- refusing any institute that has history - so this cascade can never be the
-- thing that destroys something that mattered.
--
-- The phone CHECK is the same 10-digit rule `institutes_principal_mobile_valid`
-- and `profiles_mobile_valid` already carry, so every phone number in this
-- database answers to one shape.
--
-- The email CHECK is deliberately LOOSE - a backstop against garbage, not the
-- rule. `z.email()` in the shared schema is the rule; email is not load-bearing
-- for anything here, so it does not get the state-it-three-times treatment that
-- Rule 12's photo does.
-- -----------------------------------------------------------------------------
create table if not exists public.institute_counsellors (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references public.institutes (id) on delete cascade,
  name          text not null,
  phone         text,
  email         text,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint institute_counsellors_name_present check (btrim(name) <> ''),
  constraint institute_counsellors_name_length  check (length(name) <= 120),
  constraint institute_counsellors_phone_valid  check (phone is null or phone ~ '^[0-9]{10}$'),
  constraint institute_counsellors_email_length check (email is null or length(email) <= 254),
  constraint institute_counsellors_email_valid  check (
    email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

comment on table public.institute_counsellors is
  'Counsellors at a prospect institute - a LIST, alongside the fixed '
  'principal/owner and decision-maker pairs on institutes itself, which this '
  'does not replace. Scoped exactly like its parent institute: the owning rep '
  'on their own campus, or an admin.';

-- Every read is "the counsellors for this institute", so this is the index.
create index if not exists institute_counsellors_by_institute
  on public.institute_counsellors (institute_id);


-- -----------------------------------------------------------------------------
-- 2. RLS - the same predicate the institute itself carries, reached through it
--
-- The grants are spelled out rather than inherited. 0001's blanket
-- `grant ... on all tables` was a one-time statement that cannot reach a table
-- created later, and what would otherwise cover this is the Supabase project's
-- default privileges - so without these, "scoped to the owner" would rest on a
-- policy alone. 0011 and 0027 both make the same point at length.
-- -----------------------------------------------------------------------------
alter table public.institute_counsellors enable row level security;

revoke all on public.institute_counsellors from authenticated;
revoke all on public.institute_counsellors from anon;
grant select, insert, update, delete on public.institute_counsellors to authenticated;

/*
 * READ. Identical in shape to institute_status_history_select as 0028 rewrote
 * it: an admin sees everything, a rep sees a row only when they can see its
 * parent institute - which after 0028 means they own it AND it is on their
 * campus. Both conjuncts, because campus is the outer boundary and ownership
 * the inner one; a rep must satisfy both.
 */
drop policy if exists institute_counsellors_select on public.institute_counsellors;
create policy institute_counsellors_select on public.institute_counsellors
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

/*
 * WRITE. The same predicate again, which is the point: "who may add a
 * counsellor" is exactly "who may edit this institute", so there is one rule to
 * learn rather than two that could drift.
 *
 * INSERT has only `with check` - there is no existing row to target.
 */
drop policy if exists institute_counsellors_insert on public.institute_counsellors;
create policy institute_counsellors_insert on public.institute_counsellors
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

-- BOTH HALVES. Scope only `using` and a rep could move a counsellor onto an
-- institute that is not theirs; scope only `with check` and they could edit one
-- that already belongs to somebody else.
drop policy if exists institute_counsellors_update on public.institute_counsellors;
create policy institute_counsellors_update on public.institute_counsellors
  for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );

drop policy if exists institute_counsellors_delete on public.institute_counsellors;
create policy institute_counsellors_delete on public.institute_counsellors
  for delete to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.institutes i
      where i.id = institute_id
        and i.campus_id = public.my_campus()
        and i.registered_by = (select auth.uid())
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove the boundary it leans on is still there
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  pol      record;
  n        integer;
  fk       text;
begin
  -- 3a. The table and its three contact columns.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'institute_counsellors'
  ) then
    problems := array_append(problems, 'public.institute_counsellors is missing');
  else
    foreach c in array array['institute_id', 'name', 'phone', 'email', 'created_by', 'created_at'] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'institute_counsellors'
           and column_name = c
      ) then
        problems := array_append(problems, format('institute_counsellors.%s is missing', c));
      end if;
    end loop;

    -- 3b. RLS is ON. A table with policies and RLS disabled is wide open, and
    --     it is the one mistake that looks exactly like success.
    if not (select c2.relrowsecurity
              from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
             where n2.nspname = 'public' and c2.relname = 'institute_counsellors') then
      problems := array_append(
        problems,
        'row level security is NOT enabled on institute_counsellors - every policy below is inert');
    end if;

    -- 3c. The FK cascades. `restrict` here would block an admin from deleting
    --     an institute because somebody once recorded a phone number.
    -- Cast explicitly: confdeltype is `"char"` (one byte), not text, and
    -- leaving the coercion implicit is the kind of thing that works until it
    -- does not.
    select confdeltype::text into fk
      from pg_constraint
     where conrelid = 'public.institute_counsellors'::regclass
       and contype = 'f'
       and conname like '%institute_id%';

    if fk is null then
      problems := array_append(problems, 'institute_counsellors has no FK to institutes');
    elsif fk <> 'c' then
      problems := array_append(
        problems,
        'institute_counsellors.institute_id does not cascade on delete');
    end if;

    -- 3d. The CHECKs that keep a phone looking like every other phone.
    foreach c in array array[
      'institute_counsellors_name_present',
      'institute_counsellors_phone_valid',
      'institute_counsellors_email_valid'
    ] loop
      if not exists (select 1 from pg_constraint where conname = c) then
        problems := array_append(problems, format('%s is missing', c));
      end if;
    end loop;
  end if;

  /*
   * 3e. ALL FOUR POLICIES, AND EVERY ONE REACHES THROUGH THE PARENT.
   *
   * This is the assertion the file exists for. A policy that forgot the
   * `institutes` lookup - or that tested only the campus and not the owner -
   * would publish one rep's contacts to every rep on their campus, which is
   * exactly the leak 0028 §2 describes one table along. Checked by reading the
   * policy expressions, the way 0027 §3 walks its own.
   */
  n := 0;
  for pol in
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'institute_counsellors'
  loop
    n := n + 1;

    -- INSERT has no `using`; everything else must have one.
    if pol.cmd <> 'INSERT' then
      if pol.qual is null then
        problems := array_append(problems, format('%s has no USING clause', pol.policyname));
      elsif pol.qual not like '%registered_by%'
         or pol.qual not like '%my_campus%'
         or pol.qual not like '%is_admin%' then
        problems := array_append(problems, format(
          '%s USING does not reach through institutes (needs is_admin, my_campus and registered_by)',
          pol.policyname));
      end if;
    end if;

    -- INSERT and UPDATE must both carry `with check`.
    if pol.cmd in ('INSERT', 'UPDATE') then
      if pol.with_check is null then
        problems := array_append(problems, format(
          '%s has no WITH CHECK - a row could become something it may not be', pol.policyname));
      elsif pol.with_check not like '%registered_by%'
         or pol.with_check not like '%my_campus%'
         or pol.with_check not like '%is_admin%' then
        problems := array_append(problems, format(
          '%s WITH CHECK does not reach through institutes', pol.policyname));
      end if;
    end if;
  end loop;

  if n <> 4 then
    problems := array_append(problems, format(
      'expected 4 policies on institute_counsellors, found %s', n));
  end if;

  -- 3f. anon has nothing at all.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'institute_counsellors'
       and grantee = 'anon'
  ) then
    problems := array_append(
      problems,
      'anon holds a grant on institute_counsellors - a signed-out caller could reach it');
  end if;

  -- 3g. THE BOUNDARY THIS FILE LEANS ON WITHOUT RESTATING. Every policy above
  --     is only as narrow as institutes_select; if that loosened, so would
  --     these, silently.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'institutes'
       and policyname = 'institutes_select'
       and qual like '%registered_by%'
  ) then
    problems := array_append(
      problems,
      'institutes_select no longer keys on registered_by - the counsellor policies inherit a wider boundary than intended');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0037 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0037 applied: institute_counsellors is live with % policies, all scoped through the parent institute.', n;
end $$;
