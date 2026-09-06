-- =============================================================================
-- KUbeats - migration 0016: the database half of the four-pass re-audit
--
-- WHY
--
-- A full re-audit (functional, security, cross-feature, migration) ran against
-- the live site and produced 621 assertions, no security vulnerabilities and no
-- cross-feature regressions. It did find four things the database should be
-- saying for itself rather than trusting the application to say. That is this
-- file.
--
--   F-1  an institute could be saved with no name and no boards
--   F-2  half a coordinate pair could be stored, silently losing a position
--   N-1  any rep could reassign who registered a school, with no audit trail
--   F-4  an arrival time could be rewritten after the fact
--
-- A fifth finding, M-1, is deliberately NOT fixed. Section 5 says why, and what
-- was done instead.
--
-- SAFE TO APPLY BEFORE THE CODE SHIPS, and safe to apply after. Nothing here
-- changes a function signature or a column type; it only refuses data that the
-- application already refuses. The branch that accompanies it changes scripts
-- and documentation, not the shape of anything the database returns.
--
-- CHECKED AGAINST PRODUCTION FIRST. A CHECK constraint is validated against
-- every existing row as it is added, so a single bad row would make this file
-- fail halfway. Every constraint below was run as a query against live data
-- before this was written:
--
--   institutes_name_present            0 of 6 violate  (longest name 28 chars)
--   institutes_name_length             0 of 6 violate
--   institutes_boards_present          0 of 6 violate
--   visits_coords_paired               0 of 5 violate
--   daily_plans_checkin_coords_paired  0 of 1 violate
--   daily_plans_checkout_coords_paired 0 of 1 violate
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. F-1 - an institute needs a name and at least one board
--
-- Both rules already exist in `instituteSchema` (zod) and are enforced on every
-- path through the UI. They were not in the database, and RLS lets a rep insert
-- an institute directly with the anon key, so "" was a storable name. The
-- wording mirrors materials_title_present / materials_title_length, which set
-- this pattern in 0012 - a title and a name are the same kind of promise.
--
-- 200 characters matches the materials cap and the zod schema. It is generous
-- for a school name and small enough that a paste accident cannot fill a page.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'institutes_name_present') then
    alter table public.institutes add constraint institutes_name_present check (
      length(btrim(name)) > 0
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'institutes_name_length') then
    alter table public.institutes add constraint institutes_name_length check (
      length(name) <= 200
    );
  end if;

  -- array_length returns NULL for an empty array rather than 0, which is the
  -- trap this is written around: `array_length(boards,1) >= 1` is NULL for
  -- `{}`, and a CHECK only rejects FALSE. coalesce makes the refusal explicit.
  if not exists (select 1 from pg_constraint where conname = 'institutes_boards_present') then
    alter table public.institutes add constraint institutes_boards_present check (
      coalesce(array_length(boards, 1), 0) >= 1
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. F-2 - a coordinate pair arrives whole or not at all
--
-- The existing constraints check each coordinate's RANGE independently:
--
--   (checkin_lat is null or checkin_lat between -90 and 90)
--   and (checkin_lng is null or checkin_lng between -180 and 180)
--
-- Both halves pass when one is null, so a latitude with no longitude was
-- storable. Nothing in the app produces that today - every writer sets the two
-- together - but a half pair renders as "location unavailable" while looking
-- like a recorded position in the table, which is the worst of both. After
-- migration 0015 made accuracy part of the record, a position that is half
-- there is worth refusing outright.
--
-- Stated as an equality of nullness rather than two implications, because that
-- is the whole rule in one line and cannot be half-applied.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visits_coords_paired') then
    alter table public.visits add constraint visits_coords_paired check (
      (latitude is null) = (longitude is null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkin_coords_paired') then
    alter table public.daily_plans add constraint daily_plans_checkin_coords_paired check (
      (checkin_lat is null) = (checkin_lng is null)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'daily_plans_checkout_coords_paired') then
    alter table public.daily_plans add constraint daily_plans_checkout_coords_paired check (
      (checkout_lat is null) = (checkout_lng is null)
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. N-1 - who registered a school cannot be reassigned by a rep
--
-- `institutes_update` is `using (true) with check (true)`, which is deliberate:
-- the institute list is a shared registry, and Rule 4 says a status is set by
-- hand by whoever visited, not only by whoever registered the school. The
-- audit found that the same blanket policy also let any rep rewrite
-- `registered_by` to themselves. Status changes leave a trail in
-- institute_status_history; an ownership change left none at all.
--
-- So the registry stays open - names, contacts and status are still editable by
-- any rep, exactly as before - and this one column stops moving.
--
-- An admin may still correct it, and so may the service role and the SQL
-- editor. That follows guard_profile_role rather than guard_photo_final: a
-- photograph is evidence and nobody may touch it, but "who registered this
-- school" is administrative bookkeeping that an admin can legitimately fix
-- after a person leaves the team.
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
begin
  if new.registered_by is distinct from old.registered_by
     and caller is not null
     and not public.is_admin() then
    raise exception
      'Who registered an institute cannot be changed.'
      using errcode = 'FO010';
  end if;
  return new;
end;
$$;

comment on function public.guard_institute_owner is
  'Keeps institutes.registered_by immutable for a rep. Admins, the service '
  'role and the SQL editor may still correct it. Raises FO010.';

drop trigger if exists institutes_guard_owner on public.institutes;

create trigger institutes_guard_owner
  before update of registered_by on public.institutes
  for each row
  execute function public.guard_institute_owner();


-- -----------------------------------------------------------------------------
-- 4. F-4 - an arrival time is written once
--
-- check_in stamps when a rep says they arrived, and everything downstream reads
-- it: the derived Scheduled / In Progress / Completed status, the minutes on
-- site, and the meeting gate that will not accept a meeting without it. A
-- second check-in overwrote the first, moving the arrival time and with it the
-- duration. The UI cannot do this - the button is gone once checked in - but
-- the column was writable directly.
--
-- This follows guard_photo_final exactly, as the audit asked: ABSOLUTE, with no
-- admin exception and none for the service role either. A check-in is the same
-- kind of claim as a photograph - "I was here, then" - and the moment it has an
-- exception it stops being one.
--
-- Null -> a time is the check-in itself and is allowed. A time -> a different
-- time, or a time -> null, is not. The escape route for a genuine mistake is
-- the one the Dashboard already offers: remove the plan entry and add it again,
-- which is a new row and an honest new arrival time.
-- -----------------------------------------------------------------------------
create or replace function public.guard_checkin_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.checkin_at is not null
     and new.checkin_at is distinct from old.checkin_at then
    raise exception
      'The arrival time was recorded on arrival and cannot be changed afterwards.'
      using errcode = 'FO011';
  end if;
  return new;
end;
$$;

comment on function public.guard_checkin_final is
  'daily_plans.checkin_at is write-once. Follows guard_photo_final: no '
  'exception for an admin or the service role. Raises FO011.';

drop trigger if exists daily_plans_checkin_final on public.daily_plans;

create trigger daily_plans_checkin_final
  before update of checkin_at on public.daily_plans
  for each row
  execute function public.guard_checkin_final();


-- -----------------------------------------------------------------------------
-- 5. M-1 - NOT fixed here, and why
--
-- Re-running the whole chain used to fail at 0001 with
--
--   ERROR: relation "weekly_targets_unique_per_week" already exists
--
-- because 0013 renames the TABLE weekly_targets to weekly_targets_pre_0013 and
-- constraint names travel with it, so 0001 collides on a name that is still
-- taken. This file originally freed those names. That fix was written, tested,
-- and then removed, because it makes things worse rather than better:
--
--   freeing the names let 0001 re-create weekly_targets on a re-run
--     -> 0013 then failed: relation "weekly_targets_pre_0013" already exists
--     -> and this file's own guard then pointed at the wrong table
--
-- One collision became three. The root cause is not a missing guard: it is that
-- 0001 creates a table a later migration renames away, so replaying 0001 over a
-- migrated database is asking for a state the chain has already moved past.
--
-- THE CHAIN IS THEREFORE FORWARD-ONLY, and that is now written down in
-- docs/BACKUP-RESTORE.md. Each migration is individually idempotent - re-running
-- any ONE of them is safe, which is what a fix or a partial failure needs. What
-- is not supported is replaying the whole chain over a database that has
-- already had it. A rehearsal applies the chain to a FRESH database, which is
-- what a rehearsal should do anyway.
--
-- 0002 and 0008 were still worth fixing and were: their bare
-- `comment on function public.log_visit` now names its twelve arguments, so it
-- cannot become ambiguous once 0015 adds the thirteen-argument version.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 6. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  expected text[] := array[
    'institutes_name_present', 'institutes_name_length', 'institutes_boards_present',
    'visits_coords_paired', 'daily_plans_checkin_coords_paired',
    'daily_plans_checkout_coords_paired'
  ];
  c text;
begin
  foreach c in array expected loop
    if not exists (select 1 from pg_constraint where conname = c) then
      problems := problems || format('constraint %s is missing', c);
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger t join pg_class r on r.oid = t.tgrelid
     where r.relname = 'institutes' and t.tgname = 'institutes_guard_owner'
  ) then
    problems := problems || 'trigger institutes_guard_owner is missing';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class r on r.oid = t.tgrelid
     where r.relname = 'daily_plans' and t.tgname = 'daily_plans_checkin_final'
  ) then
    problems := problems || 'trigger daily_plans_checkin_final is missing';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0016 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  raise notice 'Audit fixes: 6 constraints and 2 triggers in place.';
end $$;


-- -----------------------------------------------------------------------------
-- Check it took:
--
--   -- all six must be listed
--   select conname from pg_constraint
--    where conname in ('institutes_name_present','institutes_name_length',
--                      'institutes_boards_present','visits_coords_paired',
--                      'daily_plans_checkin_coords_paired',
--                      'daily_plans_checkout_coords_paired');
--
--   -- and each of these must fail
--   insert into public.institutes (name, type, boards, state, city, area)
--   values ('', 'school', array['CBSE'], 'Gujarat', 'Ahmedabad', 'Satellite');
--
--   update public.visits set latitude = 23.02, longitude = null
--    where id = (select id from public.visits limit 1);
--
--   -- FO011, even as the service role
--   update public.daily_plans set checkin_at = now()
--    where checkin_at is not null;
-- -----------------------------------------------------------------------------
