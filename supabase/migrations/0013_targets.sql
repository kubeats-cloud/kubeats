-- =============================================================================
-- KUbeats - migration 0013: one targets table for daily, weekly and monthly
--
-- WHAT THIS DOES
--
--   1. public.targets - the same commitment weekly_targets held, but keyed by
--      (member, period, period_start) so a rep can commit to a day, a week or a
--      month through one mechanism.
--   2. Adds institutes_covered, a ninth metric the other eight cannot express:
--      it is a count of DISTINCT institutes, not a count of rows.
--   3. Copies every existing weekly_targets row across, checks the counts
--      match, and only then renames the old table out of the way.
--
-- WHY ONE TABLE RATHER THAN THREE
--
-- The alternative was daily_targets and monthly_targets beside the existing
-- table. That would mean three lock triggers, three sets of RLS policies, and
-- Rule 7's achieved-count query written three times - then a fourth of each if
-- "quarterly" is ever asked for. Here the period is a value, so adding one is a
-- row, and there is exactly one lock rule to reason about.
--
-- THE OLD TABLE IS NOT DROPPED
--
-- It is renamed to weekly_targets_pre_0013 and left alone. Dropping it would be
-- the one step in this file that cannot be undone, and a backup taken BEFORE
-- this migration still contains tables/weekly_targets.json - restoring one of
-- those into a project where the table had been dropped would fail. Keep the
-- old table until you are confident, then run:
--
--     drop table public.weekly_targets_pre_0013;
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice - the copy will not duplicate, and the
--   rename is skipped once it has happened.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------
create table if not exists public.targets (
  id                  uuid primary key default gen_random_uuid(),
  member              uuid not null references public.profiles (id) on delete cascade,
  period              text not null,
  period_start        date not null,

  meetings            integer not null default 0,
  sessions_set        integer not null default 0,
  sessions_done       integer not null default 0,
  campus_visits_set   integer not null default 0,
  campus_visits_done  integer not null default 0,
  olympiad            integer not null default 0,
  application         integer not null default 0,
  admission           integer not null default 0,
  -- The ninth metric, and the only one that is not a count of visit rows.
  -- "Covered" means distinct institutes reached in the period, so visiting one
  -- school four times counts once.
  institutes_covered  integer not null default 0,

  locked              boolean not null default false,
  submitted_at        timestamptz,
  reopened_by         uuid references public.profiles (id) on delete set null,
  reopened_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint targets_unique_per_period unique (member, period, period_start),

  constraint targets_period_valid check (
    period in ('daily', 'weekly', 'monthly')
  ),

  -- period_start has to sit on the grid its period implies, which is the
  -- generalisation of weekly_targets_week_starts_monday.
  --
  -- The `else false` is not decoration. A CHECK only rejects a FALSE result -
  -- NULL passes - so a CASE with no ELSE would let a row with an unrecognised
  -- period straight through. That is the same trap
  -- visits_lifecycle_matches_activity documents in 0001, and it is written out
  -- here for the same reason.
  constraint targets_period_start_aligned check (
    case period
      when 'daily'   then true
      when 'weekly'  then extract(isodow from period_start) = 1
      when 'monthly' then extract(day    from period_start) = 1
      else false
    end
  ),

  constraint targets_non_negative check (
    meetings >= 0 and sessions_set >= 0 and sessions_done >= 0
    and campus_visits_set >= 0 and campus_visits_done >= 0
    and olympiad >= 0 and application >= 0 and admission >= 0
    and institutes_covered >= 0
  )
);

comment on table public.targets is
  'One commitment per member per period. Replaces weekly_targets, which is the '
  'weekly case of this table.';

comment on column public.targets.period_start is
  'The first day of the period: any date for daily, the Monday for weekly, the '
  '1st for monthly. Enforced by targets_period_start_aligned.';

comment on column public.targets.institutes_covered is
  'Distinct institutes reached in the period - a count of institutes, not of '
  'visits, which is why it cannot be tallied like the other eight.';

-- The unique constraint already indexes (member, period, period_start). The
-- team view asks the other way round: everyone's row for one period.
create index if not exists targets_period_lookup_idx
  on public.targets (period, period_start);


-- -----------------------------------------------------------------------------
-- 2. Who may read and write
--
-- Identical to the weekly_targets policies: a rep sees and writes their own, an
-- admin sees everyone's and may update (which is how a reopen happens), and
-- only an admin may delete.
--
-- Privileges spelled out because 0001's `grant ... on all tables` was a
-- one-time statement that cannot reach a table created now - the same reasoning
-- as 0011 and 0012.
-- -----------------------------------------------------------------------------
alter table public.targets enable row level security;

revoke all on public.targets from authenticated;
revoke all on public.targets from anon;
grant select, insert, update, delete on public.targets to authenticated;

drop policy if exists targets_select on public.targets;
create policy targets_select on public.targets
  for select to authenticated
  using (member = (select auth.uid()) or public.is_admin());

drop policy if exists targets_insert on public.targets;
create policy targets_insert on public.targets
  for insert to authenticated
  with check (member = (select auth.uid()));

drop policy if exists targets_update on public.targets;
create policy targets_update on public.targets
  for update to authenticated
  using (member = (select auth.uid()) or public.is_admin())
  with check (member = (select auth.uid()) or public.is_admin());

drop policy if exists targets_delete on public.targets;
create policy targets_delete on public.targets
  for delete to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 3. Rule 6, unchanged in substance and now period-agnostic
--
--   submit   locked flips false -> true, submitted_at stamped
--   locked   no further edits by anyone
--   reopen   an admin, and only an admin, may flip locked back to false;
--            reopened_by and reopened_at are recorded automatically
--
-- The same rule applies to all three periods on purpose. Submitting is opt-in -
-- saving a draft never locks anything - so a rep only locks a day if they mean
-- to, and a uniform rule is one thing to reason about instead of three.
--
-- A separate function from enforce_weekly_lock() rather than reusing it: that
-- one stays attached to the old table, and its message says "week", which would
-- be wrong for two of the three periods. The app maps the SQLSTATE rather than
-- the text, so no user reads either message - but a developer does.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_target_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A row created already submitted still gets its timestamp.
    if new.locked and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if old.locked then
    if new.locked then
      raise exception
        'This target period is locked. Ask an admin to reopen it before editing.'
        using errcode = 'check_violation';
    end if;

    if not public.is_admin() then
      raise exception
        'Only an admin can reopen a locked target period.'
        using errcode = 'insufficient_privilege';
    end if;

    new.reopened_by := (select auth.uid());
    new.reopened_at := now();
    return new;
  end if;

  if new.locked then
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_target_lock is
  'Rule 6 for public.targets, for every period. Stamps submitted_at and the '
  'reopen credentials itself so the audit trail cannot be forged by a client.';

drop trigger if exists targets_enforce_lock on public.targets;
create trigger targets_enforce_lock
  before insert or update on public.targets
  for each row execute function public.enforce_target_lock();


-- -----------------------------------------------------------------------------
-- 4. Bring the existing weekly commitments across
--
-- Every weekly_targets row becomes a targets row with period 'weekly'. The
-- lock state, the submission time and the reopen audit come with it, so a week
-- that was locked stays locked and a rep sees no change.
--
-- institutes_covered defaults to 0: it did not exist before, and inventing a
-- number for a commitment nobody made would be worse than showing none.
--
-- ON CONFLICT DO NOTHING makes a second run a no-op rather than an error.
-- Guarded by to_regclass so this file still runs after the rename below.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.weekly_targets') is null then
    raise notice 'weekly_targets is already renamed; skipping the copy.';
    return;
  end if;

  insert into public.targets (
    member, period, period_start,
    meetings, sessions_set, sessions_done,
    campus_visits_set, campus_visits_done,
    olympiad, application, admission,
    locked, submitted_at, reopened_by, reopened_at, created_at
  )
  select
    w.member, 'weekly', w.week_start,
    w.meetings, w.sessions_set, w.sessions_done,
    w.campus_visits_set, w.campus_visits_done,
    w.olympiad, w.application, w.admission,
    w.locked, w.submitted_at, w.reopened_by, w.reopened_at, w.created_at
  from public.weekly_targets w
  on conflict (member, period, period_start) do nothing;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Check the copy before touching the original
--
-- Nothing is renamed until every old row has a counterpart. If this raises, the
-- old table is still exactly where it was and nothing has been lost.
-- -----------------------------------------------------------------------------
do $$
declare
  old_count integer;
  new_count integer;
  mismatch  integer;
begin
  if to_regclass('public.weekly_targets') is null then
    raise notice 'weekly_targets already renamed; nothing to verify.';
    return;
  end if;

  select count(*) into old_count from public.weekly_targets;
  select count(*) into new_count from public.targets where period = 'weekly';

  if new_count < old_count then
    raise exception
      'Copy incomplete: weekly_targets has % rows, targets has % weekly rows. Nothing renamed.',
      old_count, new_count;
  end if;

  -- Not just the count: every row has to match value for value, or a copy that
  -- silently dropped a column would still pass a count check.
  select count(*) into mismatch
  from public.weekly_targets w
  left join public.targets t
    on t.member = w.member
   and t.period = 'weekly'
   and t.period_start = w.week_start
  where t.id is null
     or t.meetings           is distinct from w.meetings
     or t.sessions_set       is distinct from w.sessions_set
     or t.sessions_done      is distinct from w.sessions_done
     or t.campus_visits_set  is distinct from w.campus_visits_set
     or t.campus_visits_done is distinct from w.campus_visits_done
     or t.olympiad           is distinct from w.olympiad
     or t.application        is distinct from w.application
     or t.admission          is distinct from w.admission
     or t.locked             is distinct from w.locked;

  if mismatch > 0 then
    raise exception
      'Copy mismatched on % row(s). Nothing renamed; the original is untouched.',
      mismatch;
  end if;

  raise notice 'Copied % weekly commitment(s), all values verified.', old_count;

  -- Out of the way, not gone. See the header for the drop statement.
  alter table public.weekly_targets rename to weekly_targets_pre_0013;
  raise notice 'weekly_targets renamed to weekly_targets_pre_0013.';
end $$;


-- -----------------------------------------------------------------------------
-- 6. Prove the result
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
begin
  if to_regclass('public.targets') is null then
    problems := problems || 'the targets table is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'targets_enforce_lock'
       and tgrelid = 'public.targets'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the targets_enforce_lock trigger is missing';
  end if;

  if to_regclass('public.weekly_targets') is not null then
    problems := problems || 'weekly_targets still exists under its old name';
  end if;

  if not has_table_privilege('authenticated', 'public.targets', 'SELECT') then
    problems := problems || 'authenticated cannot read targets';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Targets are not correctly set up: %',
      array_to_string(problems, '; ');
  end if;

  raise notice
    'Targets: table, lock trigger and policies in place; % row(s) total (% weekly).',
    (select count(*) from public.targets),
    (select count(*) from public.targets where period = 'weekly');
end $$;
