-- =============================================================================
-- KUbeats - migration 0024: a purpose declares which activity it counts as
--
-- ✅ ADDITIVE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- One nullable column, back-filled, then made NOT NULL. Nothing is dropped and
-- no existing rule changes, so the live app - which neither reads nor writes
-- this column - is unaffected. Apply it days ahead of stage 2's deploy if you
-- like.
--
-- WHY THIS EXISTS: THE ASYMMETRY AT THE HEART OF PHASE 2
--
-- The client asked for two things that sound identical - "let an admin add
-- purposes" and "let an admin add statuses" - and they get OPPOSITE answers.
--
--   activity   6 values, FIXED, and staying fixed. Seven of the eight weekly
--              metrics are counted by (activity, lifecycle_status), and
--              public.targets has one integer column per metric. A seventh
--              activity would be a metric with no column, no row on the Targets
--              screen and no place in tallyVisitMetrics() - invisible in every
--              total, which is worse than not existing.
--   purpose    admin-managed, and now TYPED: each row declares which of those
--              six fixed activities it counts as. An admin may add as many
--              purposes as they like; the arithmetic underneath never moves.
--
-- That is the whole of this file. It is the layer that lets stage 3 delete the
-- Activity selector from Log Visit and derive the activity from the plan's
-- purpose instead, without putting Rule 7's arithmetic behind an editable list.
--
-- WHAT THIS REPLACES
--
-- PURPOSE_ACTIVITY in src/lib/validation/visit.ts - a hard-coded map from four
-- purpose LABELS to (activity, lifecycle). Its own comment names the weakness
-- this column closes: "purposes has no stable key, only an editable label, so
-- renaming a purpose in Settings silently drops it out of this map." The
-- mapping now travels on the row.
--
-- ⚠ WHAT THIS FILE DELIBERATELY DOES NOT ADD
--
--   lifecycle        Set / Done, which distinguishes "Fix a session" from
--                    "Complete a session". Both map to `session` here, so after
--                    this migration they are indistinguishable. STAGE 3 CANNOT
--                    DERIVE Set/Done UNTIL IT EXISTS - migration 0025 adds it
--                    alongside the four purposes it seeds. Called out because a
--                    reader could easily assume this file finished the job.
--   requires_note    "Other" needs a free-text note; daily_plans needs a
--                    purpose_note column to put it in. Stage 3.
--   purpose_id       daily_plans.purpose still stores the LABEL as text. A
--                    foreign key is what makes a rename safe. Stage 3.
--   is_active        retiring a purpose instead of deleting it, so its activity
--                    stays resolvable for plans that already reference it.
--   sort_order       display order; the list is alphabetical for now.
--
-- Each is additive and none of them needs this file reopened. The chain is
-- forward-only (0016 section 5): an applied migration is a record of what the
-- database was told, not a draft.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column, nullable to begin with
--
-- Nullable first and NOT NULL at the end of section 3, which is the only order
-- that can work: the rows exist already and have no value yet. Adding it NOT
-- NULL with a DEFAULT would be worse than either - every existing purpose would
-- silently become whatever the default said, and the default would be a guess
-- about which weekly metric a rep's work counts toward.
-- -----------------------------------------------------------------------------
alter table public.purposes
  add column if not exists activity text;

comment on column public.purposes.activity is
  'Which of the six FIXED activity keys a visit planned under this purpose '
  'counts as. Set by an admin when the purpose is created. The activity '
  'vocabulary is not admin-managed and must not become so: seven of the eight '
  'weekly metrics are counted by it and public.targets has a column per metric.';


-- -----------------------------------------------------------------------------
-- 2. The vocabulary, stated once more
--
-- The same six literals as visits_activity_valid (0001). A CHECK cannot contain
-- a subquery, so it cannot read them from anywhere - which is exactly the
-- duplication 0010 hit with the status vocabulary, and it is guarded the same
-- way: the assertion in section 4 compares the two constraints and refuses to
-- leave them disagreeing.
--
-- Added before the back-fill so a typo below is caught by the constraint rather
-- than stored.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purposes_activity_valid'
  ) then
    alter table public.purposes add constraint purposes_activity_valid check (
      activity is null
      or activity in (
        'meeting', 'session', 'campus_visit', 'olympiad', 'application', 'admission'
      )
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Mapping the purposes that exist
--
-- Six rows, which is what the client's database holds (probe P3, 2026-09-15):
--
--   First meeting             meeting        the headline weekly metric, and
--   Other                     meeting        the two rows that feed it. Without
--                                            at least one of these, deleting
--                                            the Activity selector in stage 3
--                                            would take Meetings to zero.
--   Fix a session             session
--   Complete a session        session        the two that 0025's `lifecycle`
--                                            column will tell apart
--   Fix a campus visit        campus_visit
--   Complete a campus visit   campus_visit
--
-- Matched on the exact label and only where the activity is still null, so a
-- re-run cannot overwrite a value an admin has since corrected by hand.
--
-- Olympiad registration, Application forms, Admissions and Follow-up are NOT
-- seeded here. They do not exist yet and stage 3's 0025 creates them WITH their
-- mapping - creating them now would put four purposes in the live picker that
-- the running app cannot map, weeks before it can use them.
-- -----------------------------------------------------------------------------
update public.purposes p
   set activity = m.activity
  from (values
    ('First meeting',           'meeting'),
    ('Other',                   'meeting'),
    ('Fix a session',           'session'),
    ('Complete a session',      'session'),
    ('Fix a campus visit',      'campus_visit'),
    ('Complete a campus visit', 'campus_visit')
  ) as m (label, activity)
 where p.label = m.label
   and p.activity is null;


-- -----------------------------------------------------------------------------
-- 3b. Anything left over is a STOP, not a default
--
-- If an admin added a purpose this file has never heard of, it is still null
-- here. The migration REFUSES rather than guessing.
--
-- That is a deliberate choice against the easier one. Defaulting the unknowns
-- to 'meeting' would let this file finish silently and would quietly decide
-- which weekly metric somebody's work counts toward - a number a rep is
-- measured on. Better to stop, name the rows, and let a person answer.
--
-- Recovering is one statement and a re-run:
--
--   update public.purposes set activity = 'session' where label = 'Whatever it was';
--
-- Everything above is idempotent, so running this file again after that picks
-- up exactly where it stopped.
-- -----------------------------------------------------------------------------
do $$
declare
  orphans text;
begin
  select string_agg(format('%L', label), ', ' order by label)
    into orphans
    from public.purposes
   where activity is null;

  if orphans is not null then
    raise exception
      'These purposes have no activity and this migration will not guess one: %. '
      'Set each with: update public.purposes set activity = ''<one of meeting, '
      'session, campus_visit, olympiad, application, admission>'' where label = '
      '''...''; then run this file again.', orphans;
  end if;
end $$;

alter table public.purposes
  alter column activity set not null;


-- -----------------------------------------------------------------------------
-- 4. Prove it landed, and prove the two vocabularies still agree
--
-- Three things:
--
--   * every purpose has an activity, and it is one of the six;
--   * purposes_activity_valid and visits_activity_valid list the SAME six
--     literals. Two hand-written copies of one vocabulary is exactly the
--     duplication that rots, and the failure would be quiet: a purpose typed
--     as an activity the visits table refuses, discovered by a rep who cannot
--     save;
--   * a purpose maps to at least one activity that feeds Meetings, because
--     stage 3 removes the only other route to that metric.
--
-- The activity keys contain no apostrophes, so matching quoted literals with a
-- regex is safe here - the same technique, for the same reason, as 0010.
-- -----------------------------------------------------------------------------
do $$
declare
  purposes_def text;
  visits_def   text;
  problems     text[] := '{}';
  keys         text[] := array[
                  'meeting', 'session', 'campus_visit',
                  'olympiad', 'application', 'admission'
                ];
  key          text;
  meetings     integer;
  total        integer;
begin
  select pg_get_constraintdef(oid) into purposes_def
    from pg_constraint where conname = 'purposes_activity_valid';
  select pg_get_constraintdef(oid) into visits_def
    from pg_constraint where conname = 'visits_activity_valid';

  if purposes_def is null or visits_def is null then
    raise exception
      'Activity vocabulary check: a CHECK is missing (purposes=%, visits=%).',
      purposes_def is not null, visits_def is not null;
  end if;

  foreach key in array keys loop
    if position(quote_literal(key) in purposes_def) = 0 then
      problems := problems || format('purposes_activity_valid does not accept %L', key);
    end if;
    if position(quote_literal(key) in visits_def) = 0 then
      problems := problems || format('visits_activity_valid does not accept %L', key);
    end if;
  end loop;

  -- Neither may list MORE than the six, or one side has quietly widened.
  if (select count(*) from regexp_matches(purposes_def, '''([^'']+)''', 'g'))
     <> array_length(keys, 1) then
    problems := problems || 'purposes_activity_valid lists a different number of activities';
  end if;
  if (select count(*) from regexp_matches(visits_def, '''([^'']+)''', 'g'))
     <> array_length(keys, 1) then
    problems := problems || 'visits_activity_valid lists a different number of activities';
  end if;

  select count(*) into total from public.purposes;
  select count(*) into meetings from public.purposes where activity = 'meeting';

  if total = 0 then
    problems := problems || 'there are no purposes at all, so no visit can be planned';
  end if;

  if meetings = 0 then
    problems := problems
      || 'no purpose maps to ''meeting'', so the weekly Meetings metric would '
         'have no source once the Activity selector is removed in stage 3';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Typed purposes did not land cleanly: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Purposes are typed: % row(s), % feeding Meetings. Both activity CHECKs '
    'agree on the same six keys. lifecycle is NOT added here - 0025 adds it.',
    total, meetings;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Reading it back
--
--   -- what each purpose now counts as
--   select label, activity from public.purposes order by activity, label;
--
--   -- which purposes reps actually plan under, and what they feed
--   select p.activity, dp.purpose, count(*) as planned
--     from public.daily_plans dp
--     left join public.purposes p on p.label = dp.purpose
--    group by 1, 2
--    order by planned desc;
--
--   -- a plan row whose purpose no longer matches any row in purposes. Harmless
--   -- today (the label is a snapshot) and the reason 0025 adds purpose_id.
--   select distinct dp.purpose
--     from public.daily_plans dp
--     left join public.purposes p on p.label = dp.purpose
--    where p.id is null;
-- -----------------------------------------------------------------------------
