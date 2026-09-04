-- =============================================================================
-- Field Ops — the rich closing report, and admin-assigned visits
--
-- Two additions, both built on what is already here rather than beside it.
--
--   1. A closing report for the three activities where what happened actually
--      needs describing: meeting, session, campus_visit. Everything is added as
--      NULLABLE columns on public.visits plus one related table for the people
--      met, so every visit already logged stays valid and the quick activities
--      (olympiad, application, admission) are untouched. Which fields are
--      REQUIRED depends on what the rep says happened, and that is decided in
--      the app — a CHECK cannot know that a session was conducted.
--
--   2. An admin may put a visit on another member's daily plan. This reuses
--      daily_plans and the meeting gate exactly as they are; the only change is
--      who may insert a row, and a record of who did.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
--
-- The vocabularies below are mirrored in src/lib/validation/closing-report.ts.
-- If you add a value, add it in both places — the CHECK is the backstop, the
-- TypeScript is what the rep sees.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The closing report's own columns on public.visits
--
-- All nullable. A visit logged before this migration, and every quick log after
-- it, simply leaves them empty.
-- -----------------------------------------------------------------------------
alter table public.visits
  add column if not exists activities_conducted   text[],
  add column if not exists student_response       text,
  add column if not exists student_interest       smallint,
  add column if not exists management_response    text[],
  add column if not exists management_feedback    text,
  add column if not exists discussion_summary     text,
  add column if not exists visit_outcome          text,
  add column if not exists applications_collected integer,
  add column if not exists admissions_generated   integer,
  -- Session detail. students_attended, session_topic, other_faculty_present and
  -- other_faculty_count already exist from 0001 and are reused as they are.
  add column if not exists session_class          text,
  add column if not exists session_streams        text[],
  add column if not exists session_duration_mins  integer,
  add column if not exists session_participation  text,
  add column if not exists student_questions      text,
  -- Wired to the follow-up that already exists (follow_up_date, follow_up_time).
  add column if not exists follow_up_action       text,
  add column if not exists employee_remarks       text,
  -- Stamped when the report is filed, so "has a report" is a fact, not a guess
  -- assembled from whichever columns happen to be non-null.
  add column if not exists reported_at            timestamptz;

comment on column public.visits.activities_conducted is
  'What the rep actually did, which is not the same as the purpose the visit '
  'was planned under. Drives which other fields the app insists on.';

comment on column public.visits.reported_at is
  'When the closing report was filed. Null means no report yet.';


-- Enumerated values. Arrays use <@ so every element must be in the list.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visits_activities_conducted_valid') then
    alter table public.visits add constraint visits_activities_conducted_valid check (
      activities_conducted is null or activities_conducted <@ array[
        'Introduction meeting',
        'Management meeting',
        'Career guidance session',
        'Seminar or workshop',
        'Campus visit',
        'Olympiad registration',
        'Application collection',
        'Admission counselling',
        'Follow-up discussion'
      ]::text[]
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_student_response_valid') then
    alter table public.visits add constraint visits_student_response_valid check (
      student_response is null or student_response in (
        'Very positive', 'Positive', 'Mixed', 'Low interest', 'No students present'
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_management_response_valid') then
    alter table public.visits add constraint visits_management_response_valid check (
      management_response is null or management_response <@ array[
        'Supportive',
        'Interested',
        'Wants a proposal',
        'Needs internal approval',
        'Budget concerns',
        'Not interested',
        'Not available'
      ]::text[]
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_visit_outcome_valid') then
    alter table public.visits add constraint visits_visit_outcome_valid check (
      visit_outcome is null or visit_outcome in (
        'Successful', 'Partially successful', 'Follow-up required',
        'Postponed', 'Not interested'
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_session_participation_valid') then
    alter table public.visits add constraint visits_session_participation_valid check (
      session_participation is null or session_participation in ('High', 'Moderate', 'Low')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_session_class_valid') then
    alter table public.visits add constraint visits_session_class_valid check (
      session_class is null or session_class in ('9', '10', '11', '12', 'Mixed')
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_session_streams_valid') then
    alter table public.visits add constraint visits_session_streams_valid check (
      session_streams is null or session_streams <@ array['science', 'commerce', 'humanities']::text[]
    );
  end if;

  -- Numbers that cannot be negative, and a 1-5 interest rating.
  if not exists (select 1 from pg_constraint where conname = 'visits_student_interest_valid') then
    alter table public.visits add constraint visits_student_interest_valid check (
      student_interest is null or student_interest between 1 and 5
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_applications_collected_valid') then
    alter table public.visits add constraint visits_applications_collected_valid check (
      applications_collected is null or applications_collected >= 0
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_admissions_generated_valid') then
    alter table public.visits add constraint visits_admissions_generated_valid check (
      admissions_generated is null or admissions_generated >= 0
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_session_duration_valid') then
    alter table public.visits add constraint visits_session_duration_valid check (
      session_duration_mins is null or session_duration_mins between 0 and 600
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. People met, one row each
--
-- A related table rather than an array, because each person has a shape: who
-- they are, what they do, whether they can actually decide anything. Free-typed
-- per visit on purpose — the person in the room is often not in the institute's
-- contact record, and a rep must never be blocked by that.
-- -----------------------------------------------------------------------------
create table if not exists public.visit_people (
  id               uuid primary key default gen_random_uuid(),
  visit_id         uuid not null references public.visits (id) on delete cascade,
  name             text not null,
  contact_type     text not null,
  designation      text,
  contact_number   text,
  is_decision_maker boolean not null default false,
  created_at       timestamptz not null default now(),

  constraint visit_people_name_present check (length(btrim(name)) > 0),
  constraint visit_people_contact_type_valid check (
    contact_type in (
      'Principal', 'Vice Principal', 'Career Counsellor', 'Management',
      'Coordinator', 'Faculty', 'Admission Counsellor', 'Owner', 'Other'
    )
  ),
  constraint visit_people_contact_number_valid check (
    contact_number is null or contact_number ~ '^[0-9]{10}$'
  )
);

comment on table public.visit_people is
  'The people met on a visit, typed in by the rep. Cascades with the visit.';

create index if not exists visit_people_visit_id_idx on public.visit_people (visit_id);

alter table public.visit_people enable row level security;

-- Visibility follows the parent visit exactly: a rep sees the people from their
-- own visits, an admin sees everyone's. Writes belong to the visit's owner
-- alone — an admin reads the report, they do not edit someone's account of it.
drop policy if exists visit_people_select on public.visit_people;
create policy visit_people_select on public.visit_people
  for select to authenticated
  using (
    exists (
      select 1 from public.visits v
      where v.id = visit_id
        and (v.member = (select auth.uid()) or public.is_admin())
    )
  );

drop policy if exists visit_people_insert on public.visit_people;
create policy visit_people_insert on public.visit_people
  for insert to authenticated
  with check (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.member = (select auth.uid())
    )
  );

drop policy if exists visit_people_update on public.visit_people;
create policy visit_people_update on public.visit_people
  for update to authenticated
  using (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.member = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.visits v
      where v.id = visit_id and v.member = (select auth.uid())
    )
  );

drop policy if exists visit_people_delete on public.visit_people;
create policy visit_people_delete on public.visit_people
  for delete to authenticated
  using (
    exists (
      select 1 from public.visits v
      where v.id = visit_id
        and (v.member = (select auth.uid()) or public.is_admin())
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Admin-assigned visits
--
-- The model does not change: a rep still plans their own day, the meeting gate
-- still checks daily_plans, and an assigned entry is an ordinary row on the
-- rep's plan. All that is new is that an admin may create one for someone else,
-- and that the row remembers who did.
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  add column if not exists assigned_by uuid references public.profiles (id) on delete set null,
  add column if not exists assigned_at timestamptz;

comment on column public.daily_plans.assigned_by is
  'The admin who put this on someone else''s plan. Null for a rep''s own entry.';

create index if not exists daily_plans_assigned_by_idx
  on public.daily_plans (assigned_by)
  where assigned_by is not null;

-- The insert policy, widened by exactly one case.
--
-- Before: you may only create your own plan entry. Now: that, OR an admin
-- creating one for someone else and signing it. The admin branch requires
-- assigned_by = auth.uid(), so an admin cannot write an assignment under
-- another admin's name, and a rep cannot reach the branch at all because
-- is_admin() is false for them.
drop policy if exists daily_plans_insert on public.daily_plans;
create policy daily_plans_insert on public.daily_plans
  for insert to authenticated
  with check (
    member = (select auth.uid())
    or (public.is_admin() and assigned_by = (select auth.uid()))
  );

-- An admin also needs to be able to withdraw an assignment they made.
drop policy if exists daily_plans_delete on public.daily_plans;
create policy daily_plans_delete on public.daily_plans
  for delete to authenticated
  using (member = (select auth.uid()) or public.is_admin());

/**
 * Keeps the assignment record honest.
 *
 * The policy above decides who may insert a row. This decides what the row may
 * claim: you can only name yourself as the assigner, planning your own day is
 * never an assignment, and assigned_at is stamped here rather than trusted from
 * the client — the same reasoning as the weekly lock's reopened_by.
 *
 * On UPDATE it polices only a CHANGE to the assignment. That distinction is the
 * whole point: marking a plan entry held is an ordinary update made by the rep,
 * on a row that may carry an admin's name as the assigner. Treating that as an
 * attempt to forge an assignment would stop a rep logging the very visit they
 * were assigned, and nulling the field "because it is their own row" would
 * erase who asked for it.
 */
create or replace function public.guard_plan_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.assigned_by is not null and caller is not null
       and new.assigned_by is distinct from caller then
      raise exception 'You can only assign a visit in your own name.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Planning your own day is not an assignment, whatever the form sent.
    if new.member = caller then
      new.assigned_by := null;
      new.assigned_at := null;
      return new;
    end if;

    if new.assigned_by is not null and new.assigned_at is null then
      new.assigned_at := now();
    end if;

    return new;
  end if;

  if new.assigned_by is distinct from old.assigned_by then
    if new.assigned_by is not null and caller is not null
       and new.assigned_by is distinct from caller then
      raise exception 'You can only assign a visit in your own name.'
        using errcode = 'insufficient_privilege';
    end if;
    new.assigned_at := case when new.assigned_by is null then null else now() end;
  end if;

  return new;
end;
$$;

drop trigger if exists daily_plans_guard_assignment on public.daily_plans;
create trigger daily_plans_guard_assignment
  before insert or update on public.daily_plans
  for each row execute function public.guard_plan_assignment();
