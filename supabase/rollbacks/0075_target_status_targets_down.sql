-- =============================================================================
-- KUbeats - DOWN migration 0075
--
-- Removes the atomic save RPC and the target-status commitment child table.
-- This permanently deletes saved target-status numeric values. It does not
-- change public.targets or public.target_statuses.
-- =============================================================================

begin;

drop function if exists public.save_weekly_targets(
  date, integer, integer, integer, integer, integer, integer, integer, integer,
  integer, jsonb, boolean
);

drop table if exists public.target_status_targets;

drop function if exists public.enforce_target_status_target_lock();
drop function if exists public.set_target_status_target_updated_at();

do $$
declare
  problems text[] := '{}';
begin
  if to_regclass('public.target_status_targets') is not null then
    problems := problems || 'public.target_status_targets still exists';
  end if;
  if to_regprocedure('public.save_weekly_targets(date,integer,integer,integer,integer,integer,integer,integer,integer,integer,jsonb,boolean)') is not null then
    problems := problems || 'save_weekly_targets still exists';
  end if;
  if to_regprocedure('public.enforce_target_status_target_lock()') is not null then
    problems := problems || 'enforce_target_status_target_lock still exists';
  end if;
  if to_regprocedure('public.set_target_status_target_updated_at()') is not null then
    problems := problems || 'set_target_status_target_updated_at still exists';
  end if;
  if array_length(problems, 1) > 0 then
    raise exception '0075 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;
end $$;

commit;
