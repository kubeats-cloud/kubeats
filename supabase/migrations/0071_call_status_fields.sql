-- =============================================================================
-- KUbeats - migration 0071: dynamic fields for the CALL vocabulary
--
-- PART 3, HALF ONE. INERT like 0070: nothing reads this table until 0073 wires
-- the call RPCs to it, and nothing writes it from the app until the Settings
-- panel gains a call scope. Applying this file changes no screen.
--
-- WHY A SEPARATE TABLE AND NOT A `kind` COLUMN ON status_fields:
--
--   * status_fields.status is a foreign key into institute_statuses. Once the
--     two vocabularies can hold the SAME NAME with different meanings, one
--     shared table keyed on the name cannot say which vocabulary a field
--     belongs to - the FK would have to point at one table and accept names
--     from the other.
--   * The two lists diverge by admin edit. A field added to a call status must
--     not appear on the visit status of the same name, and vice versa.
--
-- COLUMN-FOR-COLUMN PARITY with public.status_fields (0054), with the one
-- renaming the fork requires: `status` becomes `call_status`, because that is
-- the column that carries the vocabulary's identity. Everything else - the
-- id, the CHECK'd field_type, options, is_required, sort_order, created_at,
-- and the (status, field_name) uniqueness - is identical, so the same
-- components and server actions can serve both without branching on shape.
--
-- WHAT THIS FILE DOES NOT DO:
--
--   * It does not touch public.status_fields. The visit track keeps reading
--     its own table (0054 + 0067), untouched.
--   * It does not add a polymorphic `kind` column to status_fields - that was
--     considered in Part 2 and rejected in favour of two plain tables.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: the seed is `on conflict do nothing`, so re-running does
--   not undo a field an admin has since added or removed on the call side.
--
-- DOWN
--   supabase/rollbacks/0071_call_status_fields_down.sql drops the table.
--   Safe only while 0073 has not yet read it.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------
create table if not exists public.call_status_fields (
  id          uuid primary key default gen_random_uuid(),
  call_status text not null
    references public.call_statuses (status) on update cascade on delete cascade,
  field_name  text not null,
  field_type  text not null default 'select'
    check (field_type in ('select', 'text', 'date')),
  options     text[] not null default '{}',
  is_required boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint call_status_fields_unique_per_status unique (call_status, field_name)
);

comment on table public.call_status_fields is
  'The custom fields a CALL status asks for - the call-side twin of '
  'public.status_fields (0054). One row per field per call status; '
  'call_status is a foreign key into call_statuses, not into '
  'institute_statuses, so the two vocabularies never share a field by name.';

comment on column public.call_status_fields.call_status is
  'The Call Status this field belongs to. Renamed from status_fields.status: '
  'the column names which vocabulary the row is about, so a reader cannot '
  'mistake it for a visit status.';

create index if not exists call_status_fields_status_idx
  on public.call_status_fields (call_status, sort_order);


-- -----------------------------------------------------------------------------
-- 2. The seed - every existing visit field, pointed at its call twin
--
-- The twin exists because 0070 copied every institute_statuses row before
-- this file ran (and the FK below would refuse the seed otherwise, which is
-- the check). `on conflict do nothing` so a re-run leaves admin edits alone.
-- -----------------------------------------------------------------------------
insert into public.call_status_fields (
  call_status, field_name, field_type, options, is_required, sort_order
)
select
  f.status, f.field_name, f.field_type, f.options, f.is_required, f.sort_order
from public.status_fields f
on conflict (call_status, field_name) do nothing;


-- -----------------------------------------------------------------------------
-- 3. Who may read and write it
--
-- SELECT mirrors 0067's rule, asked of call_statuses instead of
-- institute_statuses: a field is visible when the CALL status it belongs to is
-- visible - global, admin, the caller's own campus, or a campus holding a rep
-- the caller supervises. Written out rather than calling a shared helper for
-- the same reason 0065/0066/0067 each wrote their own clauses.
--
-- INSERT/UPDATE/DELETE are admin-only, exactly as on status_fields (0054).
-- Delete is allowed here - unlike call_statuses itself - because removing a
-- custom field never orphans a call: the answers already captured live in
-- follow_up_tasks.custom_fields (0054).
-- -----------------------------------------------------------------------------
alter table public.call_status_fields enable row level security;

revoke all on public.call_status_fields from authenticated;
revoke all on public.call_status_fields from anon;
grant select, insert, update, delete on public.call_status_fields to authenticated;

drop policy if exists call_status_fields_select on public.call_status_fields;
create policy call_status_fields_select on public.call_status_fields
  for select to authenticated
  using (
    exists (
      select 1
      from public.call_statuses s
      where s.status = call_status_fields.call_status
        and (
          s.campus_id is null
          or public.is_admin()
          or s.campus_id = public.my_campus()
          or exists (
            select 1
            from public.profiles r
            where r.campus_id = s.campus_id
              and public.supervises(r.id)
          )
        )
    )
  );

drop policy if exists call_status_fields_insert on public.call_status_fields;
create policy call_status_fields_insert on public.call_status_fields
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists call_status_fields_update on public.call_status_fields;
create policy call_status_fields_update on public.call_status_fields
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists call_status_fields_delete on public.call_status_fields;
create policy call_status_fields_delete on public.call_status_fields
  for delete to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- 4. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  n        integer;
  qual     text;
begin
  -- 4a. The columns, in parity with status_fields.
  foreach c in array array[
    'id', 'call_status', 'field_name', 'field_type', 'options',
    'is_required', 'sort_order', 'created_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'call_status_fields'
         and column_name = c
    ) then
      problems := array_append(problems, format('call_status_fields.%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conname = 'call_status_fields_pkey'
       and conrelid = 'public.call_status_fields'::regclass
  ) then
    problems := array_append(problems, 'call_status_fields has no primary key');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'call_status_fields_unique_per_status'
       and conrelid = 'public.call_status_fields'::regclass
  ) then
    problems := array_append(problems,
      'call_status_fields has no unique (call_status, field_name)');
  end if;

  -- 4b. The FK points at call_statuses, CASCADE on update and delete.
  if not exists (
    select 1 from pg_constraint
     where conname = 'call_status_fields_call_status_fkey'
       and conrelid = 'public.call_status_fields'::regclass
       and confrelid = 'public.call_statuses'::regclass
       and confupdtype = 'c'
       and confdeltype = 'c'
  ) then
    problems := array_append(problems,
      'call_status_fields.call_status has no on-update-cascade/on-delete-cascade FK to call_statuses');
  end if;

  -- 4c. The copy is complete: every visit field has a call twin.
  select count(*) into n
    from public.status_fields f
   where not exists (
     select 1 from public.call_status_fields c
      where c.call_status = f.status and c.field_name = f.field_name
   );
  if n <> 0 then
    problems := array_append(problems,
      format('%s status_fields row(s) were not copied into call_status_fields', n));
  end if;

  select count(*) into n from public.status_fields;
  if (select count(*) from public.call_status_fields) <> n then
    if not exists (
      select 1 from public.call_status_fields c
       where not exists (
         select 1 from public.status_fields f
          where f.status = c.call_status and f.field_name = c.field_name
       )
    ) then
      problems := array_append(problems,
        'call_status_fields was not copied completely - row counts differ but no call-only field exists');
    end if;
  end if;

  -- 4d. SELECT is the four-clause rule, asked of call_statuses.
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'call_status_fields_select'
     and polrelid = 'public.call_status_fields'::regclass;

  if qual is null then
    problems := array_append(problems, 'call_status_fields_select is missing');
  else
    if qual = 'true' then
      problems := array_append(problems, 'call_status_fields_select is using(true)');
    end if;
    if position('call_statuses' in qual) = 0 then
      problems := array_append(problems, 'call_status_fields_select no longer joins call_statuses');
    end if;
    if position('is_admin' in qual) = 0 then
      problems := array_append(problems, 'call_status_fields_select lost its admin clause');
    end if;
    if position('my_campus' in qual) = 0 then
      problems := array_append(problems, 'call_status_fields_select lost its own-campus clause');
    end if;
    if position('supervises' in qual) = 0 then
      problems := array_append(problems, 'call_status_fields_select lost its supervises() clause');
    end if;
    if position('campus_id is null' in lower(qual)) = 0 then
      problems := array_append(problems, 'call_status_fields_select lost its global clause');
    end if;
  end if;

  -- 4e. Writes are admin-only, all three of them.
  if not exists (
    select 1 from pg_policy
     where polname = 'call_status_fields_insert'
       and polrelid = 'public.call_status_fields'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'call_status_fields_insert is not admin-only');
  end if;
  if not exists (
    select 1 from pg_policy
     where polname = 'call_status_fields_update'
       and polrelid = 'public.call_status_fields'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'call_status_fields_update is not admin-only on both halves');
  end if;
  if not exists (
    select 1 from pg_policy
     where polname = 'call_status_fields_delete'
       and polrelid = 'public.call_status_fields'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'call_status_fields_delete is not admin-only');
  end if;

  -- 4f. The visit-side table is untouched.
  if not exists (
    select 1 from pg_constraint
     where conname = 'status_fields_status_fkey'
       and confrelid = 'public.institute_statuses'::regclass
  ) then
    problems := array_append(problems,
      'status_fields_status_fkey changed - this migration must not touch status_fields');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0071 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0071 applied: call_status_fields mirrors status_fields (% field(s) copied), '
    'with call_statuses-scoped select and admin-only writes.',
    (select count(*) from public.call_status_fields);
end $$;

commit;


-- =============================================================================
-- Afterwards
--
--   select (select count(*) from public.status_fields)       visit,
--          (select count(*) from public.call_status_fields)  call;  -- equal
--
--   select call_status, field_name, field_type, is_required
--     from public.call_status_fields order by call_status, sort_order;
-- =============================================================================
