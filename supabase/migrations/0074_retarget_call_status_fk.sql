-- =============================================================================
-- KUbeats - migration 0074: follow_up_tasks.status_set_to -> call_statuses
--
-- PART 4. THE ONE-WAY DOOR. Every read that belongs to the call track already
-- asks call_statuses (0070/0073) and is live; the only thing still tying a
-- filed call to the VISIT vocabulary is the foreign key itself. This file
-- flips that key and nothing else:
--
--   follow_up_tasks.status_set_to -> public.institute_statuses(status)
--   follow_up_tasks.status_set_to -> public.call_statuses(status)
--
-- SAME CONSTRAINT NAME (follow_up_tasks_status_set_to_fk), so every assertion
-- block that looks it up by name - 0052, 0065 - still finds it.
-- ON UPDATE RESTRICT / ON DELETE RESTRICT, exactly as before: renaming or
-- deleting a status still has to go through the settings that check for use.
--
-- WHAT DOES NOT MOVE:
--   * institutes_status_fk (institutes.status) and visits_status_set_to_fk
--     (visits.status_set_to) stay on institute_statuses. The visit track is
--     untouched by this file and by the two migrations after it.
--   * No function body, view, policy, index or app file changes here. 0073
--     already moved log_call(), admin_update_call_report(),
--     call_activity_report(), materialise_due_followups(), the FO038 guard,
--     cancel-on-close and audit_open_follow_ups onto the call track.
--
-- WHY IT IS ONE-WAY: once an admin creates a status that exists ONLY in
-- call_statuses and a real call carries it, the down migration cannot rebuild
-- the visit-side FK without a 23503. That is by design; see the rollback's
-- header. On a database where the two vocabularies are still copies, up and
-- down are symmetric.
--
-- PRE-FLIGHT (before anything is dropped): the distinct non-null values in
-- follow_up_tasks.status_set_to must all exist in call_statuses. If even one
-- does not, this file aborts with the orphan count and changes nothing -
-- dropping the old key first would leave the table unprotected and the new
-- key would fail with 23503.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: if the key already points at call_statuses it is dropped
--   and recreated against the same table, which is a no-op in effect.
--
-- DOWN
--   supabase/rollbacks/0074_retarget_call_status_fk_down.sql
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. Pre-flight - abort the whole migration before dropping anything
-- -----------------------------------------------------------------------------
do $$
declare
  problems    text[] := '{}';
  c           text;
  n_orphans   integer;
  n_values    integer;
  body        text;
begin
  -- 1a. Zero orphans. The retarget itself would raise 23503 on the first one,
  -- but by then the old key is already gone inside this transaction. Check
  -- first, and say how many so the report is a count and not a guess.
  select count(distinct t.status_set_to), count(*) filter (where s.status is null)
    into n_values, n_orphans
    from (
      select distinct status_set_to
        from public.follow_up_tasks
       where status_set_to is not null
    ) t
    left join public.call_statuses s on s.status = t.status_set_to;

  if n_orphans > 0 then
    raise exception
      '0074 aborted: % of % distinct follow_up_tasks.status_set_to value(s) have no call_statuses row. Retargeting would fail with 23503; do not force it.',
      n_orphans, n_values;
  end if;

  raise notice
    '0074 pre-flight: % distinct status_set_to value(s), 0 orphan(s).',
    n_values;

  -- 1b. The visit track still points at institute_statuses.
  foreach c in array array['institutes_status_fk', 'visits_status_set_to_fk'] loop
    if not exists (
      select 1 from pg_constraint
       where conname = c
         and contype = 'f'
         and confrelid = 'public.institute_statuses'::regclass
    ) then
      problems := array_append(
        problems,
        format('%s does not reference public.institute_statuses - the visit track has already moved', c));
    end if;
  end loop;

  -- 1c. The inert half really is applied (0070/0071/0072/0073), so this file
  -- is not retargeting a call track that has nowhere to point.
  foreach c in array array[
    'call_statuses', 'call_status_fields', 'institute_call_status_history'
  ] loop
    if to_regclass(format('public.%s', c)) is null then
      problems := array_append(problems, format('public.%s is missing - run 0070-0072 first', c));
    end if;
  end loop;

  foreach c in array array[
    'status_source', 'is_open', 'visit_status', 'call_status'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_open_follow_ups'
         and column_name = c
    ) then
      problems := array_append(problems, format('audit_open_follow_ups.%s is missing - run 0073 first', c));
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'institutes'
       and column_name = 'call_status'
  ) then
    problems := array_append(problems, 'institutes.call_status is missing - run 0072 first');
  end if;

  -- 1d. The call-side bodies shipped by 0073. If they still read
  -- institute_statuses, the FK is not the only thing left on the visit track
  -- and this file must not pretend otherwise.
  foreach c in array array[
    'log_call', 'admin_update_call_report', 'call_activity_report'
  ] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = c;

    if body is null then
      problems := array_append(problems, format('%s() is missing - run 0073 first', c));
    elsif position('call_statuses' in body) = 0 then
      problems := array_append(problems, format('%s() does not read call_statuses - 0073 is not in place', c));
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception '0074 pre-flight failed: %', array_to_string(problems, '; ');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. The flip - same name, same actions, new parent table
-- -----------------------------------------------------------------------------
alter table public.follow_up_tasks
  drop constraint if exists follow_up_tasks_status_set_to_fk;

alter table public.follow_up_tasks
  add constraint follow_up_tasks_status_set_to_fk
  foreign key (status_set_to) references public.call_statuses (status)
  on update restrict on delete restrict;


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
begin
  -- 3a. The call key, by name, now points at call_statuses and still restricts.
  if not exists (
    select 1 from pg_constraint
     where conname = 'follow_up_tasks_status_set_to_fk'
       and conrelid = 'public.follow_up_tasks'::regclass
       and confrelid = 'public.call_statuses'::regclass
       and contype = 'f'
       and confupdtype = 'r'
       and confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'follow_up_tasks_status_set_to_fk does not reference public.call_statuses with restrict/restrict');
  end if;

  -- 3b. The visit track was not dragged along.
  foreach c in array array['institutes_status_fk', 'visits_status_set_to_fk'] loop
    if not exists (
      select 1 from pg_constraint
       where conname = c
         and contype = 'f'
         and confrelid = 'public.institute_statuses'::regclass
    ) then
      problems := array_append(
        problems,
        format('%s no longer references public.institute_statuses', c));
    end if;
  end loop;

  -- 3c. The reverse-lookup index survives the drop/recreate.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'follow_up_tasks'
       and indexname = 'follow_up_tasks_status_set_to_idx'
  ) then
    problems := array_append(problems, 'follow_up_tasks_status_set_to_idx has gone missing');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0074 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0074 applied: follow_up_tasks.status_set_to now references call_statuses. '
    'institutes.status and visits.status_set_to still reference institute_statuses. '
    'This is the one-way door.';
end $$;

commit;


-- =============================================================================
-- Afterwards
--
-- To verify from a SQL prompt:
--
--   select conname, confrelid::regclass
--     from pg_constraint
--    where conname like '%status%fk';
--
-- institutes_status_fk and visits_status_set_to_fk must still answer
-- institute_statuses; follow_up_tasks_status_set_to_fk must answer
-- call_statuses.
-- =============================================================================
