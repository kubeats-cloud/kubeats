-- =============================================================================
-- KUbeats - migration 0045: target statuses, a vocabulary of their own
--
-- ✅ ADDITIVE AND STANDALONE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- One new table, two policies, its grants and its one CHECK. Nothing
-- existing is touched: public.targets, its eight metric columns, and
-- public.institute_statuses are all untouched by this file.
--
-- ⚠ LOCKED DECISION THIS FILE EXISTS TO ENFORCE
--
-- "TARGET STATUS" IS ITS OWN VOCABULARY, NOT A READING OF institute_statuses
-- AND NOT A NINTH public.targets COLUMN. The client's Admin #8 / Rep #2 ask
-- for exactly one thing: an Admin types a name, saves it, and it is stored as
-- real data rather than a frontend-only value. Nothing in that ask ties a
-- target status to the Open/Closed institute workflow (0010/0026) or to Rule
-- 7's fixed eight-metric counting (CLAUDE.md: "activity is six values and
-- stays six") — so this is a plain, admin-managed name list, the simplest
-- table that satisfies "stored in actual application data."
--
-- SHAPED LIKE institute_statuses WAS ON DAY ONE (0010: `status text primary
-- key`), deliberately — the closest precedent in this schema for "a short
-- admin-managed vocabulary, nothing else" — not because the two are related.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `name` IS THE PRIMARY KEY, exactly as institute_statuses.status was before
-- any of its later columns arrived — this prevents a duplicate by construction
-- rather than by a second, separate UNIQUE constraint. The blank CHECK is the
-- other half of "prevent duplicate or empty status names": a primary key
-- alone would still accept an empty string once.
-- -----------------------------------------------------------------------------
create table if not exists public.target_statuses (
  name text primary key,

  constraint target_statuses_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.target_statuses is
  'Admin-managed target-status names (Admin #8 / Rep #2). A vocabulary of its '
  'own — not institute_statuses, not a public.targets column. Read by anyone '
  'signed in; written only by an admin.';


-- -----------------------------------------------------------------------------
-- 2. RLS
--
-- SELECT for every signed-in role: "available to the appropriate Reps" and
-- "displayed ... wherever target statuses are used" both ask for a Rep (and a
-- Team Lead, who reads everything a Rep's own screens do) to see the list, not
-- only an Admin who added it.
--
-- INSERT, ADMIN ONLY: "only Admin can add" is the one write asked for. No
-- UPDATE or DELETE policy exists — renaming or removing a target status was
-- never asked for, so neither is reachable, even by an admin bypassing the
-- app, because there is no grant for either verb at all.
-- -----------------------------------------------------------------------------
alter table public.target_statuses enable row level security;

revoke all on public.target_statuses from authenticated;
revoke all on public.target_statuses from anon;
grant select, insert on public.target_statuses to authenticated;

drop policy if exists target_statuses_select on public.target_statuses;
create policy target_statuses_select on public.target_statuses
  for select to authenticated
  using (true);

drop policy if exists target_statuses_insert on public.target_statuses;
create policy target_statuses_insert on public.target_statuses
  for insert to authenticated
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  pol      record;
  n        integer;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'target_statuses'
  ) then
    problems := array_append(problems, 'public.target_statuses is missing');
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'target_statuses'
       and column_name = 'name'
  ) then
    problems := array_append(problems, 'target_statuses.name is missing');
  end if;

  -- RLS is ON. A table with policies and RLS disabled is wide open, and that
  -- mistake looks exactly like success.
  if not (select c2.relrowsecurity
            from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
           where n2.nspname = 'public' and c2.relname = 'target_statuses') then
    problems := array_append(
      problems,
      'row level security is NOT enabled on target_statuses - every policy below is inert');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'target_statuses_name_not_blank'
  ) then
    problems := array_append(problems, 'target_statuses_name_not_blank is missing');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.target_statuses'::regclass and contype = 'p'
  ) then
    problems := array_append(problems, 'target_statuses has no primary key - duplicates are not prevented');
  end if;

  n := 0;
  for pol in
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'target_statuses'
  loop
    n := n + 1;
    if pol.cmd = 'SELECT' and (pol.qual is null or pol.qual <> 'true') then
      problems := array_append(problems, 'target_statuses_select is not open to every signed-in role');
    end if;
    if pol.cmd = 'INSERT' and (pol.with_check is null or pol.with_check not like '%is_admin%') then
      problems := array_append(problems, 'target_statuses_insert does not check is_admin()');
    end if;
  end loop;

  if n <> 2 then
    problems := array_append(problems, format(
      'expected 2 policies on target_statuses (select, insert), found %s', n));
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'target_statuses' and grantee = 'anon'
  ) then
    problems := array_append(problems, 'anon holds a grant on target_statuses');
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'target_statuses'
       and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')
  ) then
    problems := array_append(
      problems,
      'authenticated holds UPDATE or DELETE on target_statuses - neither was asked for');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0045 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0045 applied: target_statuses is live, % policies, select-open and admin-insert-only.', n;
end $$;
