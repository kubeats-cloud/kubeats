-- =============================================================================
-- KUbeats - migration 0021: public.targets is live again
--
-- ⚠ THIS MIGRATION IS OPTIONAL. IT CHANGES NO DATA AND NO SCHEMA.
--
-- RESTORING THE WEEKLY TARGET NEEDS NO MIGRATION. Nothing is added, nothing is
-- dropped, and no constraint changes. Everything the restored screens write -
-- the table, the eight metric columns, targets_period_valid,
-- targets_period_start_aligned, the four RLS policies and the
-- targets_enforce_lock trigger - has been sitting there since 0013, untouched
-- by the stage 2 rework and verified untouched by 0017. That was the whole
-- point of retiring the feature from the APP rather than from the SCHEMA, and
-- this file is the bill coming good.
--
-- WHY IT IS WORTH RUNNING ANYWAY
--
-- 0017 wrote "DORMANT ... no application code reads or writes this table" onto
-- the table itself. That sentence is now false. A comment that lies is worse
-- than no comment: the next person to open this database would conclude the
-- targets screens they can see in the app are reading something else. So this
-- file rewrites those three comments and nothing else.
--
-- WHAT IS LIVE AGAIN, AND WHAT IS NOT
--
--   weekly   Live. A rep sets eight numbers for a week, saves a draft or
--            submits, and an admin reopens a submitted week. Rule 6 - the lock
--            trigger - is reachable from the app again rather than merely
--            installed.
--   daily    NOT live, and not coming back. Stage 2 found the daily target WAS
--            the daily plan - both were exactly (institute, purpose) - and
--            merged it into the Dashboard, where the meeting gate can see it.
--            Rebuilding it would put a second writer in front of the row Rule 2
--            checks.
--   monthly  NOT live. Withdrawn by the client before stage 2 and not asked for
--            since.
--
-- targets_period_valid still accepts all three, so the daily and monthly rows
-- reps committed before stage 2 are still valid, still readable, and simply not
-- what any screen asks for. The app writes the literal 'weekly' and filters on
-- it. That asymmetry is the same one 0017 described, pointing the other way.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice, and safe to run never.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Retract the dormancy notice
--
-- comment on ... is metadata only. It takes no lock worth the name, changes no
-- row, and is reversed by setting a different comment - which is exactly what
-- this is doing to 0017's.
-- -----------------------------------------------------------------------------
comment on table public.targets is
  'LIVE. One commitment per member per period. The app reads and writes the '
  'WEEKLY rows: a rep sets eight numbers for a week and submits them, and an '
  'admin reopens a submitted week (Rule 6, enforce_target_lock). Daily and '
  'monthly rows are historical - committed before the stage 2 rework, still '
  'valid, no longer offered. Superseded weekly_targets in 0013; marked dormant '
  'by 0017 and un-marked here. Do NOT drop it.';

comment on column public.targets.locked is
  'Rule 6''s lock. Enforced by enforce_target_lock for every write, and reached '
  'from the app again: submitting a week sets it, and only an admin can clear '
  'it. 0017''s note that it was unreachable no longer applies.';

comment on column public.targets.period is
  'daily / weekly / monthly. targets_period_valid accepts all three; the app '
  'offers and writes only ''weekly''. The daily target became the daily plan '
  'and monthly was withdrawn - see the table comment.';


-- -----------------------------------------------------------------------------
-- 2. Prove the app has everything it is about to rely on
--
-- 0017 asserted that nothing had been harmed. This asserts the stronger thing
-- the restored screens actually need: every column the form writes, the lock
-- trigger behind Submit and Reopen, both CHECKs the app mirrors in zod, and the
-- four policies that decide who may do which. If any of these had been quietly
-- dropped between then and now, the screens would fail at a rep's fingertips
-- instead of here.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  missing  text;
  pol      text;
begin
  if to_regclass('public.targets') is null then
    raise exception 'public.targets is missing - this migration assumes 0013 has been applied.';
  end if;

  -- Every column targets-form.tsx posts and week-summary.ts reads back.
  foreach missing in array array[
    'member', 'period', 'period_start', 'locked', 'submitted_at',
    'reopened_by', 'reopened_at',
    'meetings', 'sessions_set', 'sessions_done',
    'campus_visits_set', 'campus_visits_done',
    'olympiad', 'application', 'admission'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'targets'
         and column_name = missing
    ) then
      problems := problems || format('targets.%s has gone', missing);
    end if;
  end loop;

  -- institutes_covered is checked separately because the app does NOT write it
  -- and its absence would not break a screen. It is still asserted: it carries
  -- numbers reps committed before R1 took the metric off this screen, and
  -- dropping it is the one thing here that could not be undone.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'targets'
       and column_name = 'institutes_covered'
  ) then
    problems := problems || 'targets.institutes_covered has gone';
  end if;

  -- Rule 6, which Submit and Reopen both go through.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'targets_enforce_lock'
       and tgrelid = 'public.targets'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the targets_enforce_lock trigger has gone';
  end if;

  -- The CHECKs validation/weekly.ts mirrors, so a rep gets a sentence rather
  -- than a constraint name - plus the UNIQUE the upsert's onConflict names. A
  -- missing unique constraint would not error; it would silently start writing
  -- a second commitment row per week.
  foreach missing in array array[
    'targets_period_valid', 'targets_period_start_aligned',
    'targets_non_negative', 'targets_unique_per_period'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conname = missing and conrelid = 'public.targets'::regclass
    ) then
      problems := problems || format('%s has gone', missing);
    end if;
  end loop;

  -- Who may do what. The upsert needs insert AND update; the reopen needs an
  -- admin to pass targets_update's using clause.
  foreach pol in array array[
    'targets_select', 'targets_insert', 'targets_update', 'targets_delete'
  ] loop
    if not exists (
      select 1 from pg_policy
       where polname = pol and polrelid = 'public.targets'::regclass
    ) then
      problems := problems || format('the %s policy has gone', pol);
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.targets', 'INSERT')
     or not has_table_privilege('authenticated', 'public.targets', 'UPDATE') then
    problems := problems || 'authenticated cannot write targets';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'targets cannot carry the weekly commitment: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'targets is live again. % row(s) total, % of them weekly. Lock trigger, '
    'both CHECKs and all four policies present; nothing was changed.',
    (select count(*) from public.targets),
    (select count(*) from public.targets where period = 'weekly');
end $$;


-- -----------------------------------------------------------------------------
-- 3. Reading it back
--
--   -- this week's commitments across the team
--   select p.name, t.period_start, t.locked, t.submitted_at,
--          t.meetings, t.sessions_set, t.sessions_done
--     from public.targets t
--     join public.profiles p on p.id = t.member
--    where t.period = 'weekly'
--      and t.period_start = date_trunc('week', public.app_today())::date
--    order by p.name;
--
--   -- who reopened what, and when
--   select p.name as member, a.name as reopened_by, t.period_start, t.reopened_at
--     from public.targets t
--     join public.profiles p on p.id = t.member
--     left join public.profiles a on a.id = t.reopened_by
--    where t.reopened_at is not null
--    order by t.reopened_at desc;
--
--   -- the historical daily and monthly rows, which no screen shows
--   select period, count(*) from public.targets group by period order by period;
-- -----------------------------------------------------------------------------
