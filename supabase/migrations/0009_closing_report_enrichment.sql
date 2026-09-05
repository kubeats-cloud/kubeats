-- =============================================================================
-- Field Ops — closing-report enrichment
--
-- Brings the closing report closer to the client's Closing Report spec. This
-- ENRICHES the report; it does not touch the visit workflow, the meeting gate,
-- People Met, or anything about how a visit is logged.
--
-- Everything here is nullable. A visit filed before this migration, and every
-- quick log after it, is unaffected — the new columns simply stay empty. The
-- app decides which of these to insist on and when; the CHECKs below only fix
-- the vocabulary, exactly as 0005 did.
--
-- Two existing CHECKs are widened (session participation gains "Very High",
-- activities_conducted gains "Faculty Interaction"). Both changes are supersets,
-- so every existing row still satisfies the re-added constraint.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run: adds are guarded, and the two widened CHECKs are
--   dropped-then-re-added.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. New columns on public.visits. All nullable.
-- -----------------------------------------------------------------------------
alter table public.visits
  -- B) Student interaction. students_attended already exists (0001) and is kept
  --    distinct: "reached" is how many the visit put the message in front of,
  --    "attended" is how many were actually in the session.
  add column if not exists students_reached         integer,
  add column if not exists most_interested_programs text[],
  add column if not exists student_intent           text,
  -- C) Management interest level, separate from the management_response
  --    checkboxes and management_feedback text that already exist.
  add column if not exists management_interest       text,
  -- D) A primary outcome category, separate from visit_outcome (which is the
  --    quality judgment: successful / partially / follow-up / …). This is what
  --    concretely resulted.
  add column if not exists primary_outcome           text;

comment on column public.visits.students_reached is
  'How many students the visit reached, distinct from students_attended.';
comment on column public.visits.most_interested_programs is
  'Programs students showed the most interest in. Subset of a fixed list.';
comment on column public.visits.student_intent is
  'Where the students landed on the interest ladder, single value.';
comment on column public.visits.management_interest is
  'Management''s interest level, single value — separate from their response '
  'checkboxes and their verbatim feedback.';
comment on column public.visits.primary_outcome is
  'The primary outcome category of the visit, separate from visit_outcome.';


-- -----------------------------------------------------------------------------
-- 2. CHECK constraints for the new enumerated columns. Arrays use <@ so every
--    element must be in the list; null always passes.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visits_students_reached_valid') then
    alter table public.visits add constraint visits_students_reached_valid check (
      students_reached is null or students_reached >= 0
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_most_interested_programs_valid') then
    alter table public.visits add constraint visits_most_interested_programs_valid check (
      most_interested_programs is null or most_interested_programs <@ array[
        'Engineering',
        'Computer Science',
        'AI/ML',
        'Management',
        'Design',
        'Commerce',
        'Law',
        'Other'
      ]::text[]
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_student_intent_valid') then
    alter table public.visits add constraint visits_student_intent_valid check (
      student_intent is null or student_intent in (
        'Just Information',
        'Exploring Options',
        'Interested',
        'Strongly Interested',
        'Ready for Campus Visit'
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_management_interest_valid') then
    alter table public.visits add constraint visits_management_interest_valid check (
      management_interest is null or management_interest in (
        'Low', 'Medium', 'High', 'Very High'
      )
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visits_primary_outcome_valid') then
    alter table public.visits add constraint visits_primary_outcome_valid check (
      primary_outcome is null or primary_outcome in (
        'Meeting completed',
        'Career session completed',
        'Campus visit discussed',
        'Campus visit confirmed',
        'Application drive planned',
        'Follow-up meeting required',
        'Information requested',
        'Admission discussion completed',
        'Partnership discussion initiated',
        'Other'
      )
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Widen two existing CHECKs (0005). Dropped then re-added so the new value
--    is accepted; both are supersets, so existing rows still pass.
-- -----------------------------------------------------------------------------

-- E1) session participation gains "Very High".
alter table public.visits drop constraint if exists visits_session_participation_valid;
alter table public.visits add constraint visits_session_participation_valid check (
  session_participation is null or session_participation in (
    'Low', 'Moderate', 'High', 'Very High'
  )
);

-- E2) activities_conducted gains "Faculty Interaction".
alter table public.visits drop constraint if exists visits_activities_conducted_valid;
alter table public.visits add constraint visits_activities_conducted_valid check (
  activities_conducted is null or activities_conducted <@ array[
    'Introduction meeting',
    'Management meeting',
    'Career guidance session',
    'Seminar or workshop',
    'Faculty Interaction',
    'Campus visit',
    'Olympiad registration',
    'Application collection',
    'Admission counselling',
    'Follow-up discussion'
  ]::text[]
);
