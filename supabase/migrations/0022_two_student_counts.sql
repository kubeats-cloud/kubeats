-- =============================================================================
-- KUbeats - migration 0022: the closing report's SECOND student count
--
-- ⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS, like 0018 and 0019.
--
-- It REPLACES close_visit() with a signature that has one more argument, and
-- that is a moment when two versions could exist at once. Section 2 explains
-- why that would break every submission, and drops the old one rather than
-- trusting that it will not happen. The assertion block at the foot counts the
-- overloads.
--
-- WHAT CHANGED
--
-- The closing report asked one question about students and the client's spec
-- asks two:
--
--   Students PRESENT       everybody who was in the room, or who came to see
--                          the campus
--   Students PARTICIPATED  how many of those actually took part
--
-- Asked on the two statuses that have students in them - "Session done" and
-- "Campus visit done". NEITHER IS COMPULSORY: a rep who did not count heads
-- must still be able to file, which is how the single count has always behaved.
-- The only rule between them lives in the form - participated may not exceed
-- present - and is deliberately NOT a CHECK here; see section 1.
--
-- NO COLUMN IS CREATED AND NONE IS DROPPED.
--
--   students_attended   is PRESENT. Live since 0001, collected by every version
--                       of the report, and its meaning does not move.
--   students_reached    is PARTICIPATED. Built by 0009, collected briefly by
--                       the long report, dormant for the whole of stage 3. It
--                       is the second student count, so it comes back rather
--                       than a third column being invented.
--
-- So this file is close_visit() carrying one more argument, plus two column
-- comments - which is exactly what CLAUDE.md predicts a field coming back
-- should cost.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. students_reached is live again, and it now means something NARROWER
--
-- ⚠ THIS IS A REDEFINITION, AND 0009 SAYS THE OPPOSITE. It built "reached" as
-- the WIDER of the pair - its own comment reads "how many students the visit
-- reached, distinct from students_attended", and the long report's help text
-- said "often more than attended". Under the client's spec the second number is
-- how many of those PRESENT took part, which is a SUBSET. The containment is
-- reversed.
--
-- The column is reused anyway, and deliberately:
--
--   * It is the second student count. Adding a third column so that two of them
--     can be permanently empty is worse than one restated comment.
--   * Renaming it to students_participated would leave
--     visits_students_reached_valid carrying a stale name, and would touch every
--     backup manifest, every saved query and the retired long-report schema, for
--     a word no rep ever sees. The label a rep reads lives in
--     `feedback-fields.tsx`.
--
-- WHAT THIS COSTS, STATED HONESTLY. A report filed by the retired long form can
-- hold a students_reached that is LARGER than students_attended and means the
-- old thing. Those rows are left exactly as they are - rewriting them would be
-- inventing data - and `report-view.tsx` labels them "Students reached" rather
-- than "Students who participated", switching on activities_conducted, which
-- only the long form ever wrote.
--
-- ...which is also why participated <= present is a FORM rule and not a CHECK:
-- a constraint would have refused to build against those very rows. Same lesson
-- as 0019's met_name, which stayed "null, or valid" for the same reason.
-- -----------------------------------------------------------------------------
comment on column public.visits.students_reached is
  'Students who PARTICIPATED - how many of those present actually took part. '
  'Live again as of 0022, as the second of the two counts the client''s spec '
  'asks for. NOTE: 0009 built this column as the WIDER number ("often more than '
  'attended") and rows filed by the retired long report still carry that older, '
  'opposite sense; the app labels those by era rather than rewriting them. '
  'Never required, and never rejected for exceeding students_attended - that '
  'rule is the form''s, because the pre-0022 rows would fail it.';

comment on column public.visits.students_attended is
  'Students PRESENT - everybody who was in the room, or who came to see the '
  'campus. Unchanged since 0001; 0022 only sharpens the word the rep reads, and '
  'pairs it with students_reached. Asked whenever the status is "Session done" '
  'or "Campus visit done". Never required.';


-- -----------------------------------------------------------------------------
-- 2. close_visit(), carrying both counts
--
-- REPRODUCED IN FULL, because a function cannot be patched - the same reason
-- 0015 reproduced log_visit() and 0019 reproduced this one. The body below is
-- 0019's, character for character, with exactly two changes: p_students_reached
-- arrives after p_students_attended, and the UPDATE writes it.
--
-- THE DROP BELOW IS NOT OPTIONAL. CREATE OR REPLACE cannot replace a function
-- whose signature has changed - it creates a SECOND one. With both present, a
-- call naming the arguments they share is ambiguous and Postgres refuses it:
-- every feedback submission would fail, from both the Log Visit screen and the
-- standalone one. This is what 0015 documents at length after it happened to
-- log_visit, what 0019 guarded against in turn, and what the assertion at the
-- foot of this file counts.
-- -----------------------------------------------------------------------------
create or replace function public.close_visit(
  p_visit_id             uuid,
  p_daily_plan_id        uuid,
  p_notes                text             default null,
  p_institute_interested boolean          default null,
  p_visit_outcome        text             default null,
  p_management_response  text[]           default null,
  p_student_response     text             default null,
  p_met_name             text             default null,
  p_met_phone            text             default null,
  -- The two student counts. PRESENT, then PARTICIPATED. Both nullable, both
  -- optional, and neither is checked against the other here - see section 1.
  p_students_attended    integer          default null,
  p_students_reached     integer          default null,
  p_session_topic        text             default null,
  p_session_taken_by     text             default null,
  p_closes_visit_id      uuid             default null,
  p_checkout_lat         double precision default null,
  p_checkout_lng         double precision default null,
  p_checkout_accuracy    double precision default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member uuid := (select auth.uid());
  v_visit  public.visits%rowtype;
  v_prior  public.visits%rowtype;
begin
  if v_member is null then
    raise exception 'You must be signed in to file this.' using errcode = 'FO004';
  end if;

  select * into v_visit
    from public.visits
   where id = p_visit_id and member = v_member
   for update;

  if not found then
    raise exception 'That visit could not be found, or it is not yours.'
      using errcode = 'FO017';
  end if;

  if v_visit.reported_at is not null then
    raise exception 'That visit has already been filed.' using errcode = 'FO018';
  end if;

  update public.visits
     set notes                = coalesce(p_notes, notes),
         institute_interested = p_institute_interested,
         visit_outcome        = p_visit_outcome,
         management_response  = p_management_response,
         student_response     = p_student_response,
         met_name             = p_met_name,
         met_phone            = p_met_phone,
         students_attended    = p_students_attended,
         students_reached     = p_students_reached,
         session_topic        = p_session_topic,
         session_taken_by     = p_session_taken_by,
         closes_visit_id      = p_closes_visit_id,
         daily_plan_id        = coalesce(p_daily_plan_id, daily_plan_id),
         reported_at          = now(),
         closed_at            = case
                                  when lifecycle_status = 'Done' then now()
                                  else closed_at
                                end
   where id = p_visit_id
     and member = v_member;

  if p_closes_visit_id is not null then
    select * into v_prior
      from public.visits
     where id = p_closes_visit_id
       and member = v_member
       and institute_id = v_visit.institute_id
       and lifecycle_status = 'Set'
       and closed_at is null
     for update;

    if not found then
      raise exception 'That earlier visit cannot be closed from here.'
        using errcode = 'FO019';
    end if;

    update public.visits
       set closed_at = now()
     where id = p_closes_visit_id
       and member = v_member;
  end if;

  if p_daily_plan_id is not null then
    update public.daily_plans
       set checkout_at       = now(),
           checkout_lat      = p_checkout_lat,
           checkout_lng      = p_checkout_lng,
           checkout_accuracy = p_checkout_accuracy
     where id = p_daily_plan_id
       and member = v_member
       and checkin_at is not null
       and checkout_at is null;
  end if;
end;
$$;

-- 0019's 16-argument version must go, or a call naming only the arguments the
-- two share matches both and every save fails as ambiguous.
--
-- Guarded with to_regprocedure, which resolves one exact signature and returns
-- null when it is absent. 0015 warns against the obvious alternative:
-- pg_get_function_identity_arguments includes the PARAMETER NAMES, so comparing
-- it to a bare list of types looks right and never matches, leaving the drop as
-- dead code and both overloads in place.
do $$
begin
  if to_regprocedure(
       'public.close_visit(uuid, uuid, text, boolean, text, text[], text, text, '
       'text, integer, text, text, uuid, double precision, double precision, '
       'double precision)'
     ) is not null then
    drop function public.close_visit(
      uuid, uuid, text, boolean, text, text[], text, text, text, integer, text,
      text, uuid, double precision, double precision, double precision
    );
    raise notice 'Dropped 0019''s 16-argument close_visit; the 17-argument one replaces it.';
  end if;
end $$;

revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) to authenticated;

comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision
) is
  'Files the closing report, closes any earlier "Set" it completed, and checks '
  'the rep out - one transaction. Runs as the calling rep, so RLS and every '
  'trigger still apply. Raises FO004 and FO017-FO019. Carries BOTH student '
  'counts as of 0022: p_students_attended is PRESENT, p_students_reached is '
  'PARTICIPATED.';


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  overloads integer;
  r         record;
begin
  -- EXACTLY ONE close_visit, or every feedback submission fails as ambiguous.
  -- This is the check that matters most in this file.
  select count(*) into overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_visit';
  if overloads <> 1 then
    problems := problems || format('there are %s close_visit overloads, expected exactly 1', overloads);
  end if;

  -- ...and it must be the new one, with an integer in eleventh place.
  if to_regprocedure(
       'public.close_visit(uuid, uuid, text, boolean, text, text[], text, text, '
       'text, integer, integer, text, text, uuid, double precision, '
       'double precision, double precision)'
     ) is null then
    problems := problems || 'the 17-argument close_visit is missing';
  end if;

  -- Still SECURITY INVOKER, which is what makes campus scoping (0020b) apply
  -- inside it. A DEFINER rewrite would punch a hole through that boundary.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'close_visit' and p.prosecdef
  ) then
    problems := problems
      || 'close_visit is SECURITY DEFINER - campus scoping would not apply inside it';
  end if;

  -- log_visit is not touched by this file, and must still be a single overload
  -- for exactly the same reason (0015).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'log_visit') <> 1 then
    problems := problems || 'log_visit is no longer a single overload';
  end if;

  -- EVERY AUDITED GUARD STILL STANDING. This file carries one more number; it
  -- must not have moved anything that was already load-bearing.
  if not exists (select 1 from pg_trigger where tgname = 'visits_enforce_meeting_gate'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'Rule 2 (enforce_meeting_gate) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'visits_require_checkin'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'the presence guarantee (FO009) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'daily_plans_checkin_final'
                   and tgrelid = 'public.daily_plans'::regclass and not tgisinternal) then
    problems := problems || 'FO011 write-once arrival has gone';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visits_photo_required') then
    problems := problems || 'Rule 12 (visits_photo_required) has gone';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'visits_photo_final'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal) then
    problems := problems || 'FO008 write-once photo has gone';
  end if;

  -- The two columns this file pairs up must both still be there, with 0009's
  -- "null, or >= 0" CHECK on the one coming back. Neither is created here.
  for r in
    select unnest(array['students_attended', 'students_reached']) as col
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'visits'
         and column_name = r.col and data_type = 'integer'
    ) then
      problems := problems || format('visits.%s is missing or is not an integer', r.col);
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'visits_students_reached_valid') then
    problems := problems || 'visits_students_reached_valid (0009) has gone';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0022 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  raise notice
    'Two student counts: close_visit carries p_students_attended (present) and '
    'p_students_reached (participated), as a single 17-argument overload. Every '
    'audited guard still standing.';
end $$;


-- -----------------------------------------------------------------------------
-- 4. Check it took
--
--   -- exactly one, and it takes two integers in a row
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'close_visit';
--
--   -- what the reports are saying. Post-0022 rows should have reached <=
--   -- attended; rows where reached is the LARGER number were filed by the
--   -- retired long report and carry the older, opposite sense.
--   select date, students_attended as present, students_reached as participated,
--          activities_conducted is not null as long_report_era
--     from public.visits
--    where reported_at is not null
--      and (students_attended is not null or students_reached is not null)
--    order by reported_at desc limit 20;
-- -----------------------------------------------------------------------------
