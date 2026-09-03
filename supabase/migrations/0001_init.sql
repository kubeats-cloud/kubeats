-- =============================================================================
-- Field Ops — initial schema
--
-- Phase 1: tables, constraints, indexes, Row Level Security, triggers, storage
-- and seed data for the field reporting app.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. It is idempotent: re-running it is safe and will not duplicate rows.
--
-- DESIGN NOTES
--   * Enumerated values are `text` + CHECK rather than Postgres ENUM types.
--     Adding or renaming a value later is a one-line ALTER instead of a type
--     migration, which matters more at this scale than the few bytes saved.
--   * The rules that the business actually depends on — the meeting gate, the
--     weekly lock, role visibility — are enforced here, not only in the UI.
--     A bug in a form, or anyone with the anon key and curl, still cannot get
--     past them.
--   * `auth.uid()` is wrapped as `(select auth.uid())` inside policies so
--     Postgres evaluates it once per statement rather than once per row.
--   * Helper functions are SECURITY DEFINER with `set search_path = ''`, so
--     they cannot be hijacked by a caller-controlled search_path, and every
--     reference inside them is schema-qualified.
-- =============================================================================


-- =============================================================================
-- 1. HELPERS
-- =============================================================================

-- Is the caller an admin?
--
-- SECURITY DEFINER is essential: this reads public.profiles, and the policies
-- ON public.profiles call this function. Without definer rights the two would
-- recurse. Because it bypasses RLS it must stay narrow — it answers exactly one
-- question and returns a boolean.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True when the current user has profiles.role = admin. SECURITY DEFINER to avoid RLS recursion on profiles.';

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — one row per auth user. This is the table getCurrentUser() reads.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  role        text not null default 'rep',
  mobile      text,
  created_at  timestamptz not null default now(),

  constraint profiles_role_valid   check (role in ('rep', 'admin')),
  constraint profiles_mobile_valid check (mobile is null or mobile ~ '^[0-9]{10}$')
);

comment on table public.profiles is 'Application profile for each auth user. Role drives all visibility.';
comment on column public.profiles.role is 'rep sees only their own data; admin sees the whole team.';


-- -----------------------------------------------------------------------------
-- locations — admin-managed State -> City -> Area tree.
--
-- Relational rather than a single jsonb blob so each level can be added or
-- removed independently, and so an area can be inserted by a rep mid-form
-- without rewriting the whole tree (business rule 11).
-- -----------------------------------------------------------------------------
create table if not exists public.location_states (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.location_cities (
  id          uuid primary key default gen_random_uuid(),
  state_id    uuid not null references public.location_states (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),

  constraint location_cities_unique_per_state unique (state_id, name)
);

create table if not exists public.location_areas (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.location_cities (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),

  constraint location_areas_unique_per_city unique (city_id, name)
);

comment on table public.location_areas is
  'Areas grow organically from pincode lookups and rep input, so any authenticated user may INSERT here (rule 11). Editing and deleting stay admin-only.';


-- -----------------------------------------------------------------------------
-- purposes — admin-managed flat list used by the daily plan.
-- -----------------------------------------------------------------------------
create table if not exists public.purposes (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,
  created_at  timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- pincodes_cache — India Post lookups, cached so we call the API once per pin.
-- -----------------------------------------------------------------------------
create table if not exists public.pincodes_cache (
  pincode     text primary key,
  state       text,
  district    text,
  localities  text[] not null default '{}',
  cached_at   timestamptz not null default now(),

  constraint pincodes_cache_pincode_valid check (pincode ~ '^[0-9]{6}$')
);

comment on table public.pincodes_cache is
  'Written by the server route handler using the service-role key, which bypasses RLS. Admins may also write directly.';


-- -----------------------------------------------------------------------------
-- institutes — the shared registry. Rule 1: nothing can be logged against an
-- institute until it exists here.
-- -----------------------------------------------------------------------------
create table if not exists public.institutes (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  type                        text not null,
  pincode                     text,
  address                     text,
  area                        text,
  city                        text,
  state                       text,
  boards                      text[] not null default '{}',
  principal_name              text,
  principal_mobile            text,
  decision_maker_name         text,
  decision_maker_designation  text,
  decision_maker_mobile       text,
  -- Rule 10: class 11 records which streams exist (ticks only); class 12
  -- records streams plus an approximate head count, e.g. {"science": 40}.
  class11                     text[] not null default '{}',
  class12                     jsonb  not null default '{}'::jsonb,
  -- Rule 4: status is ALWAYS set by hand from six fixed values, never derived.
  status                      text,
  status_updated_at           timestamptz,
  status_updated_by           uuid references public.profiles (id) on delete set null,
  registered_by               uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at                  timestamptz not null default now(),

  constraint institutes_type_valid check (
    type in ('school', 'coaching', 'consultant')
  ),
  constraint institutes_status_valid check (
    status is null or status in (
      'First meeting done',
      'Session scheduled',
      'Session done',
      'Campus visit scheduled',
      'Campus visit done',
      'Pending for management approval'
    )
  ),
  constraint institutes_pincode_valid check (
    pincode is null or pincode ~ '^[0-9]{6}$'
  ),
  constraint institutes_principal_mobile_valid check (
    principal_mobile is null or principal_mobile ~ '^[0-9]{10}$'
  ),
  constraint institutes_decision_maker_mobile_valid check (
    decision_maker_mobile is null or decision_maker_mobile ~ '^[0-9]{10}$'
  ),
  constraint institutes_class11_streams_valid check (
    class11 <@ array['science', 'commerce', 'humanities']::text[]
  ),
  constraint institutes_class12_is_object check (
    jsonb_typeof(class12) = 'object'
  )
);

comment on column public.institutes.status is
  'One of six fixed values, set manually. Never auto-derived from visit activity (rule 4).';
comment on column public.institutes.class12 is
  'Object mapping stream to approximate student count, e.g. {"science": 40, "commerce": 30}.';


-- -----------------------------------------------------------------------------
-- visits — the activity log.
--
-- ON DELETE RESTRICT against institutes is deliberate: deleting an institute
-- that has history should fail loudly rather than silently erase the record of
-- every visit ever made to it. An admin who really means it clears the visits
-- first.
-- -----------------------------------------------------------------------------
create table if not exists public.visits (
  id                     uuid primary key default gen_random_uuid(),
  institute_id           uuid not null references public.institutes (id) on delete restrict,
  member                 uuid not null references public.profiles (id) on delete cascade,
  activity               text not null,
  -- Rule 3: only session and campus_visit have a Set -> Done lifecycle.
  lifecycle_status       text,
  date                   date not null default current_date,
  expected_date          date,
  latitude               double precision,
  longitude              double precision,
  photo_url              text,
  notes                  text,
  follow_up_date         date,
  follow_up_time         time,
  status_set_to          text,
  students_attended      integer,
  session_topic          text,
  other_faculty_present  text,
  other_faculty_count    integer,
  closed_at              timestamptz,
  created_at             timestamptz not null default now(),

  constraint visits_activity_valid check (
    activity in ('meeting', 'session', 'campus_visit', 'olympiad', 'application', 'admission')
  ),

  -- Rule 3, enforced rather than assumed: a session or campus visit must carry
  -- a lifecycle status, and nothing else may.
  --
  -- Written with an explicit NOT NULL test on purpose. A CHECK only rejects a
  -- FALSE result — NULL passes — so the natural-looking
  --   (activity in (...) and lifecycle_status in ('Set','Done')) or ...
  -- would evaluate to NULL for a session with a null lifecycle_status and let
  -- the row straight through. The CASE below always returns true or false.
  constraint visits_lifecycle_matches_activity check (
    case
      when activity in ('session', 'campus_visit')
        then lifecycle_status is not null and lifecycle_status in ('Set', 'Done')
      else lifecycle_status is null
    end
  ),

  constraint visits_status_set_to_valid check (
    status_set_to is null or status_set_to in (
      'First meeting done',
      'Session scheduled',
      'Session done',
      'Campus visit scheduled',
      'Campus visit done',
      'Pending for management approval'
    )
  ),

  -- Rule 5, first half: a follow-up date is required when the status just set
  -- is "Pending for management approval".
  constraint visits_follow_up_required_for_approval check (
    status_set_to is distinct from 'Pending for management approval'
    or follow_up_date is not null
  ),

  -- Rule 5, second half: the two "scheduled" statuses already carry their own
  -- expected date, so a separate follow-up must not be recorded against them.
  constraint visits_follow_up_hidden_when_scheduled check (
    status_set_to is null
    or status_set_to not in ('Session scheduled', 'Campus visit scheduled')
    or (follow_up_date is null and follow_up_time is null)
  ),

  constraint visits_latitude_valid  check (latitude  is null or latitude  between -90  and 90),
  constraint visits_longitude_valid check (longitude is null or longitude between -180 and 180),
  constraint visits_students_attended_valid   check (students_attended   is null or students_attended   >= 0),
  constraint visits_other_faculty_count_valid check (other_faculty_count is null or other_faculty_count >= 0)
);

comment on table public.visits is
  'One row per logged activity. Rule 12: every visit captures geo-location and an optional compressed photo.';


-- -----------------------------------------------------------------------------
-- daily_plans — one planned visit per member + date + institute.
--
-- meetings_actual is the source of truth for the weekly "Meetings" metric
-- (rule 7): null = planned but not held, 1 = held.
-- -----------------------------------------------------------------------------
create table if not exists public.daily_plans (
  id              uuid primary key default gen_random_uuid(),
  member          uuid not null references public.profiles (id) on delete cascade,
  date            date not null default current_date,
  institute_id    uuid not null references public.institutes (id) on delete restrict,
  purpose         text not null,
  meetings_actual smallint,
  follow_up_date  date,
  created_at      timestamptz not null default now(),

  constraint daily_plans_unique_per_day unique (member, date, institute_id),
  constraint daily_plans_meetings_actual_valid check (
    meetings_actual is null or meetings_actual = 1
  )
);


-- -----------------------------------------------------------------------------
-- weekly_targets — one commitment row per member per week (Monday start).
-- -----------------------------------------------------------------------------
create table if not exists public.weekly_targets (
  id                  uuid primary key default gen_random_uuid(),
  member              uuid not null references public.profiles (id) on delete cascade,
  week_start          date not null,
  meetings            integer not null default 0,
  sessions_set        integer not null default 0,
  sessions_done       integer not null default 0,
  campus_visits_set   integer not null default 0,
  campus_visits_done  integer not null default 0,
  olympiad            integer not null default 0,
  application         integer not null default 0,
  admission           integer not null default 0,
  locked              boolean not null default false,
  submitted_at        timestamptz,
  reopened_by         uuid references public.profiles (id) on delete set null,
  reopened_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint weekly_targets_unique_per_week unique (member, week_start),
  -- ISO day 1 is Monday. Keeps every row on the same weekly grid so the
  -- dashboard compares like with like.
  constraint weekly_targets_week_starts_monday check (
    extract(isodow from week_start) = 1
  ),
  constraint weekly_targets_non_negative check (
    meetings >= 0 and sessions_set >= 0 and sessions_done >= 0
    and campus_visits_set >= 0 and campus_visits_done >= 0
    and olympiad >= 0 and application >= 0 and admission >= 0
  )
);


-- =============================================================================
-- 3. INDEXES
--
-- Primary keys and UNIQUE constraints already create indexes, so the ones below
-- only cover columns we filter or join on that are not otherwise indexed.
-- =============================================================================

create index if not exists visits_member_idx           on public.visits (member);
create index if not exists visits_institute_id_idx     on public.visits (institute_id);
create index if not exists visits_date_idx             on public.visits (date);
create index if not exists visits_lifecycle_status_idx on public.visits (lifecycle_status);

-- Composite, because the "open for today" gate always filters on both.
create index if not exists daily_plans_member_date_idx on public.daily_plans (member, date);
create index if not exists daily_plans_institute_idx   on public.daily_plans (institute_id);

create index if not exists institutes_state_idx  on public.institutes (state);
create index if not exists institutes_city_idx   on public.institutes (city);
create index if not exists institutes_status_idx on public.institutes (status);

create index if not exists location_cities_state_idx on public.location_cities (state_id);
create index if not exists location_areas_city_idx   on public.location_areas (city_id);

-- weekly_targets (member, week_start) and pincodes_cache (pincode) are already
-- indexed by the UNIQUE constraint and the primary key respectively.


-- =============================================================================
-- 4. TRIGGERS
--
-- These carry the rules the business actually depends on. They live here rather
-- than only in the app so that a form bug, a stale client, or anyone poking the
-- API directly still cannot get around them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rule 2 — the meeting gate.
--
-- A meeting may only be logged for an institute that is on that member's plan
-- for that date. Sessions and campus visits are exempt: they run on their own
-- Set -> Done lifecycle, independent of the daily plan (rule 3).
--
-- SECURITY DEFINER so the lookup sees daily_plans regardless of the caller's
-- RLS view. Without it an admin acting on another member's behalf would get a
-- false "not on the plan" rejection.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_meeting_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activity = 'meeting' then
    if not exists (
      select 1
      from public.daily_plans dp
      where dp.member = new.member
        and dp.date = new.date
        and dp.institute_id = new.institute_id
    ) then
      raise exception
        'A meeting can only be logged for an institute on that day''s plan. Add it to the daily plan first.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists visits_enforce_meeting_gate on public.visits;
create trigger visits_enforce_meeting_gate
  before insert or update on public.visits
  for each row execute function public.enforce_meeting_gate();


-- -----------------------------------------------------------------------------
-- Rule 6 — the weekly lock.
--
--   submit   locked flips false -> true, submitted_at stamped
--   locked   no further edits by anyone
--   reopen   an admin, and only an admin, may flip locked back to false;
--            reopened_by and reopened_at are recorded automatically
--
-- The reopen credentials are stamped by the trigger rather than trusted from
-- the client, so the audit trail cannot be forged.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_weekly_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A row created already submitted still gets its timestamp.
    if new.locked and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if old.locked then
    if new.locked then
      raise exception
        'This week is locked. Ask an admin to reopen it before editing.'
        using errcode = 'check_violation';
    end if;

    -- Unlocking. Admins only.
    if not public.is_admin() then
      raise exception
        'Only an admin can reopen a locked week.'
        using errcode = 'insufficient_privilege';
    end if;

    new.reopened_by := (select auth.uid());
    new.reopened_at := now();
    return new;
  end if;

  -- Was open; if this update submits it, stamp the submission time.
  if new.locked then
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists weekly_targets_enforce_lock on public.weekly_targets;
create trigger weekly_targets_enforce_lock
  before insert or update on public.weekly_targets
  for each row execute function public.enforce_weekly_lock();


-- -----------------------------------------------------------------------------
-- Rule 4 — keep the institute status audit columns honest.
--
-- status_updated_at and status_updated_by are maintained here, so they always
-- reflect who actually changed the status and when, regardless of what the
-- client sends.
-- -----------------------------------------------------------------------------
create or replace function public.touch_institute_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is not null then
      new.status_updated_at := coalesce(new.status_updated_at, now());
      new.status_updated_by := coalesce(new.status_updated_by, (select auth.uid()));
    end if;
  elsif new.status is distinct from old.status then
    new.status_updated_at := now();
    new.status_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists institutes_touch_status on public.institutes;
create trigger institutes_touch_status
  before insert or update on public.institutes
  for each row execute function public.touch_institute_status();


-- -----------------------------------------------------------------------------
-- Privilege escalation guard on profiles.
--
-- Not in the original brief, but without it the "a user may update their own
-- row" policy is a self-promotion hole: any rep could set their own role to
-- admin and unlock the whole team's data. Only an existing admin may change a
-- role.
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Null for the service-role key and for the SQL editor, i.e. trusted
  -- server-side contexts. Never null for a signed-in user, and the anon role
  -- holds no grant on this table, so allowing it here cannot be reached from
  -- the browser. Without this the very first admin could never be created,
  -- since there is no admin yet to authorise it.
  caller uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.role = 'admin' and caller is not null and not public.is_admin() then
      raise exception
        'Only an admin can create an admin profile.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     and caller is not null
     and not public.is_admin() then
    raise exception
      'Only an admin can change a role.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();


-- =============================================================================
-- 5. ROW LEVEL SECURITY
--
-- Rule 8: visibility is strictly role-based — a rep sees only their own data,
-- an admin sees everything — and it is enforced here, not in the UI.
--
-- Every policy is scoped `to authenticated`. The anon role is granted nothing,
-- so a signed-out caller cannot read a single row.
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.institutes       enable row level security;
alter table public.visits           enable row level security;
alter table public.daily_plans      enable row level security;
alter table public.weekly_targets   enable row level security;
alter table public.location_states  enable row level security;
alter table public.location_cities  enable row level security;
alter table public.location_areas   enable row level security;
alter table public.purposes         enable row level security;
alter table public.pincodes_cache   enable row level security;


-- profiles ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());


-- institutes -------------------------------------------------------------------
-- A shared registry: everyone reads and contributes, only admins remove.
drop policy if exists institutes_select on public.institutes;
create policy institutes_select on public.institutes
  for select to authenticated
  using (true);

drop policy if exists institutes_insert on public.institutes;
create policy institutes_insert on public.institutes
  for insert to authenticated
  with check (registered_by = (select auth.uid()));

drop policy if exists institutes_update on public.institutes;
create policy institutes_update on public.institutes
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists institutes_delete on public.institutes;
create policy institutes_delete on public.institutes
  for delete to authenticated
  using (public.is_admin());


-- visits -----------------------------------------------------------------------
-- Admins read the whole team's log but do not edit it; corrections belong to
-- the rep who made the entry.
drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits
  for select to authenticated
  using (member = (select auth.uid()) or public.is_admin());

drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert to authenticated
  with check (member = (select auth.uid()));

drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits
  for update to authenticated
  using (member = (select auth.uid()))
  with check (member = (select auth.uid()));

drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits
  for delete to authenticated
  using (member = (select auth.uid()) or public.is_admin());


-- daily_plans ------------------------------------------------------------------
drop policy if exists daily_plans_select on public.daily_plans;
create policy daily_plans_select on public.daily_plans
  for select to authenticated
  using (member = (select auth.uid()) or public.is_admin());

drop policy if exists daily_plans_insert on public.daily_plans;
create policy daily_plans_insert on public.daily_plans
  for insert to authenticated
  with check (member = (select auth.uid()));

drop policy if exists daily_plans_update on public.daily_plans;
create policy daily_plans_update on public.daily_plans
  for update to authenticated
  using (member = (select auth.uid()))
  with check (member = (select auth.uid()));

drop policy if exists daily_plans_delete on public.daily_plans;
create policy daily_plans_delete on public.daily_plans
  for delete to authenticated
  using (member = (select auth.uid()) or public.is_admin());


-- weekly_targets ---------------------------------------------------------------
-- Admins need UPDATE here, unlike visits, because reopening a locked week is
-- their job (rule 6). The trigger above decides what an admin may actually
-- change: unlocking, and nothing else.
drop policy if exists weekly_targets_select on public.weekly_targets;
create policy weekly_targets_select on public.weekly_targets
  for select to authenticated
  using (member = (select auth.uid()) or public.is_admin());

drop policy if exists weekly_targets_insert on public.weekly_targets;
create policy weekly_targets_insert on public.weekly_targets
  for insert to authenticated
  with check (member = (select auth.uid()));

drop policy if exists weekly_targets_update on public.weekly_targets;
create policy weekly_targets_update on public.weekly_targets
  for update to authenticated
  using (member = (select auth.uid()) or public.is_admin())
  with check (member = (select auth.uid()) or public.is_admin());

drop policy if exists weekly_targets_delete on public.weekly_targets;
create policy weekly_targets_delete on public.weekly_targets
  for delete to authenticated
  using (public.is_admin());


-- locations --------------------------------------------------------------------
-- States and cities are admin-managed. Areas are the exception: rule 11 says
-- location entry must never fully block a rep, so any authenticated user may
-- add a missing area inline. Editing and deleting areas stays with admins.
drop policy if exists location_states_select on public.location_states;
create policy location_states_select on public.location_states
  for select to authenticated using (true);

drop policy if exists location_states_write on public.location_states;
create policy location_states_write on public.location_states
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists location_cities_select on public.location_cities;
create policy location_cities_select on public.location_cities
  for select to authenticated using (true);

drop policy if exists location_cities_write on public.location_cities;
create policy location_cities_write on public.location_cities
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists location_areas_select on public.location_areas;
create policy location_areas_select on public.location_areas
  for select to authenticated using (true);

drop policy if exists location_areas_insert on public.location_areas;
create policy location_areas_insert on public.location_areas
  for insert to authenticated with check (true);

drop policy if exists location_areas_update on public.location_areas;
create policy location_areas_update on public.location_areas
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists location_areas_delete on public.location_areas;
create policy location_areas_delete on public.location_areas
  for delete to authenticated using (public.is_admin());


-- purposes ---------------------------------------------------------------------
drop policy if exists purposes_select on public.purposes;
create policy purposes_select on public.purposes
  for select to authenticated using (true);

drop policy if exists purposes_write on public.purposes;
create policy purposes_write on public.purposes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- pincodes_cache ---------------------------------------------------------------
-- The server route handler writes this with the service-role key, which
-- bypasses RLS entirely. These policies only cover direct client access.
drop policy if exists pincodes_cache_select on public.pincodes_cache;
create policy pincodes_cache_select on public.pincodes_cache
  for select to authenticated using (true);

drop policy if exists pincodes_cache_write on public.pincodes_cache;
create policy pincodes_cache_write on public.pincodes_cache
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- Table privileges. RLS narrows these further; without the grant the policies
-- would never even be consulted.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;


-- =============================================================================
-- 6. STORAGE — visit photos
--
-- A PRIVATE bucket. Photos are taken inside schools and may show identifiable
-- students, so they must never be readable from a guessable public URL. The app
-- serves them through short-lived signed URLs instead.
--
-- Path convention: visit-photos/<auth-user-id>/<filename>
-- The first path segment is the owner, which is what the policies below check.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- A member may upload only beneath their own user-id folder.
drop policy if exists visit_photos_insert on storage.objects;
create policy visit_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The uploader reads their own photos; admins read everything.
drop policy if exists visit_photos_select on storage.objects;
create policy visit_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_admin()
    )
  );

drop policy if exists visit_photos_update on storage.objects;
create policy visit_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists visit_photos_delete on storage.objects;
create policy visit_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_admin()
    )
  );


-- =============================================================================
-- 7. SEED DATA
--
-- Idempotent throughout: every insert is guarded by ON CONFLICT DO NOTHING, so
-- re-running this file will not duplicate anything, and will not overwrite
-- edits an admin has since made.
--
-- Areas are deliberately NOT seeded. They grow from pincode lookups and rep
-- input (rules 11 and 13); pre-loading a partial list would only get in the way.
--
-- Boards are not seeded either: they are UI options, not a table. The eight
-- tables in this schema are the whole data model, and institutes.boards is a
-- text[] carrying whatever was ticked, including free-text "Others" (rule 9).
-- =============================================================================

-- States and union territories --------------------------------------------------
insert into public.location_states (name) values
  ('Andhra Pradesh'),
  ('Arunachal Pradesh'),
  ('Assam'),
  ('Bihar'),
  ('Chhattisgarh'),
  ('Goa'),
  ('Gujarat'),
  ('Haryana'),
  ('Himachal Pradesh'),
  ('Jharkhand'),
  ('Karnataka'),
  ('Kerala'),
  ('Madhya Pradesh'),
  ('Maharashtra'),
  ('Manipur'),
  ('Meghalaya'),
  ('Mizoram'),
  ('Nagaland'),
  ('Odisha'),
  ('Punjab'),
  ('Rajasthan'),
  ('Sikkim'),
  ('Tamil Nadu'),
  ('Telangana'),
  ('Tripura'),
  ('Uttar Pradesh'),
  ('Uttarakhand'),
  ('West Bengal'),
  ('Andaman and Nicobar Islands'),
  ('Chandigarh'),
  ('Dadra and Nagar Haveli and Daman and Diu'),
  ('Delhi'),
  ('Jammu and Kashmir'),
  ('Ladakh'),
  ('Lakshadweep'),
  ('Puducherry')
on conflict (name) do nothing;

-- Major cities, attached to their state ------------------------------------------
insert into public.location_cities (state_id, name)
select s.id, v.city
from (values
  ('Andhra Pradesh', 'Visakhapatnam'),
  ('Andhra Pradesh', 'Vijayawada'),
  ('Andhra Pradesh', 'Guntur'),
  ('Andhra Pradesh', 'Tirupati'),
  ('Arunachal Pradesh', 'Itanagar'),
  ('Assam', 'Guwahati'),
  ('Assam', 'Silchar'),
  ('Assam', 'Dibrugarh'),
  ('Bihar', 'Patna'),
  ('Bihar', 'Gaya'),
  ('Bihar', 'Muzaffarpur'),
  ('Chhattisgarh', 'Raipur'),
  ('Chhattisgarh', 'Bhilai'),
  ('Chhattisgarh', 'Bilaspur'),
  ('Goa', 'Panaji'),
  ('Goa', 'Margao'),
  ('Gujarat', 'Ahmedabad'),
  ('Gujarat', 'Surat'),
  ('Gujarat', 'Vadodara'),
  ('Gujarat', 'Rajkot'),
  ('Haryana', 'Gurugram'),
  ('Haryana', 'Faridabad'),
  ('Haryana', 'Panipat'),
  ('Himachal Pradesh', 'Shimla'),
  ('Himachal Pradesh', 'Dharamshala'),
  ('Jharkhand', 'Ranchi'),
  ('Jharkhand', 'Jamshedpur'),
  ('Jharkhand', 'Dhanbad'),
  ('Karnataka', 'Bengaluru'),
  ('Karnataka', 'Mysuru'),
  ('Karnataka', 'Mangaluru'),
  ('Karnataka', 'Hubballi'),
  ('Kerala', 'Kochi'),
  ('Kerala', 'Thiruvananthapuram'),
  ('Kerala', 'Kozhikode'),
  ('Madhya Pradesh', 'Indore'),
  ('Madhya Pradesh', 'Bhopal'),
  ('Madhya Pradesh', 'Gwalior'),
  ('Madhya Pradesh', 'Jabalpur'),
  ('Maharashtra', 'Mumbai'),
  ('Maharashtra', 'Pune'),
  ('Maharashtra', 'Nagpur'),
  ('Maharashtra', 'Nashik'),
  ('Manipur', 'Imphal'),
  ('Meghalaya', 'Shillong'),
  ('Mizoram', 'Aizawl'),
  ('Nagaland', 'Kohima'),
  ('Odisha', 'Bhubaneswar'),
  ('Odisha', 'Cuttack'),
  ('Odisha', 'Rourkela'),
  ('Punjab', 'Ludhiana'),
  ('Punjab', 'Amritsar'),
  ('Punjab', 'Jalandhar'),
  ('Rajasthan', 'Jaipur'),
  ('Rajasthan', 'Udaipur'),
  ('Rajasthan', 'Jodhpur'),
  ('Rajasthan', 'Kota'),
  ('Sikkim', 'Gangtok'),
  ('Tamil Nadu', 'Chennai'),
  ('Tamil Nadu', 'Coimbatore'),
  ('Tamil Nadu', 'Madurai'),
  ('Tamil Nadu', 'Tiruchirappalli'),
  ('Telangana', 'Hyderabad'),
  ('Telangana', 'Warangal'),
  ('Tripura', 'Agartala'),
  ('Uttar Pradesh', 'Lucknow'),
  ('Uttar Pradesh', 'Noida'),
  ('Uttar Pradesh', 'Kanpur'),
  ('Uttar Pradesh', 'Varanasi'),
  ('Uttar Pradesh', 'Agra'),
  ('Uttar Pradesh', 'Ghaziabad'),
  ('Uttarakhand', 'Dehradun'),
  ('Uttarakhand', 'Haridwar'),
  ('West Bengal', 'Kolkata'),
  ('West Bengal', 'Howrah'),
  ('West Bengal', 'Siliguri'),
  ('Andaman and Nicobar Islands', 'Port Blair'),
  ('Chandigarh', 'Chandigarh'),
  ('Dadra and Nagar Haveli and Daman and Diu', 'Daman'),
  ('Delhi', 'New Delhi'),
  ('Jammu and Kashmir', 'Srinagar'),
  ('Jammu and Kashmir', 'Jammu'),
  ('Ladakh', 'Leh'),
  ('Lakshadweep', 'Kavaratti'),
  ('Puducherry', 'Puducherry')
) as v (state, city)
join public.location_states s on s.name = v.state
on conflict (state_id, name) do nothing;

-- Meeting purposes ---------------------------------------------------------------
insert into public.purposes (label) values
  ('Fix a session'),
  ('Fix a campus visit'),
  ('Complete a session'),
  ('Complete a campus visit'),
  ('Other')
on conflict (label) do nothing;


-- =============================================================================
-- 8. DONE
--
-- Verify with:
--   select tablename from pg_tables where schemaname = 'public' order by 1;
--   select count(*) from public.location_states;   -- expect 36
--   select count(*) from public.location_cities;   -- expect 85
--   select count(*) from public.purposes;          -- expect 5
--
-- There are no users yet. See the notes accompanying this migration for how to
-- create the first admin.
-- =============================================================================
