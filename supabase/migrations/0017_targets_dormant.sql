-- =============================================================================
-- KUbeats - migration 0017: mark public.targets dormant
--
-- ⚠ THIS MIGRATION IS OPTIONAL. IT CHANGES NO DATA AND NO SCHEMA.
--
-- Stage 2 of the flow redesign needs NO migration. Nothing was added, nothing
-- was dropped, and no constraint changed. This file exists only so the database
-- can say for itself why a table with rows in it has stopped being written to -
-- and it is safe to skip entirely if you would rather not add a file to the
-- chain.
--
-- WHY IT IS WORTH RUNNING ANYWAY
--
-- After stage 2 the application no longer reads or writes public.targets. The
-- table still holds every commitment a rep ever made. Someone opening the
-- database in six months will find a table that looks abandoned, and the
-- obvious next thought is "nothing uses this, drop it" - which would throw away
-- the one thing that makes the change reversible. These comments are there to
-- interrupt that thought.
--
-- WHAT STAGE 2 ACTUALLY DID
--
--   change 3  The DAILY target was the daily plan wearing a second name. Both
--             were exactly (institute, purpose); daily_plans has been the real
--             one since 0001 and the meeting gate depends on it. The duplicate
--             was removed from the app rather than built out.
--   change 4  The WEEKLY target became a read-only count of what was recorded.
--             No numbers to set, no submit, no lock, no admin reopen.
--
-- Together those mean nothing sets a target, so nothing writes this table.
--
-- WHAT IS DELIBERATELY *NOT* DONE HERE
--
--   * targets is NOT dropped, and neither is weekly_targets_pre_0013.
--   * targets_period_valid still accepts 'daily', 'weekly' and 'monthly'. The
--     app offers none of them; the database refuses none of them. That
--     asymmetry is the reversibility.
--   * enforce_target_lock and the targets_* RLS policies stay installed and
--     working. Rule 6 is still enforced for anything that writes this table
--     directly, and the targets suite in tests/integration/rules.test.ts still
--     exercises it - which is what keeps "reversible" an observed fact rather
--     than a claim in a comment.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice, and safe to run never.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Say it on the table itself
--
-- comment on ... is metadata only. It takes no lock worth the name, changes no
-- row, and is reversed by setting a different comment.
-- -----------------------------------------------------------------------------
comment on table public.targets is
  'DORMANT since the stage 2 flow redesign: no application code reads or '
  'writes this table. It holds the weekly/daily/monthly commitments reps made '
  'before targets were withdrawn, and is kept so the change stays reversible - '
  'reviving commitment means restoring the screens, not a migration. Do NOT '
  'drop it. See docs/flow-redesign-plan.md, changes 3 and 4.';

comment on column public.targets.locked is
  'Rule 6''s lock. Still enforced by enforce_target_lock for any direct write, '
  'but unreachable from the app since stage 2 removed the submit and reopen '
  'controls.';

comment on column public.targets.period is
  'daily / weekly / monthly. targets_period_valid still accepts all three; the '
  'app offers none of them. The asymmetry is deliberate - see the table '
  'comment.';

-- The older table 0013 renamed aside rather than dropped. Same reasoning, one
-- layer further back, and now doubly worth labelling.
do $$
begin
  if to_regclass('public.weekly_targets_pre_0013') is not null then
    comment on table public.weekly_targets_pre_0013 is
      'Superseded by public.targets in migration 0013 and never dropped. That '
      'table is itself dormant as of stage 2. Keep both: a backup taken before '
      '0013 restores into this one.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Prove nothing was harmed
--
-- The point of this file is that it changes nothing, so the assertion is that
-- everything is still exactly where it was.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  row_count integer;
begin
  if to_regclass('public.targets') is null then
    raise exception 'public.targets is missing - this migration assumes 0013 has been applied.';
  end if;

  select count(*) into row_count from public.targets;

  -- Every commitment still readable. This is the whole point.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'targets' and column_name = 'institutes_covered'
  ) then
    problems := problems || 'targets.institutes_covered has gone';
  end if;

  -- Rule 6 still installed, even though the app cannot reach it.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'targets_enforce_lock'
       and tgrelid = 'public.targets'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the targets_enforce_lock trigger has gone';
  end if;

  -- All three periods still accepted, which is what makes this reversible.
  if not exists (
    select 1 from pg_constraint
     where conname = 'targets_period_valid'
       and conrelid = 'public.targets'::regclass
  ) then
    problems := problems || 'targets_period_valid has gone';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'targets is not in the state 0017 expected: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'targets marked dormant. % commitment row(s) preserved, lock trigger and '
    'period CHECK both still in place. Nothing was changed.', row_count;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Reading it back
--
--   -- the commitments that were made before targets were withdrawn
--   select p.name, t.period, t.period_start, t.locked, t.meetings, t.sessions_set
--     from public.targets t
--     join public.profiles p on p.id = t.member
--    order by t.period_start desc;
--
--   -- and the note explaining why nothing writes them any more
--   select obj_description('public.targets'::regclass);
-- -----------------------------------------------------------------------------
