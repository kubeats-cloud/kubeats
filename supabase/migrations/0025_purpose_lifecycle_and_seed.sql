-- =============================================================================
-- KUbeats - migration 0025: a purpose carries its lifecycle, its note rule,
--                           and four new purposes arrive
--
-- ⚠ APPLY THIS IMMEDIATELY BEFORE THE CODE SHIPS.
--
-- Unlike 0023 and 0024 this one is NOT safe to leave sitting. It SEEDS FOUR
-- PURPOSES, and a purpose appears in the rep's Dashboard picker the moment the
-- row exists. Applied a week early, reps can plan "Olympiad registration" on an
-- app that still asks them to pick the Activity by hand - which is harmless but
-- confusing - and, worse, the four new labels would be unmapped by the CURRENT
-- app's PURPOSE_ACTIVITY table, so its prefill would silently default them to
-- Meeting.
--
-- Apply, then deploy, close together. Same instruction as 0018, 0019 and 0022,
-- for a different reason: those tightened a rule, this one widens a list the
-- running app reads.
--
-- WHAT THIS COMPLETES
--
-- 0024 typed every purpose with the ACTIVITY it counts as. That was enough to
-- tell a session from a campus visit, and not enough to tell "Fix a session"
-- from "Complete a session" - both map to `session`, and the difference between
-- them is the whole of Sessions Set versus Sessions Done. This file adds the
-- missing half, which is what lets stage 3 delete Log Visit's Activity selector
-- and derive everything from the plan's purpose.
--
-- After this, one row of public.purposes answers every question the selector
-- used to ask:
--
--   activity        which of the six fixed keys, and therefore which weekly
--                   metric and whether the meeting gate applies
--   lifecycle       Set or Done for the two activities that have one; null for
--                   the four that do not
--   requires_note   whether the rep must type what they actually mean
--
-- THE LIFECYCLE RULE IS NOT A JUDGEMENT CALL
--
-- visits_lifecycle_matches_activity (0001) says, and has always said:
--
--   case when activity in ('session','campus_visit')
--     then lifecycle_status is not null and lifecycle_status in ('Set','Done')
--     else lifecycle_status is null
--   end
--
-- So a purpose mapping to meeting, olympiad, application or admission must
-- carry lifecycle NULL - not 'Done', not 'Immediate', not a new third value.
-- Anything else produces a visit row the visits table refuses. "First meeting"
-- and "Other" are therefore null, and the CHECK below is that same CASE
-- expression written against purposes, so the two tables cannot disagree.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The rest of a purpose
--
-- All nullable or defaulted, so not one existing row has to change and nothing
-- here can fail on live data. lifecycle is constrained in section 3, after the
-- back-fill, for the same reason 0024 added `activity` nullable first: the rows
-- exist already and have no value yet.
-- -----------------------------------------------------------------------------
alter table public.purposes
  add column if not exists lifecycle     text,
  add column if not exists requires_note boolean not null default false,
  -- Retiring rather than deleting. Deleting a purpose that a plan row still
  -- points at strands that plan: with the Activity selector gone there is no
  -- longer a by-hand fallback, so a rep would be holding a planned visit the
  -- app cannot turn into an activity. is_active keeps the row - and therefore
  -- the mapping - readable for ever while taking it out of the picker.
  add column if not exists is_active     boolean not null default true;

comment on column public.purposes.lifecycle is
  'Set or Done for a purpose whose activity is session or campus_visit; NULL '
  'for every other activity, because visits_lifecycle_matches_activity (0001) '
  'refuses a lifecycle on the other four. This is what tells "Fix a session" '
  'from "Complete a session" now that the Activity selector is gone.';
comment on column public.purposes.requires_note is
  'True when planning under this purpose must also record what the rep '
  'actually means, in daily_plans.purpose_note. True for "Other" and nothing '
  'else today.';
comment on column public.purposes.is_active is
  'False retires a purpose: gone from the picker, still resolvable for every '
  'plan row that already references it. Delete only a purpose nothing has '
  'ever used.';


-- -----------------------------------------------------------------------------
-- 2. Where the rep's own words go
--
-- daily_plans.purpose has always stored the LABEL as text, and it stays - it is
-- the snapshot that keeps history readable under the wording it was recorded
-- with. What it cannot do is survive a rename, which is what purpose_id adds.
--
-- ON DELETE SET NULL rather than RESTRICT: a purpose nothing has used may still
-- be deleted outright, and an old plan row losing its link is survivable
-- because the label snapshot is still there. is_active above is what stops a
-- purpose in USE from ever reaching that state.
-- -----------------------------------------------------------------------------
alter table public.daily_plans
  add column if not exists purpose_id   uuid references public.purposes (id) on delete set null,
  add column if not exists purpose_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_plans_purpose_note_length'
  ) then
    alter table public.daily_plans add constraint daily_plans_purpose_note_length check (
      purpose_note is null or length(btrim(purpose_note)) between 1 and 300
    );
  end if;
end $$;

comment on column public.daily_plans.purpose_id is
  'The purposes row this plan was made under. Added by 0025 so a renamed '
  'purpose stays resolvable; daily_plans.purpose keeps the label as it read on '
  'the day, which is what history should show.';
comment on column public.daily_plans.purpose_note is
  'What the rep actually meant, when the purpose demands it - "Other", today. '
  'Stored separately rather than folded into the label, because the label has '
  'to keep matching a purposes row for the activity to be derivable.';


-- -----------------------------------------------------------------------------
-- 3. The lifecycle of the purposes that exist
--
-- Four rows get a lifecycle; the rest are explicitly NULL, which they already
-- are. Matched on the exact label and only where lifecycle is still null, so a
-- re-run cannot overwrite a correction made by hand.
-- -----------------------------------------------------------------------------
update public.purposes p
   set lifecycle = m.lifecycle
  from (values
    ('Fix a session',           'Set'),
    ('Complete a session',      'Done'),
    ('Fix a campus visit',      'Set'),
    ('Complete a campus visit', 'Done')
  ) as m (label, lifecycle)
 where p.label = m.label
   and p.lifecycle is null;

-- "Other" is the one purpose that has to say what it really was.
update public.purposes
   set requires_note = true
 where label = 'Other';


-- -----------------------------------------------------------------------------
-- 3b. The CHECK, mirroring visits_lifecycle_matches_activity exactly
--
-- Written as a CASE and not as the natural-looking `or` chain, for the reason
-- 0001 spells out against the visits table: a CHECK only rejects a FALSE
-- result, so
--
--   (activity in ('session','campus_visit') and lifecycle in ('Set','Done')) or ...
--
-- evaluates to NULL for a session purpose whose lifecycle is null, and lets the
-- row straight through. The CASE always returns true or false.
--
-- Added AFTER the back-fill so an existing row cannot fail it, and guarded so a
-- second run does not try to add it twice.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purposes_lifecycle_matches_activity'
  ) then
    alter table public.purposes add constraint purposes_lifecycle_matches_activity check (
      case
        when activity in ('session', 'campus_visit')
          then lifecycle is not null and lifecycle in ('Set', 'Done')
        else lifecycle is null
      end
    );
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. The four new purposes
--
-- Seeded WITH their mapping, which is the whole reason they were not seeded in
-- 0024: a purpose that reaches the picker before it can be mapped is a planned
-- visit the app cannot log.
--
--   Follow-up               meeting       the second and later visits to a
--                                         school. "First meeting" was the only
--                                         meeting-shaped purpose, so a
--                                         follow-up was being planned as a
--                                         first meeting or buried in "Other".
--   Olympiad registration   olympiad      the three one-shot activities, which
--   Application forms       application   have had target columns and rows on
--   Admissions              admission     the Targets screen since 0013 and no
--                                         way to be planned until now.
--
-- All four carry lifecycle NULL, because none of their activities may have one.
--
-- ON CONFLICT (label) DO NOTHING, exactly like 0001's own purpose seed: a
-- re-run must not duplicate a row, and must not overwrite a label an admin has
-- since edited or a mapping they have corrected.
-- -----------------------------------------------------------------------------
insert into public.purposes (label, activity, lifecycle, requires_note) values
  ('Follow-up',             'meeting',     null, false),
  ('Olympiad registration', 'olympiad',    null, false),
  ('Application forms',     'application', null, false),
  ('Admissions',            'admission',   null, false)
on conflict (label) do nothing;


-- -----------------------------------------------------------------------------
-- 5. Back-fill the link from plans to purposes
--
-- By label, which is the only key that exists on the old rows. A plan whose
-- purpose has since been renamed or deleted keeps purpose_id null and its label
-- snapshot; nothing reads purpose_id for a plan already logged.
-- -----------------------------------------------------------------------------
update public.daily_plans dp
   set purpose_id = p.id
  from public.purposes p
 where dp.purpose_id is null
   and dp.purpose = p.label;

create index if not exists daily_plans_purpose_id_idx
  on public.daily_plans (purpose_id)
  where purpose_id is not null;


-- -----------------------------------------------------------------------------
-- 6. Prove it landed
--
-- The assertions that matter here are not "did the columns appear" - they are
-- "can every purpose still produce a visit the visits table will accept", and
-- "does every weekly metric still have a way to be earned". Removing the
-- Activity selector means a metric with no purpose feeding it becomes
-- unreachable, silently, and nobody would notice until a week's numbers came in
-- flat.
-- -----------------------------------------------------------------------------
do $$
declare
  problems  text[] := '{}';
  bad       text;
  metric    record;
  purposes_def text;
  visits_def   text;
begin
  -- 6a. Every purpose is completely typed.
  select string_agg(format('%L', label), ', ' order by label) into bad
    from public.purposes where activity is null;
  if bad is not null then
    problems := problems || format('purposes with no activity: %s', bad);
  end if;

  -- 6b. Every purpose produces a lifecycle the VISITS table would accept. This
  --     is the CHECK restated as a query, so a failure names the row rather
  --     than arriving as a constraint violation on a rep's first visit.
  select string_agg(format('%L (%s/%s)', label, activity, coalesce(lifecycle, 'null')), ', '
                    order by label)
    into bad
    from public.purposes
   where case
           when activity in ('session', 'campus_visit')
             then lifecycle is null or lifecycle not in ('Set', 'Done')
           else lifecycle is not null
         end;
  if bad is not null then
    problems := problems || format(
      'purposes whose lifecycle visits_lifecycle_matches_activity would refuse: %s', bad);
  end if;

  -- 6c. EVERY WEEKLY METRIC HAS A SOURCE. Eight metrics, and after this file
  --     every one of them is reachable only through a purpose. Meetings is
  --     already guarded by 0024; the other seven are guarded here, and the
  --     three one-shots are the ones this file exists to make reachable at all.
  for metric in
    select * from (values
      ('Meetings',            'meeting',      null),
      ('Sessions Set',        'session',      'Set'),
      ('Sessions Done',       'session',      'Done'),
      ('Campus Visits Set',   'campus_visit', 'Set'),
      ('Campus Visits Done',  'campus_visit', 'Done'),
      ('Olympiad',            'olympiad',     null),
      ('Application Forms',   'application',  null),
      ('Admissions',          'admission',    null)
    ) as m (metric, activity, lifecycle)
  loop
    if not exists (
      select 1 from public.purposes p
       where p.is_active
         and p.activity = metric.activity
         and p.lifecycle is not distinct from metric.lifecycle
    ) then
      problems := problems || format(
        'no active purpose feeds the %s metric (%s/%s), so it cannot be earned '
        'once the Activity selector is gone',
        metric.metric, metric.activity, coalesce(metric.lifecycle, 'null'));
    end if;
  end loop;

  -- 6d. The two activity vocabularies still agree, as 0024 established.
  select pg_get_constraintdef(oid) into purposes_def
    from pg_constraint where conname = 'purposes_activity_valid';
  select pg_get_constraintdef(oid) into visits_def
    from pg_constraint where conname = 'visits_activity_valid';
  if purposes_def is null or visits_def is null then
    problems := problems || 'an activity CHECK has gone missing since 0024';
  elsif (select count(*) from regexp_matches(purposes_def, '''([^'']+)''', 'g'))
     <> (select count(*) from regexp_matches(visits_def, '''([^'']+)''', 'g')) then
    problems := problems || 'purposes and visits no longer list the same activities';
  end if;

  -- 6e. Exactly one purpose demands a note, and it is "Other".
  select string_agg(format('%L', label), ', ' order by label) into bad
    from public.purposes where requires_note and label <> 'Other';
  if bad is not null then
    problems := problems || format(
      'unexpected purposes demanding a note: %s (only "Other" should)', bad);
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Stage 3 mapping did not land cleanly: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Purposes fully typed: % active, all eight weekly metrics reachable. '
    '% plan row(s) linked by purpose_id, % still label-only (renamed or '
    'deleted purposes, which keep their snapshot).',
    (select count(*) from public.purposes where is_active),
    (select count(*) from public.daily_plans where purpose_id is not null),
    (select count(*) from public.daily_plans where purpose_id is null);
end $$;


-- -----------------------------------------------------------------------------
-- 7. Reading it back
--
--   -- the whole mapping, which is what Log Visit now derives from
--   select label, activity, lifecycle, requires_note, is_active
--     from public.purposes order by activity, lifecycle nulls first, label;
--
--   -- which metric each purpose feeds
--   select p.label,
--          case p.activity
--            when 'meeting'      then 'Meetings'
--            when 'session'      then 'Sessions ' || p.lifecycle
--            when 'campus_visit' then 'Campus Visits ' || p.lifecycle
--            when 'olympiad'     then 'Olympiad Registrations'
--            when 'application'  then 'Application Forms'
--            when 'admission'    then 'Admissions'
--          end as feeds
--     from public.purposes p where p.is_active order by feeds;
--
--   -- plans whose purpose can no longer be resolved. Only reachable for a
--   -- purpose that was DELETED rather than retired.
--   select dp.date, dp.purpose from public.daily_plans dp
--    where dp.purpose_id is null order by dp.date desc;
-- -----------------------------------------------------------------------------
