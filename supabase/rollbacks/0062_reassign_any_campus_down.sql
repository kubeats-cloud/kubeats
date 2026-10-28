-- =============================================================================
-- KUbeats - DOWN migration 0062
--
-- Reverses supabase/migrations/0062_reassign_any_campus.sql.
-- NOT applied by walking migrations/ — this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   guard_institute_owner(), restored to its 0028 body — a reassignment must
--   once again land on a rep sharing the institute's own campus.
--
-- WHAT IT REFUSES TO UNDO
--
--   Any cross-campus reassignment made while 0062 was in effect. Re-applying
--   this down migration does NOT retroactively move such an institute back —
--   the trigger only re-checks on the next write to that row. Find any such
--   institute first and decide by hand whether to reassign it again:
--
--     select i.id, i.name, i.campus_id as institute_campus,
--            p.campus_id as owner_campus
--       from public.institutes i
--       join public.profiles p on p.id = i.registered_by
--      where p.campus_id is distinct from i.campus_id;
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice. Re-applying 0062 afterwards removes the
--   campus check again.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. guard_institute_owner(), back to the 0028 body — clause (a) restored.
-- -----------------------------------------------------------------------------
create or replace function public.guard_institute_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  v_new_owner_campus uuid;
  v_open_visits integer;
begin
  if new.registered_by is distinct from old.registered_by then

    if caller is not null and not public.is_admin() then
      raise exception
        'Who registered an institute cannot be changed.'
        using errcode = 'FO010';
    end if;

    -- (a) The new owner has to be able to see what they are given.
    if new.registered_by is not null and new.campus_id is not null then
      select campus_id into v_new_owner_campus
        from public.profiles where id = new.registered_by;

      if v_new_owner_campus is not null
         and v_new_owner_campus is distinct from new.campus_id then
        raise exception
          'That rep is not on this institute''s campus.'
          using errcode = 'FO025';
      end if;
    end if;

    -- (b) The current owner must not be standing in it.
    if old.registered_by is not null then
      select count(*) into v_open_visits
        from public.daily_plans dp
       where dp.member = old.registered_by
         and dp.institute_id = old.id
         and dp.checkin_at is not null
         and dp.checkout_at is null
         and dp.checkout_missing = false;

      if v_open_visits > 0 then
        raise exception
          'That rep is at this institute now - reassign it when they have finished.'
          using errcode = 'FO025';
      end if;
    end if;

  end if;

  return new;
end;
$$;

comment on function public.guard_institute_owner is
  'A SECURITY CONTROL, not bookkeeping: institutes.registered_by decides who '
  'can see the row, so changing it grants and revokes access. Immutable for a '
  'rep (FO010). An admin, the service role and the SQL editor may reassign, '
  'but only to a rep on the institute''s own campus, and never while the '
  'current owner holds an open check-in there (both FO025).';

drop trigger if exists institutes_guard_owner on public.institutes;

create trigger institutes_guard_owner
  before update of registered_by on public.institutes
  for each row
  execute function public.guard_institute_owner();


do $$
declare
  problems text[] := '{}';
  body     text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_institute_owner';

  if body is null or position('not on this institute' in body) = 0 then
    problems := array_append(problems, 'guard_institute_owner() did not get the campus check back');
  end if;

  if body is null or position('v_new_owner_campus' in body) = 0 then
    problems := array_append(problems, 'guard_institute_owner() did not get the v_new_owner_campus lookup back');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0062 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice '0062 down applied: a reassignment must again land on the institute''s own campus.';
end $$;
