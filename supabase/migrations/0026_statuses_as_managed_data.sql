-- =============================================================================
-- KUbeats - migration 0026: the status vocabulary stops being hard-coded,
--                           and gains everything an admin will need to manage it
--
-- ✅ ADDITIVE IN EFFECT, AND SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.
--
-- Nothing a rep or an admin can do changes because of this file. The same nine
-- statuses are accepted before and after; what changes is WHERE that list is
-- written down. The live app sends one of the nine, every one of the nine is a
-- row in public.institute_statuses, so every write that worked yesterday works
-- today.
--
-- It is safe in both orders for the same reason: the app does not read these
-- columns' constraints, only their values.
--
-- THE POINT: A CHECK CANNOT BE EXTENDED BY AN ADMIN. AN FK CAN.
--
-- Since 0010 the vocabulary has been stated in FOUR places:
--
--   public.institute_statuses          a table - the open/closed source of truth
--   institutes_status_valid            a CHECK listing nine literals
--   visits_status_set_to_valid         a CHECK listing nine literals
--   INSTITUTE_STATUS_CATALOGUE         the app's copy
--
-- 0010 knew this was duplication that rots and guarded it with an assertion
-- comparing the table to the two CHECKs. That guard ran once, at 0010 time.
--
-- The trap it was guarding against is the one stage 4b would walk straight
-- into. An admin inserting a row into institute_statuses would SUCCEED - and
-- the status would then be unusable, because every attempt to set it on an
-- institute or a visit fails against a CHECK that has never heard of it, with a
-- raw 23514. A vocabulary table the constraints do not know about is worse than
-- no admin panel at all.
--
-- So the two CHECKs become FOREIGN KEYS to the table. After this file the
-- vocabulary is stated in ONE place in the database, drift is impossible by
-- construction rather than by assertion, and adding a status is an INSERT.
--
-- public.institute_status_history.status has been an FK to this table since
-- 0011 - this file simply makes the other two agree with it. 0011's own comment
-- said rewriting the older CHECKs "is deliberately NOT done here: they work".
-- They still work; they have stopped being enough.
--
-- WHAT THIS FILE DOES NOT DO
--
--   * It does NOT add write policies to institute_statuses. Without them no
--     admin can add a status yet, and that is deliberate: the app still holds a
--     hard-coded catalogue, so a status added today would render as an unstyled
--     badge, would make isClosedStatus() false, and would be refused by
--     visitSchema. Policies and the panel land together in 4b, with the app
--     change that makes a new status legible.
--   * It does NOT make status compulsory. That is 4b, it is a TRIGGER, and it
--     is the one deploy-coupled statement in the whole of Phase 2.
--   * It does NOT add the admin PANEL. That is 4b.
--
-- WHAT IT ABSORBED FROM 4b, AND WHY
--
-- The per-status configuration - the badge tone, and the flags deciding which
-- conditional questions a status asks - was going to arrive with the panel in
-- 0027. It is here instead. Every one of those columns is additive with a
-- default, so moving them costs this file nothing and takes them out of the one
-- migration in Phase 2 that has to be applied in the same breath as a deploy.
-- Shrinking a deploy-coupled change is worth doing whenever it is free.
--
-- Section 3b arrives for the same reason: log_visit() stops discarding the date
-- on a DONE session or campus visit. That is a pure loosening, it belongs with
-- the asks_expected_date flags that make the form collect one, and it was
-- decided (D3) long before it was built.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Before anything else: can the foreign keys even be built?
--
-- An FK is validated against every existing row the moment it is added. If any
-- institute or visit holds a status that is not a row in institute_statuses,
-- the ALTER fails - and it fails with a message naming a constraint, not the
-- data, which is a bad way to find out.
--
-- So the question is asked HERE, where the answer can name the offending values
-- and say what to do about them. This is the same precedent as 0018 section 4,
-- which counted violations before trying to build an index.
--
-- It should find nothing. 0010 widened both CHECKs and seeded the table in the
-- same file, with an assertion that they agreed, so every value that can be
-- stored is a value the table has. This exists because "should" is not "does",
-- and because a hand-edited row or a service-role write could have put anything
-- in either column in the time since.
-- -----------------------------------------------------------------------------
do $$
declare
  bad_institutes text;
  bad_visits     text;
  bad_history    text;
begin
  select string_agg(distinct format('%L', i.status), ', ')
    into bad_institutes
    from public.institutes i
   where i.status is not null
     and not exists (
       select 1 from public.institute_statuses s where s.status = i.status
     );

  select string_agg(distinct format('%L', v.status_set_to), ', ')
    into bad_visits
    from public.visits v
   where v.status_set_to is not null
     and not exists (
       select 1 from public.institute_statuses s where s.status = v.status_set_to
     );

  -- Already an FK since 0011, so this cannot be non-empty. Asked anyway,
  -- because if it ever were, the cause would be something far stranger than a
  -- missing vocabulary row and the operator should hear about it here.
  select string_agg(distinct format('%L', h.status), ', ')
    into bad_history
    from public.institute_status_history h
   where not exists (
       select 1 from public.institute_statuses s where s.status = h.status
     );

  if bad_institutes is not null or bad_visits is not null or bad_history is not null then
    raise exception
      'Cannot point these columns at public.institute_statuses yet. Values in '
      'use that the vocabulary table does not have - institutes.status: [%]; '
      'visits.status_set_to: [%]; institute_status_history.status: [%]. Either '
      'add the missing status(es) to public.institute_statuses with their '
      'open/closed category, or correct the rows, then run this file again.',
      coalesce(bad_institutes, 'none'),
      coalesce(bad_visits, 'none'),
      coalesce(bad_history, 'none');
  end if;

  raise notice
    'Vocabulary check passed: % institute(s) and % visit(s) carry a status, all '
    'of them known to institute_statuses.',
    (select count(*) from public.institutes where status is not null),
    (select count(*) from public.visits where status_set_to is not null);
end $$;


-- -----------------------------------------------------------------------------
-- 2. What a managed vocabulary needs
--
-- The category column already exists and is already the source of truth -
-- institute_status_category() and institute_status_is_open() read it, and
-- enforce_follow_up_when_open() (FO016) asks the latter rather than keeping its
-- own list. None of that is touched here; it is restated because this file is
-- where someone will come looking for it.
--
-- What is missing is everything ELSE a person needs in order to add a status
-- and have it behave like the nine that were written by hand: a way to retire
-- one, a colour, and an answer to "what else does this status ask for".
-- -----------------------------------------------------------------------------
alter table public.institute_statuses
  -- Deleting a status is refused by three foreign keys the moment it has been
  -- used, which is correct - a deleted status would erase what a past visit
  -- said - but it leaves an admin with no way to take one out of circulation
  -- at all.
  add column if not exists is_active boolean not null default true,
  -- The badge colour. A COLUMN and not a derivation, because colour tracks the
  -- OUTCOME and not the open/closed category: "First meeting done" is green and
  -- still open, "Will not come" is slate and closed. CLAUDE.md states that
  -- rule; nothing can compute it, so an admin has to say.
  add column if not exists tone text not null default 'neutral',
  -- WHICH EXTRA QUESTIONS THIS STATUS ASKS, as data rather than as literals in
  -- the app. needsSessionDetail()/needsCampusCount() currently hard-code
  -- "Session done" and "Campus visit done"; these are what replace them, so a
  -- status an admin adds can ask for the same things.
  --
  -- A CLOSED VOCABULARY OF GROUPS, deliberately: every field behind these flags
  -- is a real column on public.visits. "Admin defines the fields" would mean an
  -- EAV blob that nothing could report on, no CHECK could constrain and
  -- report-view.tsx could not render.
  --
  -- THE FOLLOW-UP IS NOT AMONG THEM. It IS the category: an open status needs a
  -- follow-up date, and enforce_follow_up_when_open() (FO016) enforces that from
  -- the database. A flag would let an admin build a status the form never asks
  -- about and the trigger then refuses - one nobody could ever use.
  add column if not exists asks_expected_date  boolean not null default false,
  add column if not exists asks_session_detail boolean not null default false,
  add column if not exists asks_head_count     boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'institute_statuses_tone_valid') then
    alter table public.institute_statuses add constraint institute_statuses_tone_valid
      check (tone in ('success', 'warning', 'danger', 'neutral'));
  end if;
end $$;

comment on column public.institute_statuses.is_active is
  'False retires a status: gone from the picker, still resolvable for every '
  'institute and visit that already carries it. The only way to remove one '
  'from circulation once it has been used - three foreign keys refuse a '
  'delete, on purpose.';
comment on column public.institute_statuses.tone is
  'Badge colour: success, warning, danger or neutral. Tracks the OUTCOME, not '
  'the open/closed category - the two are related and not the same, and '
  'conflating them would paint "First meeting done" amber merely because more '
  'work follows it.';
comment on column public.institute_statuses.asks_expected_date is
  'Show the session / campus-visit date when this status is chosen. Written to '
  'visits.expected_date, which log_visit() keeps for a DONE visit as of this '
  'migration - see section 3b.';
comment on column public.institute_statuses.asks_session_detail is
  'Show the session topic and who took it (visits.session_topic, '
  'visits.session_taken_by).';
comment on column public.institute_statuses.asks_head_count is
  'Show the one student count (visits.students_attended). One, not two - the '
  'second count 0022 added went dormant again in Phase 2 stage 1.';

-- The nine, configured exactly as they behave today, so that the app-side
-- substitution that starts reading these columns is invisible on screen. The
-- tones are lifted from the VARIANTS map in status-badge.tsx; the asks_* flags
-- from needsSessionDetail()/needsCampusCount() and from which statuses the form
-- already shows a date for.
update public.institute_statuses s
   set tone                = v.tone,
       asks_expected_date  = v.asks_expected_date,
       asks_session_detail = v.asks_session_detail,
       asks_head_count     = v.asks_head_count
  from (values
    ('First meeting done',              'success', false, false, false),
    ('Session scheduled',               'warning', true,  false, false),
    ('Session done',                    'success', true,  true,  true ),
    ('Campus visit scheduled',          'warning', true,  false, false),
    ('Campus visit done',               'success', true,  false, true ),
    ('Pending for management approval', 'danger',  false, false, false),
    ('Invited principal for event',     'warning', false, false, false),
    ('RSVP received',                   'success', false, false, false),
    ('Will not come',                   'neutral', false, false, false)
  ) as v (status, tone, asks_expected_date, asks_session_detail, asks_head_count)
 where s.status = v.status;


-- -----------------------------------------------------------------------------
-- 2b. sort_order stops being unique
--
-- 0010 made it UNIQUE, which was reasonable for nine rows written by a
-- migration and is a trap for rows written by people. Two admins adding a
-- status, or any reordering that passes through a collision, fails with a 23505
-- that reads like a bug rather than like "pick another number".
--
-- Replaced with a plain index, and every caller orders by (sort_order, status)
-- so a tie is still deterministic. The default puts a new status after the nine
-- seeded ones rather than demanding a number nobody has a basis to choose.
-- -----------------------------------------------------------------------------
alter table public.institute_statuses
  drop constraint if exists institute_statuses_sort_order_unique;

alter table public.institute_statuses
  alter column sort_order set default 100;

create index if not exists institute_statuses_sort_order_idx
  on public.institute_statuses (sort_order, status);


-- -----------------------------------------------------------------------------
-- 3. The conversion itself
--
-- ON DELETE RESTRICT is the point of the whole design: a status that has been
-- used cannot be deleted, because deleting it would erase what a past visit
-- said. Retiring is is_active above.
--
-- ON UPDATE RESTRICT gives the rename rule for free, with no code to write:
--
--   rename a status NEVER USED   succeeds. This is the typo case, and the only
--                                one anybody actually hits.
--   rename a status IN USE       refused, 23503. The admin action turns that
--                                into "add the corrected one and retire this".
--
-- 0011's history FK defaults to NO ACTION, which refuses in the same cases, so
-- all three agree without being told to.
--
-- NULL IS STILL ALLOWED. An FK does not constrain null, so "no status yet"
-- remains exactly what it was - its own thing, neither open nor closed. Making
-- status compulsory is 4b's trigger, and it is deliberately not here.
--
-- The CHECKs are dropped rather than left alongside. Keeping both would mean a
-- status added in 4b passing the FK and failing the CHECK, which is the exact
-- trap this file exists to remove.
-- -----------------------------------------------------------------------------
alter table public.institutes drop constraint if exists institutes_status_valid;
alter table public.institutes drop constraint if exists institutes_status_fk;
alter table public.institutes add constraint institutes_status_fk
  foreign key (status) references public.institute_statuses (status)
  on update restrict on delete restrict;

alter table public.visits drop constraint if exists visits_status_set_to_valid;
alter table public.visits drop constraint if exists visits_status_set_to_fk;
alter table public.visits add constraint visits_status_set_to_fk
  foreign key (status_set_to) references public.institute_statuses (status)
  on update restrict on delete restrict;

-- The FK checks a value on the way in; these make the reverse lookup cheap, for
-- the delete/rename guard and for "which institutes are at this status".
create index if not exists institutes_status_fk_idx
  on public.institutes (status) where status is not null;
create index if not exists visits_status_set_to_idx
  on public.visits (status_set_to) where status_set_to is not null;

comment on column public.institutes.status is
  'A status from public.institute_statuses, enforced by a FOREIGN KEY as of '
  '0026 rather than by a CHECK listing nine literals. Still set by hand and '
  'never derived from visit activity (rule 4). Still nullable: "no status yet" '
  'is its own thing.';
comment on column public.visits.status_set_to is
  'Where this visit left the institute, from public.institute_statuses. A '
  'FOREIGN KEY as of 0026. Nullable until stage 4b makes a status compulsory.';


-- -----------------------------------------------------------------------------
-- 3b. log_visit() stops throwing away a DONE visit's date  (decision D3)
--
-- Reproduced in full because a function cannot be patched - the same reason
-- 0006, 0008, 0015, 0019, 0022 and 0023 each reproduced one. The body below is
-- 0015's, character for character, with ONE changed expression, marked inline.
--
-- THE SIGNATURE IS IDENTICAL, so there is still exactly one log_visit overload
-- and 0015's closing assertion still holds. No drop guard is needed and CREATE
-- OR REPLACE keeps the grants. That is the whole reason this is cheap.
--
-- WHY IT BELONGS HERE. asks_expected_date is true for "Session done" and
-- "Campus visit done" a few statements above, so the form is about to start
-- asking when the session was actually held. log_visit() has discarded that
-- answer since 0002: the value was only kept when the lifecycle was 'Set'. A
-- form that collects something the RPC throws away is worse than one that never
-- asked, and this is the conflicts register's C17.
--
-- IT ONLY EVER LOOSENS. Nothing that was stored stops being stored; one thing
-- that was dropped starts being kept. The live app never sends a date on a Done
-- visit - the field is not rendered - so applying this early changes nothing at
-- all until the code that asks for it ships.
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
    status_set_to, follow_up_date, follow_up_time, accuracy
  )
  values (
    p_institute_id,
    v_member,
    p_activity,
    case when v_lifecycle then p_lifecycle_status else null end,
    v_today,
    -- 0026 (D3): A DONE SESSION OR CAMPUS VISIT KEEPS ITS DATE.
    --
    -- This read `v_lifecycle and p_lifecycle_status = 'Set'` and threw the
    -- value away otherwise. "Session done" and "Campus visit done" now ask for
    -- the date the session was actually held (asks_expected_date, section 2),
    -- and a form that collects an answer the RPC discards is worse than one
    -- that never asked.
    --
    -- THE ACTIVITY TEST STAYS: expected_date is meaningless on a meeting or a
    -- one-shot, so a stale form field still cannot smuggle one through.
    --
    -- What a "Set" means is unchanged: the promise is still in expected_date
    -- while `date` records the day the promise was made, because the weekly
    -- rollup counts by `date` and a session fixed today must earn its credit in
    -- this week.
    case when v_lifecycle then p_expected_date else null end,
    p_latitude,
    p_longitude,
    p_photo_url,
    p_notes,
    p_status_set_to,
    p_follow_up_date,
    p_follow_up_time,
    p_accuracy
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


-- -----------------------------------------------------------------------------
-- 4. visits_follow_up_required_when_awaiting is UNTOUCHED, and that is a choice
--
-- 0010's CHECK still names two literal statuses and still requires a follow-up
-- date for them. It is not converted, not widened and not dropped:
--
--   * it is about a RULE, not a vocabulary. Being a literal list is what it is
--     for - those two statuses wait on somebody else's answer with nothing
--     scheduled to bring them back.
--   * it is a strict subset of enforce_follow_up_when_open() (FO016), which
--     asks institute_status_is_open() and therefore already covers any status
--     an admin adds. 0018 kept it precisely so dropping the trigger could not
--     silently lose 0010's guarantee, and that reasoning is unchanged.
--
-- ⚠ ONE CONSEQUENCE WORTH NAMING. If an admin ever RETIRES one of those two
-- statuses and adds a replacement under a new name, this CHECK stops covering
-- it. Nothing breaks - the trigger still demands the date, because it asks the
-- category rather than the name - but the belt is gone and only the braces
-- remain.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 5. Prove it landed, and prove nothing that read these columns is broken
--
-- Eight things, because eight different mechanisms lean on this vocabulary or
-- on log_visit(), and they fail in different ways:
--
--   the two FKs exist, are VALIDATED, and restrict on both update and delete
--   the old CHECKs are gone, so nothing can refuse what the FK accepts
--   every status has a usable category and tone                 -> FO016, badges
--   institute_status_is_open() still answers for every row      -> FO016, stage 5
--   the asks_* flags match what the app hard-codes today        -> no visible change
--   log_visit() is still ONE overload and keeps a Done date     -> D3, 0015's rule
--   the history FK and both status triggers are in place        -> rule 4's audit
--   campus scoping's policies are untouched                     -> the boundary
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  fk       record;
  bad      text;
  n        integer;
begin
  -- 5a. Both FKs, validated, and restricting in both directions.
  for fk in
    select * from (values
      ('institutes_status_fk', 'institutes'),
      ('visits_status_set_to_fk', 'visits')
    ) as f (name, tbl)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conname = fk.name and c.contype = 'f'
         and c.confrelid = 'public.institute_statuses'::regclass
    ) then
      problems := problems || format('%s is missing or does not point at institute_statuses', fk.name);
    elsif not (select convalidated from pg_constraint where conname = fk.name) then
      problems := problems || format('%s exists but was never validated against the data', fk.name);
    else
      if (select confupdtype from pg_constraint where conname = fk.name) <> 'r' then
        problems := problems || format('%s does not RESTRICT on update, so a status could be renamed under live rows', fk.name);
      end if;
      if (select confdeltype from pg_constraint where conname = fk.name) <> 'r' then
        problems := problems || format('%s does not RESTRICT on delete, so a status in use could be deleted', fk.name);
      end if;
    end if;
  end loop;

  -- 5b. The CHECKs are gone. Both present would mean a status added in 4b
  --     passes one and fails the other.
  for fk in
    select * from (values
      ('institutes_status_valid'), ('visits_status_set_to_valid')
    ) as f (name)
  loop
    if exists (select 1 from pg_constraint where conname = fk.name) then
      problems := problems || format(
        '%s is still installed - it would refuse any status an admin adds', fk.name);
    end if;
  end loop;

  -- 5c. Every status resolves a category AND a tone. Pending, FO016 and stage 5
  --     rest on the first; every badge on screen rests on the second.
  select string_agg(distinct format('%L', s.status), ', ') into bad
    from public.institute_statuses s
   where s.category is null or s.category not in ('open', 'closed');
  if bad is not null then
    problems := problems || format('statuses with no usable category: %s', bad);
  end if;

  select string_agg(distinct format('%L', s.status), ', ') into bad
    from public.institute_statuses s
   where s.tone is null or s.tone not in ('success', 'warning', 'danger', 'neutral');
  if bad is not null then
    problems := problems || format('statuses with no usable tone: %s', bad);
  end if;

  -- 5d. The function FO016 actually calls still answers, for every row.
  select count(*) into n
    from public.institute_statuses s
   where public.institute_status_is_open(s.status) is null;
  if n > 0 then
    problems := problems || format(
      'institute_status_is_open() returns null for % status(es) - FO016 would stop '
      'demanding a follow-up for them', n);
  end if;

  -- 5e. The asks_* flags say exactly what the app hard-codes TODAY, which is
  --     what makes the app-side substitution invisible. If these drift, a rep
  --     stops being asked for a head count on a session, or starts being asked
  --     on a status that has no students in it.
  select string_agg(format('%L', status), ', ' order by status) into bad
    from public.institute_statuses
   where asks_session_detail <> (status = 'Session done');
  if bad is not null then
    problems := problems || format(
      'asks_session_detail disagrees with needsSessionDetail() for: %s', bad);
  end if;

  select string_agg(format('%L', status), ', ' order by status) into bad
    from public.institute_statuses
   where asks_head_count <> (status in ('Session done', 'Campus visit done'));
  if bad is not null then
    problems := problems || format(
      'asks_head_count disagrees with needsCampusCount()/needsSessionDetail() for: %s', bad);
  end if;

  -- 5f. log_visit(): exactly one overload, and it no longer drops a Done date.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'log_visit';
  if n <> 1 then
    problems := problems || format(
      'there are %s log_visit overloads, expected exactly 1 - every visit would '
      'fail as ambiguous', n);
  else
    select pg_get_functiondef(p.oid) into bad
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'log_visit';
    if position('p_lifecycle_status = ''Set'' then p_expected_date' in bad) > 0 then
      problems := problems
        || 'log_visit() still discards expected_date on a Done visit (D3 did not apply)';
    end if;
    if position('public.app_today()' in bad) = 0 then
      problems := problems
        || 'log_visit() no longer reads app_today() - the IST calendar day has been lost';
    end if;
    if (select prosecdef from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'log_visit') then
      problems := problems
        || 'log_visit() is SECURITY DEFINER - campus scoping would not apply inside it';
    end if;
  end if;

  -- 5g. Rule 4's audit trail, and the meeting gate beside it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.institute_status_history'::regclass
       and contype = 'f' and confrelid = 'public.institute_statuses'::regclass
  ) then
    problems := problems || 'institute_status_history lost its FK to institute_statuses';
  end if;
  foreach bad in array array[
    'institutes_record_status_change', 'institutes_touch_status'
  ] loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.institutes'::regclass and tgname = bad and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', bad);
    end if;
  end loop;
  foreach bad in array array[
    'visits_enforce_meeting_gate', 'visits_require_checkin', 'visits_follow_up_when_open'
  ] loop
    if not exists (
      select 1 from pg_trigger
       where tgrelid = 'public.visits'::regclass and tgname = bad and not tgisinternal
    ) then
      problems := problems || format('the %s trigger has gone', bad);
    end if;
  end loop;
  if not exists (
    select 1 from pg_constraint where conname = 'visits_follow_up_required_when_awaiting'
  ) then
    problems := problems || '0010''s visits_follow_up_required_when_awaiting CHECK has gone';
  end if;

  -- 5h. Campus scoping. Not touched by this file; asserted because "not
  --     touched" is a claim, and this is the security boundary.
  foreach bad in array array[
    'institutes_select', 'institutes_update', 'institute_status_history_select'
  ] loop
    if not exists (select 1 from pg_policy where polname = bad) then
      problems := problems || format('campus scoping policy %s has gone', bad);
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception 'Status vocabulary did not convert cleanly: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Statuses are managed data: % row(s) (% active, % open, % closed), all with '
    'a tone and their conditional-question flags. Both CHECKs replaced by '
    'validated RESTRICT foreign keys. log_visit() is one overload and keeps a '
    'Done date. History FK, both status triggers, the meeting gate, the presence '
    'guarantee, FO016 and campus scoping all still in place.',
    (select count(*) from public.institute_statuses),
    (select count(*) from public.institute_statuses where is_active),
    (select count(*) from public.institute_statuses where category = 'open'),
    (select count(*) from public.institute_statuses where category = 'closed');
end $$;


-- -----------------------------------------------------------------------------
-- 6. Reading it back
--
--   -- the vocabulary, as the database now states it once
--   select status, category, tone, sort_order, is_active,
--          asks_expected_date, asks_session_detail, asks_head_count
--     from public.institute_statuses order by sort_order, status;
--
--   -- everything that now points at it
--   select conrelid::regclass as tbl, conname, confupdtype, confdeltype
--     from pg_constraint
--    where confrelid = 'public.institute_statuses'::regclass and contype = 'f'
--    order by 1;
--
--   -- how many rows each status is holding. A status with counts in any column
--   -- cannot be deleted or renamed; retire it instead.
--   select s.status,
--          (select count(*) from public.institutes i where i.status = s.status) as institutes,
--          (select count(*) from public.visits v where v.status_set_to = s.status) as visits,
--          (select count(*) from public.institute_status_history h where h.status = s.status) as history
--     from public.institute_statuses s order by s.sort_order, s.status;
--
--   -- D3 in effect: Done visits that now carry the date they were held on
--   select date, activity, lifecycle_status, expected_date
--     from public.visits
--    where lifecycle_status = 'Done' and expected_date is not null
--    order by date desc;
-- -----------------------------------------------------------------------------
