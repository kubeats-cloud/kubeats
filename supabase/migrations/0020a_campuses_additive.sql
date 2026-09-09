-- =============================================================================
-- KUbeats - migration 0020a: campuses, and the columns that point at them
--
-- ⚠ THIS IS THE FIRST OF TWO HALVES. RUN THIS ONE FIRST, ON ITS OWN.
--
-- 0020a is ADDITIVE ONLY. It changes no policy and takes nothing away, so the
-- app carries on behaving exactly as it does today after it is applied. That is
-- deliberate: it exists so every rep can be given a campus BEFORE 0020b makes
-- having one matter.
--
-- 0020b flips the policies. Run it before every rep has a campus and those reps
-- see NOTHING - empty institute list, empty daily-plan picker, and the meeting
-- gate refusing every visit because they cannot reach an institute to plan one.
-- That is a total outage for anyone unassigned, which is why the two are split.
--
--     THE GATE BETWEEN THEM IS A QUERY, NOT A JUDGEMENT:
--
--       select count(*) from public.profiles
--        where role = 'rep' and campus_id is null;
--
--     Zero, or do not run 0020b.
--
-- WHY A CAMPUSES TABLE RATHER THAN A COLUMN ON institutes
--
-- The five campuses are the university's OWN premises - the places reps work
-- FROM. public.institutes is the pipeline of prospect schools they work ON.
-- They are two different kinds of thing, and the two rows already in institutes
-- (AMIT, Airport School Ahmedabad) are prospects, not campuses.
--
-- Putting the five into institutes would have put them in the daily-plan
-- picker, so a rep could have planned a visit to their own campus and checked
-- in there; each would have carried one of the nine pipeline statuses and a
-- registered_by; and institutes.campus_id would have pointed into its own table
-- with the five pointing at themselves.
--
-- WHY NOT A CITY
--
-- Two of the five are both Gandhinagar - Karnavati University and UID Karnavati
-- University. A city key merges them, and the requirement is one rep to exactly
-- one campus.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The campuses
--
-- A lookup TABLE rather than a CHECK-constrained text column, for the reason
-- 0010 learned the hard way: a CHECK cannot contain a subquery, so it had to
-- name the nine institute statuses in four places and then write an assertion
-- block to stop the copies drifting. A campus is referenced by three foreign
-- keys and a dropdown; a table gives one authority and referential integrity
-- for nothing.
-- -----------------------------------------------------------------------------
create table if not exists public.campuses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  city        text not null,
  -- Shown where the full name will not fit, e.g. a roster column.
  short_name  text,
  -- False hides it from the add-rep dropdown without deleting it. The demo
  -- campus below is the reason this exists.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint campuses_name_present check (length(btrim(name)) > 0),
  constraint campuses_name_length  check (length(name) <= 200),
  constraint campuses_city_present check (length(btrim(city)) > 0)
);

comment on table public.campuses is
  'The university''s own campuses - the places reps work FROM. NOT the same '
  'thing as public.institutes, which is the pipeline of prospect schools they '
  'work ON. A rep belongs to exactly one campus and sees only its data.';
comment on column public.campuses.active is
  'False keeps a campus out of the add-rep dropdown without deleting it, which '
  'a foreign key from profiles would refuse anyway.';

alter table public.campuses enable row level security;

-- Privileges spelled out rather than relying on 0001's `grant ... on all
-- tables`: that was a one-time statement and cannot reach a table created now.
-- Same reasoning as 0011, 0012 and 0013.
revoke all on public.campuses from authenticated;
revoke all on public.campuses from anon;
grant select on public.campuses to authenticated;
grant insert, update, delete on public.campuses to authenticated;

-- Readable by everyone signed in, and that is not an oversight. A rep needs the
-- NAME of their own campus to see it on screen, the list is five rows of the
-- employer's own premises, and it carries no institute, visit or member data.
-- Scoping it would buy nothing and would stop a rep rendering their own badge.
drop policy if exists campuses_select on public.campuses;
create policy campuses_select on public.campuses
  for select to authenticated
  using (true);

-- Writing one is an admin's job. There are five and they change about never.
drop policy if exists campuses_write on public.campuses;
create policy campuses_write on public.campuses
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- 2. Seed the five, plus one for the demo data
--
-- ON CONFLICT DO NOTHING against the unique name, so a second run is a no-op
-- and a name corrected by hand in the dashboard is not overwritten.
--
-- "S-VYASA University" is seeded as the client asked; the exact spelling is
-- still to be confirmed, and because `name` is the conflict key, correcting it
-- later is an UPDATE rather than a re-seed.
-- -----------------------------------------------------------------------------
insert into public.campuses (name, city, short_name, active) values
  ('Karnavati University Gandhinagar Campus',       'Gandhinagar', 'Karnavati',   true),
  ('UID - Karnavati University Gandhinagar Campus', 'Gandhinagar', 'UID Karnavati', true),
  ('UID - S-VYASA University Bangalore Campus',     'Bangalore',   'UID S-VYASA', true),
  ('UID - G.D. Goenka University Delhi NCR Campus', 'Delhi NCR',   'UID Goenka',  true),
  ('IQ City UWSB Kolkata Campus',                   'Kolkata',     'IQ City UWSB', true),
  -- The demo campus. AMIT, Airport School Ahmedabad and the rep who registered
  -- them are demonstration data, not one of the five, and giving them a home of
  -- their own keeps the five clean for when real data lands.
  --
  -- active = false, so it never appears in the add-rep dropdown. Delete it once
  -- the demo rows are gone:
  --
  --   delete from public.campuses where name like 'Demo %';
  --
  -- ...which the foreign keys will refuse until nothing points at it, which is
  -- exactly the reminder wanted.
  ('Demo - Ahmedabad (demo data only)',             'Ahmedabad',   'Demo',        false)
on conflict (name) do nothing;


-- -----------------------------------------------------------------------------
-- 3. Who belongs to what
--
-- Every column NULLABLE, so not one existing row has to change and nothing here
-- can fail on live data. 0020b adds the rules; this only adds the places to put
-- the answers.
--
-- profiles.campus_id STAYS nullable afterwards, and that is a decision rather
-- than a concession: an ADMIN HAS NO CAMPUS. They see everything, and making
-- them pick one would either be a lie or would put is_admin() and the campus
-- predicate in contradiction. Role decides whether you are scoped; campus
-- decides to what.
--
-- ON DELETE RESTRICT throughout: a campus with people or institutes in it must
-- not be removable by accident.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists campus_id uuid references public.campuses (id) on delete restrict;

alter table public.institutes
  add column if not exists campus_id uuid references public.campuses (id) on delete restrict;

alter table public.materials
  add column if not exists campus_id uuid references public.campuses (id) on delete restrict;

comment on column public.profiles.campus_id is
  'The campus this REP belongs to. NULL for an admin, who has none and sees '
  'everything - enforced by enforce_profile_campus() in 0020b.';
comment on column public.institutes.campus_id is
  'The campus that owns this prospect. A rep sees only their own campus''s.';
comment on column public.materials.campus_id is
  'The campus this material is for. NULL means every campus - the shared '
  'library the app had before scoping, and still the right answer for a '
  'brochure that is not campus-specific.';

create index if not exists profiles_campus_idx   on public.profiles   (campus_id) where campus_id is not null;
create index if not exists institutes_campus_idx on public.institutes (campus_id) where campus_id is not null;
create index if not exists materials_campus_idx  on public.materials  (campus_id) where campus_id is not null;


-- -----------------------------------------------------------------------------
-- 4. public.my_campus()
--
-- The one definition of "my campus", so fifteen policies ask a function rather
-- than repeating a subquery fifteen times.
--
-- SECURITY DEFINER is ESSENTIAL and for the same reason is_admin() needs it:
-- this reads public.profiles, and 0020b puts it inside policies that are
-- themselves evaluated for reads of public.profiles. Without definer rights the
-- two recurse. Because it bypasses RLS it stays narrow - it answers exactly one
-- question and returns one uuid.
--
-- STABLE, not IMMUTABLE: it reads a table.
-- -----------------------------------------------------------------------------
create or replace function public.my_campus()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.campus_id
  from public.profiles p
  where p.id = (select auth.uid());
$$;

comment on function public.my_campus is
  'The caller''s campus, or null for an admin (who has none) and for an '
  'unauthenticated caller. Mirrors is_admin(): SECURITY DEFINER so the policies '
  'on public.profiles can call it without recursing.';

revoke all on function public.my_campus() from public;
revoke all on function public.my_campus() from anon;
grant execute on function public.my_campus() to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Give the demo rows a home
--
-- The two institutes in the database are Ahmedabad schools registered by the
-- demo rep. They are prospects, not campuses, and they are demonstration data -
-- so they go to the demo campus rather than being guessed into one of the five.
--
-- Written as "where campus_id is null" so a second run touches nothing, and so
-- a row an admin has already assigned by hand is left alone.
-- -----------------------------------------------------------------------------
do $$
declare
  v_demo uuid;
  v_institutes integer;
  v_reps integer;
begin
  select id into v_demo from public.campuses where name = 'Demo - Ahmedabad (demo data only)';
  if v_demo is null then
    raise exception 'The demo campus is missing; section 2 did not run.';
  end if;

  update public.institutes set campus_id = v_demo where campus_id is null;
  get diagnostics v_institutes = row_count;

  -- Reps only. An admin keeps a null campus on purpose.
  update public.profiles
     set campus_id = v_demo
   where campus_id is null
     and role = 'rep';
  get diagnostics v_reps = row_count;

  raise notice
    'Demo campus: % institute(s) and % rep(s) assigned. Admins left with no '
    'campus, which is correct.', v_institutes, v_reps;
end $$;


-- -----------------------------------------------------------------------------
-- 6. Prove it landed, and prove the gate is open
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  seeded    integer;
  unassigned integer;
  c text;
  expected text[] := array[
    'Karnavati University Gandhinagar Campus',
    'UID - Karnavati University Gandhinagar Campus',
    'UID - S-VYASA University Bangalore Campus',
    'UID - G.D. Goenka University Delhi NCR Campus',
    'IQ City UWSB Kolkata Campus'
  ];
begin
  foreach c in array expected loop
    if not exists (select 1 from public.campuses where name = c) then
      problems := problems || format('campus %L was not seeded', c);
    end if;
  end loop;

  select count(*) into seeded from public.campuses where active;
  if seeded <> 5 then
    problems := problems || format('%s active campuses, expected the 5', seeded);
  end if;

  for c in select unnest(array['profiles', 'institutes', 'materials']) loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = c and column_name = 'campus_id'
    ) then
      problems := problems || format('%s.campus_id is missing', c);
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_campus'
  ) then
    problems := problems || 'my_campus() is missing';
  end if;

  -- is_admin() is NOT touched by this file, and admin visibility is unchanged
  -- everywhere. If it has gone, something else is wrong.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    problems := problems || 'is_admin() has gone missing';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0020a did not fully apply: %',
      array_to_string(problems, '; ');
  end if;

  select count(*) into unassigned
    from public.profiles where role = 'rep' and campus_id is null;

  raise notice
    'Campuses in place: 5 active + 1 demo, three campus_id columns, '
    'my_campus(). NOTHING IS SCOPED YET - 0020a changes no policy.';

  if unassigned = 0 then
    raise notice
      'GATE OPEN: every rep has a campus. 0020b is safe to run.';
  else
    raise warning
      'GATE CLOSED: % rep(s) still have no campus. Assign them before running '
      '0020b, or they will see nothing at all.', unassigned;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 7. Check it took
--
--   select name, city, active from public.campuses order by active desc, name;
--
--   -- THE GATE. Must be zero before 0020b.
--   select count(*) from public.profiles where role = 'rep' and campus_id is null;
--
--   -- who is where
--   select p.name, p.role, c.name as campus
--     from public.profiles p
--     left join public.campuses c on c.id = p.campus_id
--    order by p.role, p.name;
--
--   -- and which campus owns each prospect
--   select i.name, c.name as campus
--     from public.institutes i
--     left join public.campuses c on c.id = i.campus_id;
-- -----------------------------------------------------------------------------
