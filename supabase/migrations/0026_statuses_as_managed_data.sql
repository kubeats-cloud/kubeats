-- =============================================================================
-- KUbeats - migration 0026: the status vocabulary stops being hard-coded
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
--   * It does NOT add the per-status field configuration (tone, and the flags
--     deciding which conditional questions a status asks). Those are 4b's.
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
-- which counted violations before trying to build an index, and 0016's, which
-- established counting first.
--
-- It should find nothing. 0010 widened both CHECKs and seeded the table in the
-- same file, with an assertion that they agreed, so every value that can be
-- stored is a value the table has. This exists because "should" is not
-- "does", and because a hand-edited row or a service-role write could have
-- put anything in either column in the years since.
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
-- What is missing is the ability to RETIRE a status. Deleting one is refused by
-- three foreign keys the moment it has been used, which is correct - a deleted
-- status would erase what a past visit said - but it leaves an admin with no
-- way to take a status out of circulation at all.
-- -----------------------------------------------------------------------------
alter table public.institute_statuses
  add column if not exists is_active boolean not null default true;

comment on column public.institute_statuses.is_active is
  'False retires a status: gone from the picker, still resolvable for every '
  'institute and visit that already carries it. The only way to remove one '
  'from circulation once it has been used - three foreign keys refuse a '
  'delete, on purpose. Nothing filters on this until stage 4b, when the app '
  'starts reading the vocabulary from here instead of from its own constant.';


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
-- Six things, because six different mechanisms lean on this vocabulary and they
-- fail in different ways:
--
--   the two FKs exist, are VALIDATED, and restrict on both update and delete
--   the old CHECKs are gone, so nothing can refuse what the FK accepts
--   every status in use still resolves an open/closed category  -> FO016, Pending
--   institute_status_is_open() still answers for every row      -> FO016, stage 5
--   the history FK and its trigger are still in place           -> rule 4's audit
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

  -- 5c. Every status in use resolves a category. This is what Pending, FO016
  --     and stage 5 all rest on, and the FK now guarantees it by construction -
  --     but the category column is separately NOT NULL, so this checks the
  --     whole chain rather than just the reference.
  select string_agg(distinct format('%L', s.status), ', ') into bad
    from public.institute_statuses s
   where s.category is null or s.category not in ('open', 'closed');
  if bad is not null then
    problems := problems || format('statuses with no usable category: %s', bad);
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

  -- 5e. Rule 4's audit trail. The FK has been here since 0011; the trigger is
  --     what writes the rows, and a conversion like this is exactly when
  --     somebody tidies a trigger away by accident.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.institute_status_history'::regclass
       and contype = 'f' and confrelid = 'public.institute_statuses'::regclass
  ) then
    problems := problems || 'institute_status_history lost its FK to institute_statuses';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.institutes'::regclass
       and tgname = 'institutes_record_status_change' and not tgisinternal
  ) then
    problems := problems || 'the institutes_record_status_change trigger has gone';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.institutes'::regclass
       and tgname = 'institutes_touch_status' and not tgisinternal
  ) then
    problems := problems || 'the institutes_touch_status trigger has gone';
  end if;

  -- 5f. FO016 itself, and campus scoping's three policies. Neither is touched
  --     by this file; both are asserted because "not touched" is a claim.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.visits'::regclass
       and tgname = 'visits_follow_up_when_open' and not tgisinternal
  ) then
    problems := problems || 'the FO016 follow-up trigger has gone';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'visits_follow_up_required_when_awaiting'
  ) then
    problems := problems || '0010''s visits_follow_up_required_when_awaiting CHECK has gone';
  end if;
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
    'Statuses are managed data: % row(s) in institute_statuses (% active, % open, '
    '%% closed). Both CHECKs replaced by validated RESTRICT foreign keys; history '
    'FK, both status triggers, FO016 and campus scoping all still in place.',
    (select count(*) from public.institute_statuses),
    (select count(*) from public.institute_statuses where is_active),
    (select count(*) from public.institute_statuses where category = 'open'),
    (select count(*) from public.institute_statuses where category = 'closed');
end $$;


-- -----------------------------------------------------------------------------
-- 6. Reading it back
--
--   -- the vocabulary, as the database now states it once
--   select status, category, sort_order, is_active
--     from public.institute_statuses order by sort_order, status;
--
--   -- everything that now points at it
--   select conrelid::regclass as tbl, conname, confupdtype, confdeltype
--     from pg_constraint
--    where confrelid = 'public.institute_statuses'::regclass and contype = 'f'
--    order by 1;
--
--   -- how many rows each status is holding. A status with counts in either
--   -- column cannot be deleted or renamed; retire it instead.
--   select s.status,
--          (select count(*) from public.institutes i where i.status = s.status) as institutes,
--          (select count(*) from public.visits v where v.status_set_to = s.status) as visits,
--          (select count(*) from public.institute_status_history h where h.status = s.status) as history
--     from public.institute_statuses s order by s.sort_order, s.status;
-- -----------------------------------------------------------------------------
