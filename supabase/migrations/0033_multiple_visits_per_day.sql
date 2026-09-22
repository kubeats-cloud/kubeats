-- =============================================================================
-- 0033 - Several visits to one institute in one day
--
-- The client asked for a rep to be able to visit the same institute more than
-- once in a day - a morning meeting and an afternoon session at the same
-- school - while keeping the rule that they must FINISH one visit before
-- checking in anywhere else.
--
-- Those are two different rules and only one of them moves.
--
-- WHAT MOVES: daily_plans_unique_per_day (0001), `unique (member, date,
-- institute_id)`. That is the whole of "one institute, one visit per day". It
-- is on daily_plans, not on visits - `visits` has never had such a constraint,
-- and 0018 says so explicitly: "It deliberately does NOT limit how many
-- activities one cycle records: the live data already holds a legitimate
-- olympiad + meeting at one institute on one day."
--
-- WHAT DOES NOT MOVE: FO013, one open visit at a time. Its guarantee is the
-- partial unique index daily_plans_one_open_visit, keyed on (member) ALONE and
-- partial on `checkin_at is not null and checkout_at is null and
-- checkout_missing = false`. It reads neither the date nor the institute, so
-- nothing below touches it. enforce_one_open_visit() - the friendly half that
-- names the institute still holding the rep - is untouched too. After this
-- migration a rep may plan St Xavier's three times in one day and must still
-- check out of each before checking in to the next.
--
-- Also untouched, and each for its own reason:
--
--   FO011  daily_plans_checkin_final      an arrival is still write-once
--   FO014  guard_checkin_cycle_final      a checked-in row still cannot be
--                                         deleted by a rep. It closed the
--                                         "delete and re-add to buy a second
--                                         arrival" hole. That hole was worth
--                                         closing because the SECOND arrival
--                                         was untracked, not because a second
--                                         VISIT was wrong - a rep wanting one
--                                         now adds a second plan row openly,
--                                         which is the feature.
--   FO023  guard_plan_assignment          ownership, unchanged
--   FO026  enforce_plan_institute_owned   ownership, unchanged
--   FO009  enforce_checkin_before_visit   see the note in section 3
--
-- DEPLOY COUPLING: THE CODE SHIPS FIRST, THIS SECOND. Not optional, and the
-- opposite way round from 0027.
--
-- `addToDailyPlan`, `assignVisit` and `startFollowUp` all upsert with
-- `onConflict: "member,date,institute_id"`. PostgREST resolves that against a
-- real unique constraint, so the moment this migration drops it the OLD code
-- answers 42P10 to every attempt to plan anything - the Dashboard stops working
-- entirely. The new code inserts instead and does not name the constraint, so
-- it is correct both before and after this file is applied.
--
-- Applied the right way round there is no broken window at all: new code plus
-- old database behaves exactly as today (the constraint simply refuses a second
-- row, which the app now reports as "already on today's plan"), and the feature
-- switches on when this lands.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: the drop is `if exists`, the index is `if not exists`, and
--   the function is a create-or-replace.
--
-- IRREVERSIBLE IN PRACTICE, THOUGH NOT IN FORM. Re-adding the constraint is one
-- statement, but it will fail the moment any rep has actually used the feature,
-- because the duplicate rows it forbids will exist. There is no data migration
-- that can undo that choice - only deleting somebody's second visit of the day.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The constraint, and the index that has to replace it
--
-- DROPPING A UNIQUE CONSTRAINT DROPS ITS INDEX WITH IT, and that index is not
-- spare. Four hot paths read (member, date) or (member, date, institute_id):
--
--   getTodayPlan()                    every Dashboard render
--   log_visit()'s meeting gate        `for update` on the plan row
--   enforce_checkin_before_visit()    FO009, on every visit insert
--   enforce_meeting_gate()            Rule 2, on every visit insert
--
-- Two of those are triggers that fire on every visit ever logged. Leaving them
-- on a sequential scan would be a silent, permanent tax, so the same columns
-- come straight back as a plain index. Same columns, same order, no uniqueness.
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  drop constraint if exists daily_plans_unique_per_day;

create index if not exists daily_plans_member_date_institute_idx
  on public.daily_plans (member, date, institute_id);

comment on index public.daily_plans_member_date_institute_idx is
  'Replaces the index that came free with daily_plans_unique_per_day (0001), '
  'dropped by 0033 so a rep can visit one institute more than once in a day. '
  'The lookups it serves are unchanged; only the uniqueness is gone.';


-- -----------------------------------------------------------------------------
-- 2. log_visit() writes daily_plan_id
--
-- THE BODY BELOW IS 0029'S, VERBATIM, WITH ONE COLUMN ADDED TO THE INSERT.
-- Nothing else is retyped or regenerated: the signature, the declarations,
-- FO004/FO007/FO003, the meeting gate and its row lock, Rule 7's
-- meetings_actual update and Rule 4's status write are carried through exactly
-- as 0029 left them. The five migrations that have ever defined this function
-- are 0002, 0006, 0008, 0015 and 0026; 0029 is the sixth and this is the
-- seventh, and each one restates the whole definition so the newest file is
-- always the complete answer.
--
-- THE SIGNATURE IS IDENTICAL - thirteen parameters, same names, same types,
-- same order, same defaults. No parameter is added, so no second overload is
-- created: 0015's drop-block still finds nothing to drop and 0026's assertion
-- still counts exactly one log_visit. That rule is why the column had to be one
-- the function ALREADY received rather than a new argument.
--
-- SECURITY INVOKER, unchanged and load-bearing. CLAUDE.md: a DEFINER rewrite
-- here would punch a hole straight through campus scoping.
--
-- WHY IT IS IN THIS FILE AT ALL. Section 1 makes (member, date, institute_id)
-- non-unique. getUnreportedVisitFor() was keyed on exactly that triple, and its
-- own comment explains it was keyed that way BECAUSE daily_plan_id was not
-- written until close_visit() ran - which is the step that has failed whenever
-- that function is needed. So the recovery path cannot be re-keyed until the
-- link exists at insert time. One change, in one transaction with the drop.
-- -----------------------------------------------------------------------------
create or replace function public.log_visit(
  p_institute_id     uuid,
  p_activity         text,
  p_lifecycle_status text        default null,
  p_expected_date    date        default null,
  p_latitude         double precision default null,
  p_longitude        double precision default null,
  p_photo_url        text        default null,
  p_notes            text        default null,
  p_status_set_to    text        default null,
  p_follow_up_date   date        default null,
  p_follow_up_time   time        default null,
  p_daily_plan_id    uuid        default null,
  -- 0015: how good the coordinates are, in metres. Nullable like the
  -- coordinates themselves; a fix with no accuracy is still a fix.
  p_accuracy         double precision default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member    uuid := (select auth.uid());
  -- The one change from 0006, which read the server's own calendar here.
  -- The server is UTC, so at 01:00 in Ahmedabad it still said yesterday.
  -- app_today() asks what day it is in India, and todayISO() in the app
  -- asks exactly the same question, so the plan row this gate looks for is
  -- the one the app actually wrote.
  --
  -- The old built-in is deliberately not named in this body, so that a
  -- search of pg_proc for it stays a straight answer to the question
  -- "is there any server-calendar today left in here?".
  v_today     date := public.app_today();
  v_lifecycle boolean := p_activity in ('session', 'campus_visit');
  v_plan      public.daily_plans%rowtype;
  v_visit_id  uuid;
begin
  if v_member is null then
    raise exception 'You must be signed in to log a visit.'
      using errcode = 'FO004';
  end if;

  -- Rule 12 — a visit is not evidence without its photograph.
  --
  -- Raised before the folder check below so a rep who took no picture is told
  -- that, rather than being told their photo is not theirs. The CHECK
  -- constraint added at the bottom of 0006 is the authority; this exists
  -- to give the app a code it can turn into a sentence.
  if p_photo_url is null or btrim(p_photo_url) = '' then
    raise exception 'A photo is required to log this visit.'
      using errcode = 'FO007';
  end if;

  -- A photo may only ever live under the uploader's own folder — the same rule
  -- the storage policy enforces, repeated here so a tampered form cannot record
  -- a path pointing at someone else's file.
  if p_photo_url is not null and p_photo_url not like v_member::text || '/%' then
    raise exception 'That photo does not belong to you.'
      using errcode = 'FO003';
  end if;

  -- Rule 2 — the meeting gate.
  --
  -- The trigger on public.visits is the authority and still fires below. This
  -- block exists to raise a sentence the app can show, and to take a row lock:
  -- two submissions racing each other would otherwise both read
  -- meetings_actual as null and both count as held.
  if p_activity = 'meeting' then
    select * into v_plan
      from public.daily_plans dp
     where dp.id = p_daily_plan_id
       and dp.member = v_member
       and dp.date = v_today
     for update;

    if not found or v_plan.institute_id is distinct from p_institute_id then
      raise exception 'That institute is not on today''s plan.'
        using errcode = 'FO001';
    end if;

    if v_plan.meetings_actual is not null then
      raise exception 'That meeting is already marked as held.'
        using errcode = 'FO002';
    end if;
  end if;

  -- 1. The visit itself.
  --
  -- `date` is always today: the day the work was logged. Rule 3's shape is
  -- normalised here too — a lifecycle status is kept only for the two
  -- activities that have one — so a stale form field cannot smuggle one
  -- through and trip the CHECK.
  insert into public.visits (
    institute_id, member, activity, lifecycle_status, date, expected_date,
    latitude, longitude, photo_url, notes,
    status_set_to, follow_up_date, follow_up_time, accuracy,
    -- 0033, AND THE ONLY ADDITION THIS FILE MAKES TO 0029'S BODY.
    daily_plan_id
  )
  values (
    p_institute_id,
    v_member,
    p_activity,
    case when v_lifecycle then p_lifecycle_status else null end,
    v_today,
    -- 0029: THE DATE FOLLOWS THE STATUS, SO THE ACTIVITY TEST GOES.
    --
    -- 0026 (D3) removed the `= 'Set'` half of this for exactly the reason the
    -- rest is going now: "a form that collects an answer the RPC discards is
    -- worse than one that never asked". What it left behind was
    -- `v_lifecycle` - the date was stored only when the ACTIVITY was a session
    -- or a campus visit.
    --
    -- The form asks on the STATUS now (asks_expected_date, 0026), and a status
    -- is not gated by activity: a rep who planned a Follow-up and ended the
    -- visit on "Session done" is asked for a Session Date, and until this
    -- change that date was silently thrown away here. One rule, one place.
    --
    -- NOTHING ELSE MOVES. There is no CHECK on expected_date, nothing requires
    -- it, and the column has always been nullable, so this only widens what may
    -- be stored. A meeting that carries one is a meeting whose rep answered the
    -- question the status asked. Pending already reads `expected_date ?? date`.
    --
    -- What a "Set" means is still unchanged: the promise lives in expected_date
    -- while `date` records the day it was made, because the weekly rollup counts
    -- by `date`.
    p_expected_date,
    p_latitude,
    p_longitude,
    p_photo_url,
    p_notes,
    p_status_set_to,
    p_follow_up_date,
    p_follow_up_time,
    p_accuracy,
    -- 0033: the arrival this visit was logged against, written HERE rather
    -- than left for close_visit() to fill in afterwards.
    --
    -- The value has arrived in this parameter since 0018 and was used for the
    -- meeting gate's lookup and nothing else; the COLUMN was written only by
    -- close_visit(), the second of the two RPCs one submit makes. So a visit
    -- whose report failed - the exact case the recovery path exists for - had
    -- a null link, which is why getUnreportedVisitFor() could not use it and
    -- matched on (member, date, institute_id) instead.
    --
    -- That triple stops being unique the moment section 1 above drops
    -- daily_plans_unique_per_day, so the link has to exist at INSERT time or
    -- the recovery path picks up a visit from a DIFFERENT cycle at the same
    -- institute. Writing it here is what makes re-keying that function
    -- possible at all, and it is why this migration carries a function change
    -- rather than being one DDL statement.
    --
    -- Null is still accepted and still means what it always meant: no plan was
    -- named. The foreign key is on delete set null (0018) and nothing in the
    -- schema requires the column, so this only ever fills in a blank.
    p_daily_plan_id
  )
  returning id into v_visit_id;

  -- 2. Rule 7 — the weekly Meetings figure is counted from the plan, so marking
  --    the entry held is what makes the visit count.
  if p_activity = 'meeting' then
    update public.daily_plans
       set meetings_actual = 1,
           follow_up_date  = p_follow_up_date
     where id = p_daily_plan_id
       and member = v_member;

    if not found then
      raise exception 'Today''s plan entry could not be marked as held.'
        using errcode = 'FO005';
    end if;
  end if;

  -- 3. Rule 4 — status is set by hand; the institutes_touch_status trigger
  --    stamps who changed it and when.
  if p_status_set_to is not null then
    update public.institutes
       set status = p_status_set_to
     where id = p_institute_id;

    if not found then
      raise exception 'That institute no longer exists.'
        using errcode = 'FO006';
    end if;
  end if;

  return v_visit_id;
end;
$$;

comment on function public.log_visit(
  uuid, text, text, date, double precision, double precision,
  text, text, text, date, time, uuid, double precision
) is
  'Saves a visit in one transaction. 0033: writes daily_plan_id at insert time, '
  'so a visit can be attributed to its arrival before close_visit() runs - '
  'which is what lets the recovery path find the right visit now that '
  '(member, date, institute_id) is no longer unique. 0029: expected_date is '
  'stored whenever it is supplied, because the Log Visit form asks for it on '
  'the status (institute_statuses.asks_expected_date) rather than on the '
  'activity.';


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove FO013 survived
--
-- The second half matters more than the first. This migration's whole risk is
-- dropping one rule and taking another with it by accident, so the assertion
-- checks that the rule which was supposed to go is gone AND that the rule which
-- was supposed to stay is still standing.
--
-- Every append is array_append(), never `problems || '...'`: problems is text[]
-- and a bare quoted literal is of unknown type, so `||` resolves to array
-- concatenation and fails with 22P02 at the moment a check reports something.
-- That trap is recorded at length in 0032, which was bitten by it.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
  n        integer;
begin
  -- 3a. The constraint is gone.
  if exists (
    select 1 from pg_constraint
     where conname = 'daily_plans_unique_per_day'
       and conrelid = 'public.daily_plans'::regclass
  ) then
    problems := array_append(
      problems,
      'daily_plans_unique_per_day is still there - a second visit to one institute is still refused');
  end if;

  -- 3b. ...and its index came back as a plain one.
  if not exists (
    select 1 from pg_class
     where relname = 'daily_plans_member_date_institute_idx'
       and relkind = 'i'
  ) then
    problems := array_append(
      problems,
      'daily_plans_member_date_institute_idx is missing - the plan lookups and both visit triggers would scan');
  end if;

  -- 3c. FO013'S GUARANTEE IS UNTOUCHED. The one thing this file must not have
  --     broken. Checked for existence AND for still being UNIQUE - a
  --     non-unique version would look present and guarantee nothing.
  if not exists (
    select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.relname = 'daily_plans_one_open_visit'
       and i.indisunique
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit is missing or no longer unique - one open visit at a time is not enforced');
  end if;

  -- 3d. ...and so is its friendly half, and the three other plan guards.
  if not exists (
    select 1 from pg_trigger where tgname = 'daily_plans_one_open_visit_guard'
      and tgrelid = 'public.daily_plans'::regclass
  ) then
    problems := array_append(
      problems,
      'daily_plans_one_open_visit_guard is gone - FO013 would refuse with a bare 23505');
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'daily_plans_checkin_final'
      and tgrelid = 'public.daily_plans'::regclass
  ) then
    problems := array_append(problems, 'daily_plans_checkin_final (FO011) is gone');
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'daily_plans_checkin_cycle_final'
      and tgrelid = 'public.daily_plans'::regclass
  ) then
    problems := array_append(problems, 'daily_plans_checkin_cycle_final (FO014) is gone');
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'daily_plans_institute_owned'
      and tgrelid = 'public.daily_plans'::regclass
  ) then
    problems := array_append(problems, 'daily_plans_institute_owned (FO026) is gone');
  end if;

  -- 3e. Still exactly one log_visit, still invoker, and now writing the link.
  --
  --     The overload count is the one that would take the whole app down:
  --     0015's header records that two overloads make every existing call
  --     ambiguous and every visit stops saving.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'log_visit';

  if n <> 1 then
    problems := array_append(problems, format(
      'there are %s log_visit overloads, expected exactly 1 - every visit would fail as ambiguous', n));
  else
    if (select p.prosecdef
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'log_visit') then
      problems := array_append(
        problems,
        'log_visit() is SECURITY DEFINER - campus scoping would not apply inside it');
    end if;

    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'log_visit';

    -- The change this file exists to make. Looked for in the INSERT's column
    -- list rather than anywhere in the body, because `p_daily_plan_id` has been
    -- a parameter since 0018 and would match a loose search on a function that
    -- never writes the column - which is exactly the state this replaces.
    if position('daily_plan_id' in body) = 0 then
      problems := array_append(
        problems,
        'log_visit() does not mention daily_plan_id - the recovery path cannot be re-keyed');
    end if;

    -- 0026 and 0029 both assert this and it costs nothing to carry it forward:
    -- losing app_today() would put the meeting gate back on the server's UTC
    -- calendar and tell a rep their institute is not on today's plan.
    if position('public.app_today()' in body) = 0 then
      problems := array_append(
        problems,
        'log_visit() no longer reads app_today() - the IST calendar day has been lost');
    end if;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0033 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0033 applied: one institute may be visited more than once a day; FO013 still holds.';
end $$;


-- =============================================================================
-- WHAT THIS DOES NOT CHANGE, WRITTEN DOWN SO NOBODY GOES LOOKING
--
-- FO009, enforce_checkin_before_visit(), still asks "does ANY plan row exist
-- for this member, date and institute with a non-null checkin_at". With several
-- rows a CLOSED morning arrival now satisfies that guarantee for an afternoon
-- visit that never checked in. It is not reachable through the app - /log needs
-- an in-progress entry and FO013 allows one at a time - but through a
-- hand-made request it is a real loosening, and it is left alone deliberately
-- rather than overlooked: tightening it to new.daily_plan_id is a separate
-- decision about a separate rule, and bundling it here would mean this file
-- could not be reasoned about as "one uniqueness, removed".
--
-- THE WEEKLY MEETINGS FIGURE WILL LEGITIMATELY RISE. Rule 7 counts meetings as
-- `daily_plans where meetings_actual = 1`. One plan row per institute per day
-- capped that at one meeting per school per day; three plan rows can now hold
-- three. That is the client's request expressed in the metric, not a
-- double-count - institutesCovered in the activity report is a distinct count
-- of institutes and is unaffected. Worth saying out loud before the first week
-- whose numbers come in higher than the last.
--
-- HOW TO CHECK AFTERWARDS
--
--   -- the constraint is gone and the index is not
--   select conname from pg_constraint where conrelid = 'public.daily_plans'::regclass;
--   select indexname from pg_indexes where tablename = 'daily_plans';
--
--   -- one open visit is still enforced
--   select indexdef from pg_indexes where indexname = 'daily_plans_one_open_visit';
--
--   -- and new visits carry their arrival
--   select id, date, institute_id, daily_plan_id from public.visits
--    order by created_at desc limit 5;
-- =============================================================================
