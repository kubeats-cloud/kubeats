-- =============================================================================
-- KUbeats - DOWN migration 0072
--
-- Reverses supabase/migrations/0072_institutes_call_status.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   institutes_record_call_status_change trigger + its function.
--   institute_call_status_history, dropped whole.
--   institutes.call_status, call_status_updated_at, call_status_updated_by,
--   their FK and their partial index.
--   touch_institute_status(), restored to 0001's body (visit track only).
--   call_status_note_for(), dropped.
--
-- WHAT IT REFUSES TO UNDO
--
--   Every call status the app wrote while 0072 was in effect, and every
--   timeline row. Dropping the columns discards them. Check first:
--
--     select count(*) from public.institutes where call_status is not null;
--     select count(*) from public.institute_call_status_history;
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Refuses while 0073 still writes call_status - roll that back first.
--   Idempotent: safe to run twice.
-- =============================================================================

begin;

-- Refuse to drop while 0073's call RPCs still write/read call_status.
do $$
declare
  body text;
begin
  foreach body in array array['log_call', 'admin_update_call_report'] loop
    if exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = body
         and position('call_status' in pg_get_functiondef(p.oid)) > 0
    ) then
      raise exception
        'roll back 0073 first: public.%() still writes institutes.call_status', body;
    end if;
  end loop;

  if exists (
    select 1 from pg_views
     where schemaname = 'public' and viewname = 'audit_open_follow_ups'
       and position('call_status' in pg_get_viewdef('public.audit_open_follow_ups'::regclass, true)) > 0
  ) then
    raise exception
      'roll back 0073 first: public.audit_open_follow_ups still reads call_status';
  end if;
end $$;

drop trigger if exists institutes_record_call_status_change on public.institutes;

drop function if exists public.record_institute_call_status_change();

drop function if exists public.call_status_note_for(uuid, text);

drop table if exists public.institute_call_status_history;


-- 0001's function, exactly - the call branch has no meaning without the column.
create or replace function public.touch_institute_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is not null then
      new.status_updated_at := coalesce(new.status_updated_at, now());
      new.status_updated_by := coalesce(new.status_updated_by, (select auth.uid()));
    end if;
  elsif new.status is distinct from old.status then
    new.status_updated_at := now();
    new.status_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.touch_institute_status() is
  'Maintains status_updated_at and status_updated_by from 0001.';

alter table public.institutes drop constraint if exists institutes_call_status_fk;

drop index if exists public.institutes_call_status_fk_idx;

alter table public.institutes
  drop column if exists call_status_updated_by,
  drop column if exists call_status_updated_at,
  drop column if exists call_status;


-- Prove it landed.
do $$
declare
  problems text[] := '{}';
  body     text;
  c        text;
begin
  foreach c in array array[
    'call_status', 'call_status_updated_at', 'call_status_updated_by'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'institutes'
         and column_name = c
    ) then
      problems := array_append(problems, format('institutes.%s is still there', c));
    end if;
  end loop;

  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'institute_call_status_history'
  ) then
    problems := array_append(problems, 'institute_call_status_history is still there');
  end if;

  if exists (
    select 1 from pg_trigger
     where tgname = 'institutes_record_call_status_change'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_record_call_status_change is still attached');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'touch_institute_status';

  if body is null then
    problems := array_append(problems, 'touch_institute_status() is missing');
  elsif position('call_status' in body) > 0 then
    problems := array_append(problems, 'touch_institute_status() still mentions call_status');
  end if;

  foreach c in array array['institutes_touch_status', 'institutes_record_status_change'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.institutes'::regclass and not tgisinternal
    ) then
      problems := array_append(problems, format('%s has gone missing', c));
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception '0072 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0072 down applied: call_status columns and history are gone; '
    'touch_institute_status() is back to its 0001 body.';
end $$;

commit;
