-- =============================================================================
-- KUbeats - migration 0070: a vocabulary of its own for calls
--
-- PART 3, HALF ONE. This file is INERT: it adds a table and copies rows into
-- it. Nothing reads `call_statuses` until 0073, and nothing writes it at all
-- until 0074 moves the foreign key. Applying this file changes no screen and
-- no behaviour.
--
-- THE CLIENT'S DECISION: Call Status and Log Visit Status are two genuinely
-- independent lists from now on. They start identical - every row of
-- institute_statuses is copied here, active and retired, global and
-- campus-scoped - and they diverge only when an admin edits one of them in
-- Settings. That is deliberate: day one must be a no-op.
--
-- WHY A SEPARATE TABLE AND NOT A `kind` COLUMN ON institute_statuses:
--
--   * The two vocabularies have to be able to hold the SAME NAME with
--     different meanings. A shared table keyed on the name cannot.
--   * institute_statuses is the FK target of `institutes.status`,
--     `visits.status_set_to`, `institute_status_history.status` and
--     `status_fields.status`. Widening it would put call-only statuses in
--     every one of those pickers and constraints.
--   * RLS already scopes institute_statuses by campus (0065). A second table
--     repeats that policy verbatim instead of adding a second dimension to it.
--
-- COLUMN-FOR-COLUMN PARITY is the rule here. Same names, same types, same
-- defaults, same CHECKs, same indexes as public.institute_statuses after
-- migrations 0010, 0026, 0048 and 0065. That is what lets every helper,
-- schema and panel treat the two tables identically, and what makes the seed
-- below a plain SELECT.
--
-- WHAT THIS FILE DOES NOT DO:
--
--   * It does not add `institutes.call_status` or `institute_call_status_history`
--     - that is 0072.
--   * It does not touch `status_fields` - call-status dynamic fields are their
--     own table in 0071.
--   * It does not move `follow_up_tasks_status_set_to_fk`. Until 0074, that
--     constraint still points at institute_statuses, and this table is only a
--     copy.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: re-running does not overwrite an admin's later edits to
--   the call list (the seed is `on conflict do nothing`), and the assertion
--   below only demands exact parity while the two lists are still identical.
--
-- DOWN
--   supabase/rollbacks/0070_call_statuses_down.sql drops the table, its
--   helpers and its policies. Safe only while nothing references it, i.e.
--   before 0072/0073 have been applied.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `status text primary key` rather than a surrogate uuid: the name is the
-- identity in both vocabularies, `follow_up_tasks.status_set_to` is text today,
-- and a surrogate key would force a second FK column plus a join in three RPCs
-- and two reports. ON UPDATE RESTRICT on every reference (added in 0074) still
-- refuses a rename once a call uses the status.
-- -----------------------------------------------------------------------------
create table if not exists public.call_statuses (
  status              text primary key,
  category            text    not null,
  sort_order          integer not null default 100,
  is_active           boolean not null default true,
  tone                text    not null default 'neutral',
  asks_expected_date  boolean not null default false,
  asks_session_detail boolean not null default false,
  asks_head_count     boolean not null default false,
  cancels_follow_ups  boolean not null default false,
  campus_id           uuid references public.campuses (id) on delete restrict,

  constraint call_statuses_category_valid check (category in ('open', 'closed')),
  constraint call_statuses_tone_valid
    check (tone in ('success', 'warning', 'danger', 'neutral'))
);

comment on table public.call_statuses is
  'The Call Status vocabulary - what a follow-up call left the institute '
  'doing, as a list an admin maintains. A separate table from '
  'institute_statuses (the Log Visit vocabulary) since 0070: the two start as '
  'an exact copy and diverge by admin edit, never by code.';

comment on column public.call_statuses.is_active is
  'False retires a status: gone from the Call Status picker, still resolvable '
  'for every call that already carries it. Retiring is the only removal path - '
  'there is no DELETE policy and no DELETE grant.';

comment on column public.call_statuses.cancels_follow_ups is
  'Mirrors institute_statuses.cancels_follow_ups (0048): setting the '
  'INSTITUTE''s call status to a row with this true cancels its open follow-up '
  'tasks and clears upcoming plans, exactly as Not Interested does on the visit '
  'track.';

comment on column public.call_statuses.campus_id is
  'NULL = visible to every campus. Set = visible only to that campus, its '
  'admins, and any team lead who supervises a rep there - see '
  'call_statuses_select.';

create index if not exists call_statuses_sort_order_idx
  on public.call_statuses (sort_order, status);

create index if not exists call_statuses_campus_idx
  on public.call_statuses (campus_id) where campus_id is not null;


-- -----------------------------------------------------------------------------
-- 2. The seed - every row, exactly as it stands today
--
-- `on conflict do nothing` and not `do update`: this file may be re-run while
-- an admin has already begun editing the call list, and a re-run must not drag
-- those edits back to the visit list's values. The assertion below proves the
-- copy is complete; it does not require the lists to still match.
-- -----------------------------------------------------------------------------
insert into public.call_statuses (
  status, category, sort_order, is_active, tone,
  asks_expected_date, asks_session_detail, asks_head_count,
  cancels_follow_ups, campus_id
)
select
  s.status, s.category, s.sort_order, s.is_active, s.tone,
  s.asks_expected_date, s.asks_session_detail, s.asks_head_count,
  s.cancels_follow_ups, s.campus_id
from public.institute_statuses s
on conflict (status) do nothing;


-- -----------------------------------------------------------------------------
-- 3. The open/closed question, asked of this table
--
-- Same shape and same grants as institute_status_category()/is_open() (0010).
-- NOT SECURITY DEFINER, on purpose: they read a vocabulary every signed-in
-- user may read anyway, and RLS narrowing that read is the desired behaviour
-- (0073's RPCs are SECURITY INVOKER for the same reason).
-- -----------------------------------------------------------------------------
create or replace function public.call_status_category(p_status text)
returns text
language sql
stable
set search_path = ''
as $fn$
  select s.category
  from public.call_statuses s
  where s.status = p_status;
$fn$;

comment on function public.call_status_category(text) is
  'The open/closed category of a CALL status. Null for an unknown status and '
  'for null, so a caller can tell "no status yet" from "closed".';

create or replace function public.call_status_is_open(p_status text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select public.call_status_category(p_status) = 'open';
$fn$;

comment on function public.call_status_is_open(text) is
  'True only for an open CALL status. Null for an unknown status and for null - '
  'an institute with no call status yet is not "closed".';

revoke all on function public.call_status_category(text) from public;
revoke all on function public.call_status_is_open(text) from public;
grant execute on function public.call_status_category(text) to authenticated;
grant execute on function public.call_status_is_open(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. Who may read and write it
--
-- SELECT is 0065's four clauses, re-stated against this table rather than
-- factored out: a policy that reads a shared helper hides which table it is
-- asking about, and 0065/0066/0067 each made the same choice. The fourth
-- clause keeps a cross-campus team lead (0061) from losing a status a rep
-- they supervise holds.
--
-- INSERT/UPDATE are admin-only (0027). There is NO DELETE policy and no
-- DELETE grant: retiring is the removal path, exactly as on the visit list.
-- -----------------------------------------------------------------------------
alter table public.call_statuses enable row level security;

revoke all on public.call_statuses from authenticated;
revoke all on public.call_statuses from anon;
grant select, insert, update on public.call_statuses to authenticated;

drop policy if exists call_statuses_select on public.call_statuses;
create policy call_statuses_select on public.call_statuses
  for select to authenticated
  using (
    campus_id is null
    or public.is_admin()
    or campus_id = public.my_campus()
    or exists (
      select 1
      from public.profiles r
      where r.campus_id = call_statuses.campus_id
        and public.supervises(r.id)
    )
  );

drop policy if exists call_statuses_insert on public.call_statuses;
create policy call_statuses_insert on public.call_statuses
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists call_statuses_update on public.call_statuses;
create policy call_statuses_update on public.call_statuses
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- -----------------------------------------------------------------------------
-- 5. Prove it landed
--
-- array_append() throughout - see 0032/0035 for why `||` on text[] with a bare
-- literal fails with 22P02 exactly when a check has something to report.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  n        integer;
  qual     text;
begin
  -- 5a. The columns, in parity with institute_statuses.
  foreach c in array array[
    'status', 'category', 'sort_order', 'is_active', 'tone',
    'asks_expected_date', 'asks_session_detail', 'asks_head_count',
    'cancels_follow_ups', 'campus_id'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'call_statuses'
         and column_name = c
    ) then
      problems := array_append(problems, format('call_statuses.%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conname = 'call_statuses_pkey'
       and conrelid = 'public.call_statuses'::regclass
  ) then
    problems := array_append(problems, 'call_statuses has no primary key');
  end if;

  foreach c in array array['call_statuses_category_valid', 'call_statuses_tone_valid'] loop
    if not exists (select 1 from pg_constraint where conname = c) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conname = 'call_statuses_campus_id_fkey'
       and conrelid = 'public.call_statuses'::regclass
       and confrelid = 'public.campuses'::regclass
       and confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'call_statuses.campus_id has no RESTRICT-on-delete foreign key to campuses');
  end if;

  foreach c in array array['call_statuses_sort_order_idx', 'call_statuses_campus_idx'] loop
    if not exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'call_statuses' and indexname = c
    ) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  -- 5b. The copy is complete: every visit status has a call twin.
  select count(*) into n
    from public.institute_statuses s
   where not exists (select 1 from public.call_statuses c where c.status = s.status);
  if n <> 0 then
    problems := array_append(problems,
      format('%s institute_statuses row(s) were not copied into call_statuses', n));
  end if;

  -- 5c. While the lists are still identical, the counts must match exactly.
  --     A call-only row means an admin has begun to diverge the list, which is
  --     the intended steady state and not a failure of this migration.
  select count(*) into n from public.institute_statuses;
  if (select count(*) from public.call_statuses) <> n then
    if not exists (
      select 1 from public.call_statuses c
       where not exists (select 1 from public.institute_statuses s where s.status = c.status)
    ) then
      problems := array_append(problems,
        'call_statuses was not copied completely - row counts differ but no call-only row exists');
    end if;
  end if;

  -- 5d. The helpers answer - asked of a row this table actually holds, so the
  --     check does not depend on any one seeded name existing.
  select count(*) into n
    from public.call_statuses c
   where public.call_status_category(c.status) is distinct from c.category;
  if n <> 0 then
    problems := array_append(problems,
      format('call_status_category() misreports %s row(s)', n));
  end if;
  select count(*) into n
    from public.call_statuses c
   where public.call_status_is_open(c.status) is distinct from (c.category = 'open');
  if n <> 0 then
    problems := array_append(problems,
      format('call_status_is_open() disagrees with category on %s row(s)', n));
  end if;
  if public.call_status_is_open('__no such status__') is not null then
    problems := array_append(problems, 'call_status_is_open() does not answer null for an unknown status');
  end if;

  -- 5e. The policies: four clauses on select, admin on both writes, no delete.
  select pg_get_expr(polqual, polrelid) into qual
    from pg_policy
   where polname = 'call_statuses_select'
     and polrelid = 'public.call_statuses'::regclass;

  if qual is null then
    problems := array_append(problems, 'call_statuses_select is missing');
  else
    if qual = 'true' then
      problems := array_append(problems, 'call_statuses_select is using(true)');
    end if;
    if position('is_admin' in qual) = 0 then
      problems := array_append(problems, 'call_statuses_select lost its admin clause');
    end if;
    if position('my_campus' in qual) = 0 then
      problems := array_append(problems, 'call_statuses_select lost its own-campus clause');
    end if;
    if position('supervises' in qual) = 0 then
      problems := array_append(problems, 'call_statuses_select lost its supervises() clause');
    end if;
    if position('campus_id is null' in lower(qual)) = 0 then
      problems := array_append(problems, 'call_statuses_select lost its global clause');
    end if;
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'call_statuses_insert'
       and polrelid = 'public.call_statuses'::regclass
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'call_statuses_insert is not admin-only');
  end if;

  if not exists (
    select 1 from pg_policy
     where polname = 'call_statuses_update'
       and polrelid = 'public.call_statuses'::regclass
       and pg_get_expr(polqual, polrelid) like '%is_admin%'
       and pg_get_expr(polwithcheck, polrelid) like '%is_admin%'
  ) then
    problems := array_append(problems, 'call_statuses_update is not admin-only on both halves');
  end if;

  if exists (
    select 1 from pg_policy
     where polrelid = 'public.call_statuses'::regclass and polcmd = 'd'
  ) then
    problems := array_append(problems,
      'a DELETE policy exists on call_statuses - retiring is still the only removal path');
  end if;

  if has_table_privilege('authenticated', 'public.call_statuses', 'DELETE') then
    problems := array_append(problems, 'authenticated holds DELETE on call_statuses');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0070 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0070 applied: call_statuses mirrors institute_statuses (% row(s) copied, '
    '% in the visit list), with a four-clause campus-aware select policy, '
    'admin-only writes, no delete path, and its own category helpers.',
    (select count(*) from public.call_statuses),
    (select count(*) from public.institute_statuses);
end $$;

commit;


-- =============================================================================
-- Afterwards
--
--   select (select count(*) from public.institute_statuses) visit,
--          (select count(*) from public.call_statuses)       call;  -- equal
--
--   select status, category, is_active, campus_id
--     from public.call_statuses order by sort_order, status;
-- =============================================================================
