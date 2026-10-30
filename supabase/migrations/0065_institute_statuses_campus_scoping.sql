-- =============================================================================
-- KUbeats - migration 0065: institute_statuses gets a campus, visibility first
--
-- ✅ ADDITIVE, AND NOTHING ANYONE SEES CHANGES TODAY. Part 1 of the campus-wise
-- statuses feature (docs discussed out of band; see the Part 0 investigation).
--
-- THE CLIENT'S REQUIREMENT: an admin at one campus (Kolkata, first) wants
-- statuses that only their own reps see, without polluting the other four
-- campuses' pickers. The live data already shows the pain before this file
-- does anything about it - "Kolkata Consultant follow up" and
-- "Kolkata consultant meet" are two of the twenty rows in institute_statuses
-- today, named for one campus, visible to all five.
--
-- WHAT THIS FILE DOES, AND NOTHING ELSE:
--
--   1. public.institute_statuses gets a nullable campus_id, same shape as
--      0020a's profiles/institutes/materials columns: NULL = every campus.
--      Every one of the existing rows (20 in the rehearsal data; however many
--      in any other database) stays NULL - there is no DEFAULT other than
--      NULL and no backfill UPDATE is needed, which the assertion block below
--      proves rather than assumes.
--   2. institute_statuses_select is rewritten from `using (true)` to the
--      four-clause rule: global (NULL), admin, own campus, or a campus holding
--      a rep the caller supervises(). The fourth clause is what keeps a
--      cross-campus team lead (0061) from losing a status on an institute one
--      of their own reps holds, just because that rep's campus differs from
--      the team lead's own.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO:
--
--   * It does not touch institute_statuses_insert or institute_statuses_update
--     - still admin-only, untouched.
--   * It does not add a Campus field to the admin's Add/Edit-a-status form.
--     That is a later part; this file is the database half only, and every
--     existing status is still visible to everyone until that form exists to
--     write a non-null campus_id.
--   * It does not touch public.target_statuses. The client's requirement
--     covers it too, but it is its own part with its own migration number.
--   * It does not re-scope any of the 20 existing rows, including the two
--     named for Kolkata. Scoping them is an admin UPDATE through the (future)
--     edit form, by choice, not a side effect of this migration landing.
--
-- READ BY listStatusCatalogue() (src/lib/statuses.ts) WITH NO APP CHANGE.
-- That function selects with no filter of its own and has never needed one -
-- RLS has always been the enforcement point for this table (0027). Rewriting
-- the policy is therefore sufficient for every one of that function's ~20
-- call sites; none of them is touched by this file.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0065_institute_statuses_campus_scoping_down.sql drops
--   the column (which takes its FK and partial index with it) and restores
--   institute_statuses_select to `using (true)`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column
--
-- ON DELETE RESTRICT, same reasoning as every other campus_id in this app
-- (0020a): a campus with a status pointing at it must not vanish by accident.
-- No ON UPDATE clause - same as profiles/institutes/materials.campus_id -
-- so the default NO ACTION applies; campuses are renamed in place (0020a's
-- own `name` column takes update churn, not the row's id) and are never
-- deleted in practice, so this has never mattered for the other three.
--
-- NO DEFAULT. A column added with no default is NULL on every existing row,
-- which is the whole backfill - there is nothing further to UPDATE, and
-- section 3 proves it rather than asserting it by convention alone.
-- -----------------------------------------------------------------------------
alter table public.institute_statuses
  add column if not exists campus_id uuid references public.campuses (id) on delete restrict;

comment on column public.institute_statuses.campus_id is
  'NULL = visible to every campus (every status seeded or added before this '
  'migration, and the default for a new one until an admin says otherwise). '
  'Set = visible only to that campus, its admins, and any team lead who '
  'supervises a rep there - see institute_statuses_select. The PRIMARY KEY is '
  'still the bare status name, so a status name stays globally unique even '
  'once campus-scoped: two campuses cannot each own a different status under '
  'the same name.';

create index if not exists institute_statuses_campus_idx
  on public.institute_statuses (campus_id) where campus_id is not null;


-- -----------------------------------------------------------------------------
-- 2. institute_statuses_select - the visibility rewrite
--
-- FOUR CLAUSES, deliberately not collapsed even where one subsumes another:
--
--   campus_id is null                    - the global case; every row today
--   public.is_admin()                    - unchanged from before this file
--   campus_id = public.my_campus()       - the caller's own campus
--   exists (... public.supervises(r.id)) - a campus holding a rep the caller
--                                           supervises, so a team lead whose
--                                           team crosses campuses (0061) does
--                                           not lose a status on an institute
--                                           one of their own reps holds
--
-- The fourth clause is written AGAINST public.supervises(), not against
-- profiles.team_lead_id directly, for the same reason 0042 rewrote thirty
-- policies that way: one function answers "may the caller see this member's
-- work", and a second hand-written copy of that question is exactly the kind
-- of drift 0010's and 0024's assertion blocks exist to catch elsewhere.
-- supervises(r.id) already returns true for admin and for the caller's own
-- row, so this clause alone would cover most of the other three for a
-- non-admin rep with a profiles row of their own - it is kept alongside them
-- anyway, matching the brief, and because a profiles table with zero rows for
-- a campus (unlikely, but not impossible) would otherwise leave that campus's
-- OWN rep unable to see their OWN campus's statuses through this clause alone.
-- -----------------------------------------------------------------------------
drop policy if exists institute_statuses_select on public.institute_statuses;
create policy institute_statuses_select on public.institute_statuses
  for select to authenticated
  using (
    campus_id is null
    or public.is_admin()
    or campus_id = public.my_campus()
    or exists (
      select 1
      from public.profiles r
      where r.campus_id = institute_statuses.campus_id
        and public.supervises(r.id)
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Prove it landed: the column, the backfill, the policy, and that nothing
--    else on this table moved.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  qual     text;
  n        integer;
begin
  -- 3a. The column, its FK, and its index.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'institute_statuses'
       and column_name = 'campus_id' and is_nullable = 'YES'
  ) then
    problems := array_append(problems, 'institute_statuses.campus_id is missing or not nullable');
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.institute_statuses'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.campuses'::regclass
       and c.confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'institute_statuses.campus_id has no RESTRICT-on-delete foreign key to campuses');
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'institute_statuses'
       and indexname = 'institute_statuses_campus_idx'
  ) then
    problems := array_append(problems, 'institute_statuses_campus_idx is missing');
  end if;

  -- 3b. The backfill: every row that existed before this file is NULL. Since
  --     nothing between section 1 and here writes the column, "every row is
  --     null right now" is exactly "nothing was re-scoped by this migration".
  select count(*) into n from public.institute_statuses where campus_id is not null;
  if n <> 0 then
    problems := array_append(problems,
      format('%s row(s) carry a campus_id - the backfill is supposed to leave every existing row NULL', n));
  end if;

  -- 3c. The policy: the new shape, and the old one gone.
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'institute_statuses_select'
     and polrelid = 'public.institute_statuses'::regclass;

  if qual is null then
    problems := array_append(problems, 'institute_statuses_select is missing');
  else
    if qual = 'true' then
      problems := array_append(problems, 'institute_statuses_select is still using(true) - the rewrite did not apply');
    end if;
    if position('is_admin' in qual) = 0 then
      problems := array_append(problems, 'institute_statuses_select lost its admin clause');
    end if;
    if position('my_campus' in qual) = 0 then
      problems := array_append(problems, 'institute_statuses_select lost its own-campus clause');
    end if;
    if position('supervises' in qual) = 0 then
      problems := array_append(problems, 'institute_statuses_select lost its supervises() clause - a cross-campus team lead would lose statuses');
    end if;
    if position('campus_id is null' in lower(qual)) = 0 then
      problems := array_append(problems, 'institute_statuses_select lost its global (campus_id is null) clause');
    end if;
  end if;

  -- 3d. The write policies are untouched - still exactly admin-gated.
  if not exists (
    select 1 from pg_policy
     where polname = 'institute_statuses_insert'
       and polrelid = 'public.institute_statuses'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'institute_statuses_insert no longer gates on is_admin()');
  end if;
  if not exists (
    select 1 from pg_policy
     where polname = 'institute_statuses_update'
       and polrelid = 'public.institute_statuses'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'institute_statuses_update no longer gates both halves on is_admin()');
  end if;
  if exists (
    select 1 from pg_policy
     where polrelid = 'public.institute_statuses'::regclass and polcmd = 'd'
  ) then
    problems := array_append(problems, 'a DELETE policy now exists on institute_statuses - retiring is still supposed to be the only removal path');
  end if;

  -- 3e. The foreign keys INTO this table (0026, 0046, 0054) are untouched.
  foreach qual in array array[
    'institutes_status_fk', 'visits_status_set_to_fk',
    'follow_up_tasks_status_set_to_fk', 'status_fields_status_fkey'
  ] loop
    if not exists (select 1 from pg_constraint where conname = qual) then
      problems := array_append(problems, format('%s has gone - this migration should not have touched it', qual));
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception '0065 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0065 applied: institute_statuses has a nullable campus_id (% row(s), all '
    'NULL), backed by a RESTRICT-on-delete FK to campuses and a partial index. '
    'institute_statuses_select now reads NULL-or-admin-or-own-campus-or-'
    'supervised-rep''s-campus. Insert/update policies, and every FK into this '
    'table, are untouched.',
    (select count(*) from public.institute_statuses);
end $$;


-- =============================================================================
-- Afterwards
--
--   -- day-one check: every rep/admin still sees all 20, because all 20 are NULL
--   select count(*) from public.institute_statuses;                 -- unaffected
--   select count(*) from public.institute_statuses where campus_id is null; -- same number
--
--   -- scope one status to a campus by hand, to rehearse the next part
--   update public.institute_statuses
--      set campus_id = (select id from public.campuses where short_name = 'Karnavati')
--    where status = 'ZZ Test Status (delete me)';
--
--   -- as that campus's rep (set role authenticated; set request.jwt.claim.sub)
--   select status from public.institute_statuses order by status;
--
--   -- undo the hand-scoping above
--   update public.institute_statuses set campus_id = null
--    where status = 'ZZ Test Status (delete me)';
-- =============================================================================
