-- =============================================================================
-- KUbeats - migration 0019: the closing report's final field set
--
-- ⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS, like 0018.
--
-- It REPLACES close_visit(), and a replacement with a different signature is a
-- moment when two versions could exist at once. Section 2 explains why that
-- would break every save, and drops the old one rather than trusting that it
-- will not happen.
--
-- WHY 0019 AND NOT AN EDIT TO 0018
--
-- 0018 has been applied. The chain is forward-only (0016 section 5), so a file
-- that has already run is a record of what the database was told, not a draft:
-- editing it would leave 0018 describing a close_visit() that no database ever
-- had. This file is the change, and 0018 keeps its history.
--
-- WHAT CHANGED, AND WHY IT NEEDS SO LITTLE
--
-- The closing report's final shape adds back the OUTCOME and MANAGEMENT
-- RESPONSE dropdowns and keeps STUDENT RESPONSE; it drops the management
-- interest LEVEL that stage 3 briefly collected.
--
-- All four columns already exist, with their vocabulary CHECKs, from 0005 and
-- 0009. Not one is created here and not one is dropped. Three simply stop being
-- dormant and one starts being dormant - which is the whole point of having
-- kept them: a field coming back is a form change, and a migration only because
-- close_visit() has to carry it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Two triggers that were only half-installed
--
-- FOUND BY A TEST, not by reading the file. 0018 attached
-- enforce_checkin_located and enforce_one_open_visit as
--
--     before update of checkin_at on public.daily_plans
--
-- which is right for how the app works - it inserts a plan row when the visit
-- is planned and UPDATES checkin_at when the rep arrives - and wrong for what
-- the rules claim. A row INSERTED with checkin_at already set never fires
-- either trigger, so a single request could create an arrival with no location
-- and no declared reason, or a second open visit, and neither rule would speak.
--
-- The unique index caught the second case (a 23505 with no sentence); nothing
-- caught the first at all.
--
-- Both are re-attached to INSERT as well. The functions are unchanged: each one
-- already guards on `old` being absent, and on INSERT `old` is null in a
-- BEFORE INSERT trigger, so the null-checks below make the intent explicit
-- rather than relying on that.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_checkin_located()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- On INSERT there is no OLD row at all; on UPDATE we only care about the
  -- moment an arrival is first recorded.
  if tg_op = 'UPDATE' and old.checkin_at is not null then
    return new;
  end if;
  if new.checkin_at is null then
    return new;
  end if;

  if new.checkin_lat is null
     and coalesce(new.checkin_location_manual, false) = false then
    raise exception
      'A location is needed to check in. Turn location on, or say why it is not available.'
      using errcode = 'FO012';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_one_open_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_other text;
begin
  if tg_op = 'UPDATE' and old.checkin_at is not null then
    return new;
  end if;
  if new.checkin_at is null then
    return new;
  end if;

  select i.name into v_other
    from public.daily_plans dp
    join public.institutes i on i.id = dp.institute_id
   where dp.member = new.member
     and dp.id <> new.id
     and dp.checkin_at is not null
     and dp.checkout_at is null
     and dp.checkout_missing = false
   limit 1;

  if v_other is not null then
    raise exception
      'You are still checked in at %. Finish that visit first.', v_other
      using errcode = 'FO013';
  end if;

  return new;
end;
$$;

drop trigger if exists daily_plans_checkin_located on public.daily_plans;
create trigger daily_plans_checkin_located
  before insert or update of checkin_at on public.daily_plans
  for each row execute function public.enforce_checkin_located();

drop trigger if exists daily_plans_one_open_visit_guard on public.daily_plans;
create trigger daily_plans_one_open_visit_guard
  before insert or update of checkin_at on public.daily_plans
  for each row execute function public.enforce_one_open_visit();


-- -----------------------------------------------------------------------------
-- 2. close_visit(), with the report's final field set
--
-- REPRODUCED IN FULL, because a function cannot be patched - the same reason
-- 0015 reproduced log_visit(). The body below is 0018's, character for
-- character, with exactly four changes: p_management_interest is gone,
-- p_visit_outcome / p_management_response / p_student_response arrive in its
-- place, and the UPDATE writes the three instead of the one.
--
-- p_management_response is a text[] because the column always was one - 0005
-- built it for checkboxes. The form offers a single value and sends a
-- one-element array, so visits_management_response_valid is satisfied unchanged
-- and widening the control back to a multi-select later needs no migration.
--
-- THE DROP BELOW IS NOT OPTIONAL. CREATE OR REPLACE cannot replace a function
-- whose signature has changed - it creates a SECOND one. With both present a
-- call naming the arguments they share is ambiguous, and Postgres refuses it:
-- every feedback submission would fail. This is exactly what 0015 documents at
-- length after it happened to log_visit, and the assertion at the foot of this
-- file counts the overloads for the same reason.
-- -----------------------------------------------------------------------------
create or replace function public.close_visit(
  p_visit_id             uuid,
  p_daily_plan_id        uuid,
  p_notes                text             default null,
  p_institute_interested boolean          default null,
  -- The three the closing report kept. Every one of these columns, and its
  -- vocabulary CHECK, has existed since 0005/0009; they only stop being dormant.
  p_visit_outcome        text             default null,
  p_management_response  text[]           default null,
  p_student_response     text             default null,
  p_met_name             text             default null,
  p_met_phone            text             default null,
  p_students_attended    integer          default null,
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

-- The 0018 version must go, or a call naming only the shared arguments matches
-- both and every save fails as ambiguous.
--
-- Guarded with to_regprocedure, which resolves one exact signature and returns
-- null when it is absent. 0015 warns against the obvious alternative:
-- pg_get_function_identity_arguments includes the PARAMETER NAMES, so comparing
-- it to a bare list of types looks right and never matches, leaving the drop as
-- dead code and both overloads in place.
do $$
begin
  if to_regprocedure(
       'public.close_visit(uuid, uuid, text, boolean, text, text, text, integer, '
       'text, text, uuid, double precision, double precision, double precision)'
     ) is not null then
    drop function public.close_visit(
      uuid, uuid, text, boolean, text, text, text, integer, text, text, uuid,
      double precision, double precision, double precision
    );
    raise notice 'Dropped 0018''s 14-argument close_visit; the 16-argument one replaces it.';
  end if;
end $$;

revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, text,
  text, uuid, double precision, double precision, double precision
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, text,
  text, uuid, double precision, double precision, double precision
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, text,
  text, uuid, double precision, double precision, double precision
) to authenticated;

comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, text,
  text, uuid, double precision, double precision, double precision
) is
  'Files the closing report, closes any earlier "Set" it completed, and checks '
  'the rep out - one transaction. Runs as the calling rep, so RLS and every '
  'trigger still apply. Raises FO004 and FO017-FO019. Carries the outcome, '
  'management response and student response the report settled on.';


-- -----------------------------------------------------------------------------
-- 3. management_interest goes dormant
--
-- Collected briefly during stage 3 and withdrawn before it ever shipped: an
-- interest LEVEL beside a management RESPONSE is two answers to one question,
-- and the client chose the response.
--
-- The column stays, like every other retired closing-report field. Reviving it
-- is a form control, not a migration - which is the entire reason none of them
-- were dropped.
-- -----------------------------------------------------------------------------
comment on column public.visits.management_interest is
  'DORMANT since 0019. Collected briefly during stage 3 and withdrawn in '
  'favour of visit_outcome and management_response. Kept, not dropped.';

comment on column public.visits.visit_outcome is
  'Live again as of 0019. Dormant for the length of stage 3, which is exactly '
  'how long the short form went without it - the column and its CHECK were '
  'never touched.';


-- -----------------------------------------------------------------------------
-- 4. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  overloads integer;
  tg        record;
begin
  -- EXACTLY ONE close_visit, or every feedback submission fails as ambiguous.
  -- This is the check that matters most in this file.
  select count(*) into overloads
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'close_visit';
  if overloads <> 1 then
    problems := problems || format('there are %s close_visit overloads, expected exactly 1', overloads);
  end if;

  -- ...and it must be the new one.
  if to_regprocedure(
       'public.close_visit(uuid, uuid, text, boolean, text, text[], text, text, '
       'text, integer, text, text, uuid, double precision, double precision, '
       'double precision)'
     ) is null then
    problems := problems || 'the 16-argument close_visit is missing';
  end if;

  -- Both guards must now fire on INSERT as well as UPDATE.
  for tg in
    select tgname, tgtype from pg_trigger
     where tgrelid = 'public.daily_plans'::regclass
       and tgname in ('daily_plans_checkin_located', 'daily_plans_one_open_visit_guard')
       and not tgisinternal
  loop
    -- tgtype bit 2 (value 4) is INSERT, bit 4 (value 16) is UPDATE.
    if (tg.tgtype & 4) = 0 then
      problems := problems || format('%s does not fire on INSERT', tg.tgname);
    end if;
    if (tg.tgtype & 16) = 0 then
      problems := problems || format('%s does not fire on UPDATE', tg.tgname);
    end if;
  end loop;

  -- The four columns this file switches between dormant and live must all still
  -- be there, with their vocabularies. None is created or dropped here.
  if not exists (select 1 from pg_constraint where conname = 'visits_visit_outcome_valid')
     or not exists (select 1 from pg_constraint where conname = 'visits_management_response_valid')
     or not exists (select 1 from pg_constraint where conname = 'visits_student_response_valid')
     or not exists (select 1 from pg_constraint where conname = 'visits_management_interest_valid') then
    problems := problems || 'one of the closing-report vocabulary CHECKs has gone';
  end if;

  -- 0018's work must still be standing. This file adds to it.
  if not exists (select 1 from pg_trigger where tgname = 'visits_require_checkin'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'visits_enforce_meeting_gate'
                   and tgrelid = 'public.visits'::regclass and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'daily_plans_checkin_final'
                   and tgrelid = 'public.daily_plans'::regclass and not tgisinternal) then
    problems := problems || 'a guard from 0014/0016/0018 has gone missing';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'log_visit') <> 1 then
    problems := problems || 'log_visit is no longer a single overload';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0019 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  raise notice
    'Closing report final: close_visit carries outcome, management response and '
    'student response; management_interest is dormant; both check-in guards now '
    'fire on INSERT as well as UPDATE.';
end $$;


-- -----------------------------------------------------------------------------
-- 5. Check it took
--
--   -- exactly one, and it takes a text[] in fifth place
--   select pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'close_visit';
--
--   -- an INSERT with no location and no reason must now fail with FO012
--   insert into public.daily_plans (member, date, institute_id, purpose, checkin_at)
--   values ('<a member id>', public.app_today(), '<an institute id>', 'test', now());
--
--   -- what the reports are saying again
--   select visit_outcome, management_response, student_response, institute_interested
--     from public.visits where reported_at is not null order by reported_at desc limit 10;
-- -----------------------------------------------------------------------------
