-- =============================================================================
-- 0034 - who created whom
--
-- The client asked to see the team as a hierarchy: which admin created which
-- representative. `public.profiles` has never recorded it - the columns are
-- id, name, role, mobile, created_at (0001) and campus_id (0020a), and nothing
-- else - so the fact was simply not kept. `created_at` says WHEN an account
-- appeared and can never say who made it.
--
-- WHAT THIS IS NOT, and the line is worth drawing before the column exists.
--
-- This is NOT a reports-to chain and must not become one. The model stays flat:
-- a person is a `rep` or an `admin` (profiles_role_valid, 0001), a rep belongs
-- to exactly one campus and an admin to none (enforce_profile_campus, FO021),
-- and NOTHING about visibility reads this column. RLS is unchanged by this
-- file: profiles_select is still `id = auth.uid() or is_admin()`, institutes
-- are still campus + owner (0028), visits are still `member = auth.uid() or
-- is_admin()` (0001). created_by decides nothing. It records something.
--
-- That is why the guard below refuses to point created_by at a REP. The moment
-- a rep can be somebody's parent, this stops being "which admin opened this
-- account" and starts being a management tree - and a management tree that no
-- policy reads is a tree that will one day be mistaken for one that does.
--
-- NO BACKFILL. The ~39 rows that predate this file keep created_by NULL, and
-- that is a decision rather than an omission: there is no column, no audit row
-- and no log that records who created them, so any value written here would be
-- a guess presented as a record. 0011's backfill was legitimate because
-- status_updated_at already HELD the fact it wrote; nothing here does. An admin
-- fills them in by hand from the hierarchy screen, one at a time, which is the
-- only source that actually knows.
--
-- ON DELETE SET NULL, NEVER CASCADE. This is the sharp edge of the whole file.
-- delete_member() (0032) deletes from public.profiles directly, in one
-- transaction, as part of removing a person who has left. With ON DELETE
-- CASCADE, deleting ONE admin would silently delete every account that admin
-- ever created - reps, their profiles, and then everything that cascades off
-- THOSE (daily_plans, visits, weekly_targets are all `on delete cascade` from
-- profiles). An admin tidying up a departed colleague would take the field team
-- with them, inside a transaction that reported success. SET NULL means the
-- hierarchy forgets a parent and nothing else moves, and it is also why 0032
-- needs no reopening: the foreign key handles it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: the column is `if not exists`, the index is
--   `if not exists`, the function is a create-or-replace and the trigger is
--   dropped before it is created.
--
-- APPLY THIS BEFORE THE CODE SHIPS. Additive is not the same as uncoupled,
-- and the asymmetry runs one way only:
--
--   OLD CODE, NEW DATABASE   fine, and completely. Nothing in the previous
--                            build reads or writes created_by, the column is
--                            nullable, and the trigger allows null on every
--                            path. There is no window here at all.
--
--   NEW CODE, OLD DATABASE   two failures, both loud. createMember() sends
--                            created_by and is refused with PGRST204, which
--                            errors.ts maps to DATABASE_BEHIND - named, and no
--                            account is half-created, because the profile
--                            insert is what fails and its own rollback path
--                            deletes the auth user. listTeamMembers() selects
--                            created_by as a plain column, so it is refused the
--                            same way; that function returns [] on error, so
--                            the team list and the hierarchy would come up
--                            EMPTY rather than saying why. That silence is
--                            exactly how the PGRST200 outage went unnoticed -
--                            see section 1 - so treat an empty team list as a
--                            missing migration until proven otherwise.
--
-- So: this file first, the deploy second. `npm run check:schema` probes
-- profiles.created_by and is the way to confirm it landed before deploying.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column
--
-- SELF-REFERENTIAL, because the creator is a member of the same team. The
-- alternative - referencing auth.users - was rejected: every other "who did
-- this" column in this schema points at public.profiles (institutes.
-- registered_by and status_updated_by, institute_status_history.changed_by,
-- materials.uploaded_by, daily_plans.checkout_closed_by, weekly_targets.
-- reopened_by), and a column pointing somewhere else would be the one nobody
-- could join to a name.
--
-- The constraint is NAMED rather than left to Postgres, even though the name
-- chosen is the one Postgres would have picked: a stable, stated name is what
-- lets section 3 assert the DELETE RULE below, which is the part of this file
-- that can go quietly and catastrophically wrong.
--
-- ⚠ WHAT THIS NAME IS *NOT* FOR, recorded because the original version of this
-- comment said the opposite and the mistake reached production.
--
-- It claimed the name was "part of the app's read path", because
-- listTeamMembers() resolved the creator with a self-referencing embed hinted
-- by the CONSTRAINT: `creator:profiles!profiles_created_by_fkey(name)`.
-- PostgREST does not accept that. It disambiguates a self-join by the
-- REFERENCING COLUMN - `profiles!created_by` - and answers the constraint-name
-- spelling with
--
--   PGRST200: Could not find a relationship between 'profiles' and 'profiles'
--   in the schema cache.
--
-- The foreign key was present and correct throughout (a dangling created_by is
-- still refused with 23503 naming this very constraint), and RLS was never
-- involved - the service role, which bypasses policies entirely, got the same
-- PGRST200. listTeamMembers() returns [] on error, so every admin screen
-- rendered empty over a table with every row intact.
--
-- THE APP NO LONGER EMBEDS AT ALL. It reads created_by as a plain column and
-- resolves the name from the rows it has already fetched, so nothing in the
-- read path depends on PostgREST's relationship graph. Section 3's assertion
-- on this name stays, for the delete rule.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists created_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_created_by_fkey'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_created_by_fkey
      foreign key (created_by) references public.profiles (id)
      on update restrict on delete set null;
  end if;
end $$;

comment on column public.profiles.created_by is
  'The ADMIN who created this account, stamped by createMember(). A RECORD, '
  'not a permission: no policy, trigger or query reads it to decide what '
  'anyone may see. Null for every account made before 0034 and for any whose '
  'creator has since been deleted (on delete set null). Never a rep - '
  'guard_profile_created_by (FO028) refuses one, because a rep parent would '
  'turn this into the reports-to chain the model deliberately does not have.';

-- Mirrors profiles_campus_idx (0020a): partial, because the hierarchy screen
-- groups by this column and the rows that matter are the ones that have a
-- value. The unrecorded rows are found by `created_by is null`, which the
-- partial index does not serve and does not need to - that is a scan of a table
-- with a few dozen rows in it.
create index if not exists profiles_created_by_idx
  on public.profiles (created_by)
  where created_by is not null;


-- -----------------------------------------------------------------------------
-- 2. FO028 - only an admin may say who created an account
--
-- MIRRORS guard_profile_role() (0001) DELIBERATELY, down to the shape of the
-- caller test, because it closes the same hole. profiles_update is
--
--     using (id = (select auth.uid()) or public.is_admin())
--
-- so a rep may update THEIR OWN ROW. Without this trigger a rep could set their
-- own created_by to any admin they liked, or clear it, and the hierarchy an
-- admin reads would be partly written by the people it describes. 0001 needed
-- the same guard for `role` for the sharper version of the same reason.
--
-- FOUR REFUSALS, and each is a different mistake:
--
--   (a) A NON-ADMIN SETTING OR CHANGING IT. The privilege rule.
--   (b) created_by = id. Nobody creates their own account: there is no
--       self-signup in this app (createMember is the only door, and it needs an
--       existing admin), so a self-parent is always false. It is also the one
--       value that would make the hierarchy screen render a node as its own
--       child.
--   (c) POINTING AT A REP. See the header: this is what keeps the model flat.
--   (d) Nothing - a null created_by is always allowed, on insert and on update.
--       That is the state all ~39 existing rows are in and the state a row
--       returns to when its creator is deleted, so refusing it would make those
--       rows unwritable for ever.
--
-- THE TRUSTED-CONTEXT EXEMPTION, and why this file takes 0001's side rather
-- than 0032's. `caller is null` is the service-role key, the SQL editor and the
-- nightly cron - and it passes (a). 0032 refuses those outright because
-- delete_member() destroys a person's whole history and no automated job should
-- ever want to. This is a stamp on an additive column; a restore, a seed or a
-- hand-run correction in the SQL editor must be able to write it, exactly as
-- guard_profile_role() lets the very first admin be created. (b) and (c) are
-- NOT exempted - they are statements about what the data may be, not about who
-- may write it, and a restore that would create a self-parent or a rep parent
-- is a restore worth stopping.
--
-- SECURITY DEFINER because it reads public.profiles to answer (c), and
-- profiles has RLS on it; without definer rights the lookup would be filtered
-- by the caller's own policy and a rep would read back nothing, making every
-- creator look like a non-admin. Same reasoning, and the same
-- `set search_path = ''`, as guard_profile_role() and my_campus().
--
-- A MISSING creator row is left to the foreign key. If created_by points at an
-- id with no profile, the lookup finds no role and this says nothing; the FK
-- added in section 1 then refuses the write with 23503, which errors.ts already
-- turns into a sentence. Raising FO028 here as well would be two answers to one
-- question.
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Null for the service-role key and for the SQL editor, i.e. trusted
  -- server-side contexts. Never null for a signed-in user, and the anon role
  -- holds no grant on this table.
  caller uuid := (select auth.uid());
  v_creator_role text;
begin
  -- (a) Who may write it at all.
  if tg_op = 'INSERT' then
    if new.created_by is not null
       and caller is not null
       and not public.is_admin() then
      raise exception
        'Only an admin can record who created an account.'
        using errcode = 'FO028';
    end if;
  elsif new.created_by is distinct from old.created_by then
    if caller is not null and not public.is_admin() then
      raise exception
        'Only an admin can change who created an account.'
        using errcode = 'FO028';
    end if;
  end if;

  -- (d) Null is always allowed, and there is nothing left to check.
  if new.created_by is null then
    return new;
  end if;

  -- (b) Nobody creates their own account. Checked for every caller, trusted
  --     ones included - this is a statement about the data, not about
  --     privilege.
  if new.created_by = new.id then
    raise exception
      'Nobody creates their own account.'
      using errcode = 'FO028';
  end if;

  -- (c) The creator has to be an admin. A rep parent would make this a
  --     reports-to chain, which the model does not have and which nothing in
  --     the app is built to read.
  select p.role into v_creator_role
    from public.profiles p
   where p.id = new.created_by;

  if v_creator_role is not null and v_creator_role <> 'admin' then
    raise exception
      'An account can only have been created by an admin.'
      using errcode = 'FO028';
  end if;

  return new;
end;
$$;

comment on function public.guard_profile_created_by is
  'profiles.created_by is a record, and only an admin writes it (FO028). '
  'Refuses a non-admin setting or changing it, refuses created_by = id, and '
  'refuses pointing it at a rep - the last is what keeps the model flat rather '
  'than letting this become a reports-to chain. Null is always allowed. '
  'Trusted contexts (auth.uid() null) are exempt from the privilege check '
  'only, so a restore or a hand-run correction can still write it.';

-- `before insert or update of created_by` fires on any statement that MENTIONS
-- the column, and a statement that does not mention it cannot change it - the
-- same reasoning institutes_guard_owner gives in 0028. The function then tests
-- the value itself, so an UPDATE that lists created_by without changing it
-- costs one comparison and passes.
drop trigger if exists profiles_guard_created_by on public.profiles;

create trigger profiles_guard_created_by
  before insert or update of created_by on public.profiles
  for each row
  execute function public.guard_profile_created_by();


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove nothing else moved
--
-- The delete rule is the check that matters most here, and it is checked by
-- READING confdeltype rather than by trusting the DDL above: a column that
-- already existed from a half-applied earlier attempt would skip section 1's
-- `if not exists` entirely and could carry any rule at all. 'n' is SET NULL;
-- 'c' is CASCADE, and 'c' on this constraint is the failure described in the
-- header - deleting one admin taking the field team with it.
--
-- Every append is array_append(), never `problems || '...'`: problems is text[]
-- and a bare quoted literal is of unknown type, so `||` resolves to array
-- concatenation and fails with 22P02 at the moment a check reports something.
-- That trap is recorded at length in 0032, which was bitten by it.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  v_delrule "char";
  n        integer;
begin
  -- 3a. The column is there.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'created_by'
  ) then
    problems := array_append(
      problems,
      'profiles.created_by is missing - createMember would fail with PGRST204 on every account');
  end if;

  -- 3b. The foreign key is there, is NAMED as the app's embed hint expects,
  --     and - the one that matters - is ON DELETE SET NULL.
  select c.confdeltype into v_delrule
    from pg_constraint c
   where c.conname = 'profiles_created_by_fkey'
     and c.conrelid = 'public.profiles'::regclass
     and c.contype = 'f';

  if v_delrule is null then
    problems := array_append(
      problems,
      'profiles_created_by_fkey is missing - created_by would be unconstrained, so a deleted admin could leave dangling ids instead of nulls');
  elsif v_delrule <> 'n' then
    problems := array_append(
      problems,
      format('profiles_created_by_fkey is ON DELETE %s, not SET NULL - deleting one admin would remove every account they created',
             case v_delrule when 'c' then 'CASCADE'
                            when 'r' then 'RESTRICT'
                            when 'a' then 'NO ACTION'
                            when 'd' then 'SET DEFAULT'
                            else v_delrule::text end));
  end if;

  -- 3c. The index the hierarchy screen groups on.
  if not exists (
    select 1 from pg_class where relname = 'profiles_created_by_idx' and relkind = 'i'
  ) then
    problems := array_append(problems, 'profiles_created_by_idx is missing');
  end if;

  -- 3d. FO028 is standing, and is SECURITY DEFINER - without definer rights
  --     its role lookup reads nothing under a rep's own policy and check (c)
  --     silently passes for every creator.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_guard_created_by'
       and tgrelid = 'public.profiles'::regclass
       and not tgisinternal
  ) then
    problems := array_append(
      problems,
      'profiles_guard_created_by (FO028) is gone - a rep could rewrite their own created_by through profiles_update');
  else
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'guard_profile_created_by';

    if n <> 1 then
      problems := array_append(problems, format(
        'there are %s guard_profile_created_by overloads, expected exactly 1', n));
    elsif not (select p.prosecdef
                 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                where ns.nspname = 'public' and p.proname = 'guard_profile_created_by') then
      problems := array_append(
        problems,
        'guard_profile_created_by() is not SECURITY DEFINER - its role lookup would be filtered by RLS and the rep-parent check would never fire');
    end if;
  end if;

  -- 3e. THE TWO GUARDS THIS FILE SITS BESIDE, neither of which it touches.
  --     Asserted for the reason 0028 asserts its neighbours: this migration
  --     adds a trigger to a table that already has two, and `create trigger`
  --     on a table is exactly the kind of edit that loses one by accident.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_guard_role'
       and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    problems := array_append(
      problems,
      'profiles_guard_role is gone - any rep could promote themselves to admin');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'profiles_campus_required'
       and tgrelid = 'public.profiles'::regclass and not tgisinternal
  ) then
    problems := array_append(
      problems,
      'profiles_campus_required (FO021) is gone - a rep could be left with no campus');
  end if;

  -- 3f. NO BACKFILL HAPPENED. Not a safety check - a statement of intent that
  --     will fail loudly if somebody adds one to this file later without
  --     reading the header. It reports rather than refuses, because an admin
  --     filling rows in by hand from the hierarchy screen is the feature
  --     working, and this file may legitimately be re-run afterwards.
  select count(*) into n from public.profiles where created_by is not null;
  if n > 0 then
    raise notice
      '0034: % profile(s) already carry a created_by. Expected 0 on a first run - this file writes none.', n;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0034 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0034 applied: profiles.created_by recorded, FO028 guarding it, no rows backfilled.';
end $$;


-- =============================================================================
-- WHAT THIS DOES NOT CHANGE, WRITTEN DOWN SO NOBODY GOES LOOKING
--
-- NO RLS MOVED. Not one policy is created, dropped or replaced by this file.
-- profiles_select is still `id = (select auth.uid()) or public.is_admin()`, so
-- an admin reads every row (which is what the hierarchy screen needs) and a rep
-- reads only their own. A rep CAN therefore see their own created_by as a raw
-- uuid - and cannot resolve it to a name, because the creating admin's row is
-- not theirs to read. That is the right answer and it is why the hierarchy is
-- an admin screen: there is nothing for a rep to render.
--
-- NOTHING READS IT TO DECIDE ANYTHING. Repeated here because it is the property
-- that keeps this cheap. If some future screen starts filtering by created_by,
-- this stops being a record and becomes a boundary, and it would need the
-- treatment 0028 gave registered_by - a guard that understands it is granting
-- access, and a comment saying so.
--
-- A CREATOR WHO IS LATER DEMOTED. guard_profile_created_by fires on created_by,
-- not on role, so an admin who created five reps and is then made a rep leaves
-- five rows pointing at a non-admin. That is allowed on purpose: the record is
-- of what happened, and refusing the demotion - or rewriting five rows under it
-- - would be changing history to satisfy a shape check. The hierarchy screen
-- renders them under that person as they are now.
--
-- delete_member() (0032) NEEDS NO CHANGE. It deletes from public.profiles and
-- the foreign key's SET NULL does the rest. Re-running 0032 after this file is
-- harmless and unnecessary.
--
-- HOW TO CHECK AFTERWARDS
--
--   -- the column, and the delete rule that matters
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'public.profiles'::regclass and contype = 'f';
--
--   -- the guard is on, beside the other two
--   select tgname from pg_trigger
--    where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--
--   -- who created whom, once the app has stamped a few
--   select c.name as created_by, p.name, p.role
--     from public.profiles p
--     left join public.profiles c on c.id = p.created_by
--    order by c.name nulls first, p.name;
--
--   -- and the ones still to be filled in by hand
--   select id, name, role from public.profiles where created_by is null;
-- =============================================================================
