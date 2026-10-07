-- =============================================================================
-- KUbeats - migration 0039: close_visit() records what happens next
--
-- ⚠ APPLY THIS BEFORE THE CODE SHIPS. Not deploy-coupled in the dangerous
-- direction, but the order still matters, and here is exactly why:
--
--   applied first, code later    SAFE. Every new parameter is DEFAULTED, and
--                                supabase-js sends NAMED arguments, so the
--                                live 17-argument call still resolves against
--                                the 21-argument function and behaves exactly
--                                as it did. Nothing breaks in the window.
--   code first, applied later    BROKEN. The new code sends four argument
--                                names the old function does not have, and
--                                PostgREST answers PGRST202 - "could not find
--                                the function" - on every single filed report.
--
-- That asymmetry is the whole reason the parameters are defaulted rather than
-- required, and it is the same reasoning 0019 and 0022 record for their own
-- additions to this function.
--
-- ⚠ RUN 0038 FIRST. This inserts into public.follow_up_tasks, which that file
-- creates. Applied out of order this one fails to create the function at all.
--
-- THE OVERLOAD CEREMONY, AND WHY IT IS NOT OPTIONAL
--
-- `create or replace function` does NOT replace a function whose signature
-- differs - it creates a SECOND one. Two overloads whose arguments both match a
-- named call make every call from the app ambiguous, and PostgREST reports that
-- as a failure to file a report the rep has already walked to and photographed.
-- 0015's closing assertion records the same hazard for log_visit().
--
-- So: drop the 17-argument signature explicitly, create the 21-argument one,
-- and assert at the end that exactly one remains. Section 3 does that, and also
-- checks `log_visit` is still a single overload, because this file is the kind
-- of change that makes people reach for that one next.
--
-- SECURITY INVOKER IS PRESERVED, AND MUST BE. CLAUDE.md is explicit:
-- log_visit() and close_visit() staying INVOKER is what makes campus scoping
-- and rep-ownership apply inside them. A DEFINER rewrite would punch a hole
-- straight through the boundary - and here it would also let a rep create a
-- follow-up task on an institute they do not own, which FO031 exists to refuse.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the 17-argument signature
--
-- Guarded, so a re-run on a database that already has the new one is a no-op
-- rather than an error. Same shape as 0019's and 0022's drop blocks.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = 'close_visit'
       and p.pronargs = 17
  ) then
    drop function public.close_visit(
      uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
      text, text, uuid, double precision, double precision, double precision
    );
    raise notice 'Dropped the 17-argument close_visit; the 21-argument one replaces it.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. The 21-argument function
--
-- The four new parameters are LAST and DEFAULTED, so the live call is
-- unaffected - see the header.
--
-- WHY THE TASK IS WRITTEN HERE AND NOT FROM THE ACTION. This function already
-- writes two tables in one transaction, for the reason CLAUDE.md gives: "a
-- check-out is not a thing you want half of". A follow-up is the same kind of
-- promise. Writing it from a third RPC would add a third seam, and the seam
-- would open exactly when a rep is standing outside a school with one bar of
-- signal - the report filed, the follow-up lost, and nothing on screen saying
-- so.
--
-- Everything above the new block is byte-for-byte 0030's body. It is reproduced
-- rather than patched because a plpgsql function cannot be patched, which is
-- the same reason 0028 reproduces guard_institute_owner in full.
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
  p_students_attended    integer          default null,
  p_students_reached     integer          default null,
  p_session_topic        text             default null,
  p_session_taken_by     text             default null,
  p_closes_visit_id      uuid             default null,
  p_checkout_lat         double precision default null,
  p_checkout_lng         double precision default null,
  p_checkout_accuracy    double precision default null,
  -- 0039. All four defaulted; see the header for why that is load-bearing.
  p_next_action          text             default null,
  p_follow_up_kind       text             default null,
  p_follow_up_due        date             default null,
  p_follow_up_note       text             default null
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
         -- 0039: what the rep said they would do next, recorded on the visit so
         -- the report reads as it was filed. The TASK below is what is acted on.
         next_action          = p_next_action,
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

  /*
   * THE FOLLOW-UP, IN THE SAME TRANSACTION AS THE REPORT.
   *
   * Written to follow_up_tasks and NEVER to daily_plans - 0038's header says at
   * length why that separation is the whole design. A kind='meeting' row is a
   * PROMPT; turning it into a visit the rep can check into is a separate,
   * explicit tap through startFollowUp(), so there is still exactly one writer
   * in front of the row the meeting gate reads.
   *
   * The due date falls back to TOMORROW rather than to the column's own
   * app_today() default: a follow-up agreed during a visit is, by default,
   * something for the next working day, and `app_today() + 1` reads the Indian
   * calendar day exactly as every other date in this schema does. The form
   * offers the same value, so the two cannot disagree.
   *
   * SECURITY INVOKER means this insert passes through follow_up_tasks' own RLS
   * and through FO031 - so a rep cannot create a task on an institute they do
   * not own even from here, and the refusal rolls the whole report back rather
   * than filing a report with a dead-end task attached.
   */
  if p_follow_up_kind is not null then
    insert into public.follow_up_tasks (
      member, institute_id, kind, due_date, note, from_visit_id
    ) values (
      v_member,
      v_visit.institute_id,
      p_follow_up_kind,
      coalesce(p_follow_up_due, public.app_today() + 1),
      p_follow_up_note,
      p_visit_id
    );
  end if;

  if p_daily_plan_id is not null then
    -- THE CHECK-OUT IS STAMPED ONLY IF THERE IS STILL ONE TO STAMP.
    --
    -- `checkout_missing = false` is the line 0030 added, and everything above
    -- this statement is why: a row the nightly sweep or an admin has already
    -- closed carries checkout_missing = true and checkout_at null, and writing
    -- a time onto it is refused by daily_plans_checkout_missing_valid (0014)
    -- with 23514 - which rolls the report back with it.
    --
    -- Matching no row is the whole fix. The report above is already written;
    -- this simply declines to invent a departure time for a visit nobody
    -- recorded leaving. checkout_missing stays true, checkout_at stays null,
    -- and that pair has meant "completed, duration not recorded" since 0014.
    update public.daily_plans
       set checkout_at       = now(),
           checkout_lat      = p_checkout_lat,
           checkout_lng      = p_checkout_lng,
           checkout_accuracy = p_checkout_accuracy
     where id = p_daily_plan_id
       and member = v_member
       and checkin_at is not null
       and checkout_at is null
       and checkout_missing = false;
  end if;
end;
$$;

revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) from public;
revoke all on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) from anon;
grant execute on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) to authenticated;

comment on function public.close_visit(
  uuid, uuid, text, boolean, text, text[], text, text, text, integer, integer,
  text, text, uuid, double precision, double precision, double precision,
  text, text, date, text
) is
  'Files a visit''s report, closes any earlier Set it completes, records what '
  'the rep will do next, creates the follow-up task for it, and stamps the '
  'check-out - all in ONE transaction. The follow-up goes to follow_up_tasks '
  'and NEVER to daily_plans (see 0038). SECURITY INVOKER, so RLS, FO031 and '
  'every trigger still apply. Every parameter past p_daily_plan_id is '
  'defaulted, so an older caller still resolves.';


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove nothing audited moved
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  overloads integer;
  body      text;
  c         text;
begin
  -- 3a. EXACTLY ONE OVERLOAD. Two would make every call from the app ambiguous
  --     and every report unfileable - the failure 0015 records for log_visit().
  select count(*) into overloads
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'close_visit';

  if overloads <> 1 then
    problems := array_append(problems, format(
      'there are %s close_visit overloads, expected exactly 1 - every filed report would fail as ambiguous',
      overloads));
  end if;

  -- 3b. And it is the 21-argument one.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'close_visit' and p.pronargs = 21
  ) then
    problems := array_append(
      problems,
      'close_visit does not take 21 arguments - the four new parameters are not there');
  end if;

  -- 3c. log_visit is untouched by this file and must still be a single
  --     overload. Asserted because this is the file that makes somebody think
  --     of adding a parameter to that one next.
  select count(*) into overloads
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'log_visit';

  if overloads <> 1 then
    problems := array_append(problems, format(
      'log_visit is no longer a single overload (%s found)', overloads));
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'close_visit';

  -- 3d. SECURITY INVOKER, NOT DEFINER. A definer rewrite would punch through
  --     campus scoping and let a rep create a task on a foreign institute.
  if (select p.prosecdef
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'close_visit') then
    problems := array_append(
      problems,
      'close_visit() is SECURITY DEFINER - campus scoping and FO031 would not apply inside it');
  end if;

  -- 3e. The follow-up goes to the right table. The single most important line
  --     in this file: `daily_plans` here instead would hand the meeting gate,
  --     Rule 7 and the Overview denominator a row none of them expects.
  if position('follow_up_tasks' in body) = 0 then
    problems := array_append(
      problems,
      'close_visit() does not insert into follow_up_tasks - the next action would be recorded and never acted on');
  end if;

  -- 3f. THE LOCKSTEP RULE, inside the function this time.
  if position('app_today' in body) = 0 then
    problems := array_append(
      problems,
      'close_visit() no longer reads app_today() for the follow-up due date - the Kolkata day would drift');
  end if;

  -- 3g. Every refusal it owned before is still raised.
  foreach c in array array['FO004', 'FO017', 'FO018', 'FO019'] loop
    if position(c in body) = 0 then
      problems := array_append(problems, format(
        'close_visit() no longer raises %s', c));
    end if;
  end loop;

  -- 3h. The two things this file depends on having been applied first.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'follow_up_tasks'
  ) then
    problems := array_append(
      problems,
      'public.follow_up_tasks does not exist - apply 0038 BEFORE this file');
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'visits' and column_name = 'next_action'
  ) then
    problems := array_append(
      problems,
      'visits.next_action does not exist - apply 0038 BEFORE this file');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0039 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0039 applied: close_visit() takes 21 arguments, still SECURITY INVOKER, and writes the follow-up to follow_up_tasks in the same transaction.';
end $$;
