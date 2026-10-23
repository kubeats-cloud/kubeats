-- New audit table/policy only. Existing ownership rules and FO033 are unchanged.
begin;
do $$ begin
  if to_regclass('public.institute_reassignment_history') is null
     and to_regclass('public.institute_reassignment_history_0058_archive') is not null then
    alter table public.institute_reassignment_history_0058_archive rename to institute_reassignment_history;
  end if;
end $$;
create table if not exists public.institute_reassignment_history (
  id uuid primary key default gen_random_uuid(), institute_id uuid not null,
  from_rep uuid,to_rep uuid,changed_by uuid,changed_at timestamptz not null default now(),
  constraint institute_reassignment_changed check (from_rep is distinct from to_rep)
);
-- No cascading FKs: later profile/institute deletion cannot destroy audit evidence.
create index if not exists institute_reassignment_history_lookup
  on public.institute_reassignment_history(institute_id,changed_at desc,id);
alter table public.institute_reassignment_history enable row level security;
drop policy if exists reassignment_admin_read on public.institute_reassignment_history;
create policy reassignment_admin_read on public.institute_reassignment_history
  for select to authenticated using (public.is_admin());
revoke all on public.institute_reassignment_history from public,anon,authenticated;
grant select on public.institute_reassignment_history to authenticated;

create or replace function public.record_institute_reassignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.institute_reassignment_history(institute_id,from_rep,to_rep,changed_by)
    values(new.id,old.registered_by,new.registered_by,auth.uid());
  return new;
end;
$$;
revoke all on function public.record_institute_reassignment() from public,anon,authenticated;
create trigger institutes_record_reassignment after update of registered_by on public.institutes
  for each row when (old.registered_by is distinct from new.registered_by)
  execute function public.record_institute_reassignment();

create or replace function public.reject_reassignment_history_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Reassignment history is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.reject_reassignment_history_mutation() from public,anon,authenticated;
drop trigger if exists reassignment_history_immutable on public.institute_reassignment_history;
create trigger reassignment_history_immutable before update or delete or truncate
  on public.institute_reassignment_history for each statement
  execute function public.reject_reassignment_history_mutation();
commit;
