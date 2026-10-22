-- KUbeats migration 0052: Status Management with status-specific dynamic fields
begin;

create table if not exists public.status_fields (
  id uuid primary key default gen_random_uuid(),
  status text not null references public.institute_statuses(status) on update cascade on delete cascade,
  field_name text not null,
  field_type text not null default 'select' check (field_type in ('select', 'text', 'date')),
  options text[] not null default '{}',
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint status_fields_unique_per_status unique (status, field_name)
);

alter table public.visits add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.follow_up_tasks add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.status_fields enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='status_fields' and policyname='status_fields_select') then
    create policy status_fields_select on public.status_fields for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='status_fields' and policyname='status_fields_insert') then
    create policy status_fields_insert on public.status_fields for insert to authenticated with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename='status_fields' and policyname='status_fields_update') then
    create policy status_fields_update on public.status_fields for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename='status_fields' and policyname='status_fields_delete') then
    create policy status_fields_delete on public.status_fields for delete to authenticated using (public.is_admin());
  end if;
end $$;

commit;
