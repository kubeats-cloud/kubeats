-- =============================================================================
-- KUbeats - migration 0011: an institute's status becomes a journey
--
-- WHAT THIS ADDS
--
--   1. public.institute_status_history - one row per status change, appended
--      forever rather than overwritten.
--   2. A trigger on public.institutes that appends that row whenever the status
--      actually changes, so no path can miss it.
--   3. A small trigger on public.visits that lets the row above remember WHICH
--      visit caused the change, when one did.
--   4. A one-time backfill, so every institute that already has a status starts
--      its timeline with the change we already know about.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
--
-- Status is set from two places today - log_visit() via status_set_to, and a
-- direct update to institutes - and nothing stops a third appearing. A trigger
-- on the column is the only mechanism that covers all of them at once, cannot
-- be forgotten by a new caller, and cannot be bypassed by a stale client or by
-- anyone poking PostgREST directly. It sits beside institutes_touch_status
-- from 0001, which already maintains status_updated_at / status_updated_by the
-- same way; that trigger is untouched and still runs.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- The open/closed category. It is a pure function of the status, and 0010 made
-- public.institute_statuses the one place that decides it - copying it onto
-- every history row would be a second answer to the same question that could
-- drift from the first. Ask public.institute_status_category(status), or join
-- the lookup table; the example query at the foot of this file does the latter.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice - the backfill will not duplicate.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table
--
-- `status` is a FOREIGN KEY to institute_statuses rather than a copy of the
-- nine values in yet another CHECK. That table did not exist when 0001 wrote
-- the constraints on institutes and visits; now that it does, a new table can
-- simply point at it, and adding a tenth status one day will not need this file
-- reopened. Referential integrity checks ignore RLS, so a rep's insert is
-- validated against the vocabulary exactly as an admin's is.
--
-- Rewriting the two older CHECK constraints as foreign keys is deliberately NOT
-- done here: they work, 0010 already proves they agree with the table, and
-- changing them would turn a rep's "unknown status" error from 23514 into
-- 23503 for no gain.
-- -----------------------------------------------------------------------------
create table if not exists public.institute_status_history (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null
               references public.institutes (id) on delete cascade,
  status       text not null
               references public.institute_statuses (status),
  changed_by   uuid references public.profiles (id) on delete set null,
  changed_at   timestamptz not null default now(),
  -- The visit whose status_set_to caused this, when one did. Null for a direct
  -- update, for the backfill, and for anything the hint below cannot vouch for.
  -- ON DELETE SET NULL, not CASCADE: deleting a visit must not erase the record
  -- that the institute's status moved.
  visit_id     uuid references public.visits (id) on delete set null
);

comment on table public.institute_status_history is
  'Append-only record of every institute status change. Written by the '
  'institutes_record_status_change trigger, never by the application.';

comment on column public.institute_status_history.status is
  'The value the status was set TO. The value it came from is the previous '
  'row for the same institute, which is what makes this a journey.';

comment on column public.institute_status_history.visit_id is
  'The visit that caused the change, when it was logged through log_visit(). '
  'Null means the change did not come from a visit, or could not be attributed.';

-- The timeline query is "this institute, newest first", so the index carries
-- the sort as well as the filter and the read needs no sort step.
create index if not exists institute_status_history_institute_idx
  on public.institute_status_history (institute_id, changed_at desc);

create index if not exists institute_status_history_visit_idx
  on public.institute_status_history (visit_id)
  where visit_id is not null;


-- -----------------------------------------------------------------------------
-- 2. Who may read it
--
-- The registry is shared - institutes_select is `using (true)` - and this is
-- the registry's own history, not anyone's personal work, so every signed-in
-- user reads all of it. That is a deliberate difference from visits, which are
-- scoped to their owner: "this school went cold in March" is a fact about the
-- school, and a rep picking it up next needs it.
--
-- There is NO insert, update or delete policy, on purpose. Rows appear only
-- through the SECURITY DEFINER trigger below, which runs as the table's owner
-- and is therefore not subject to these policies.
--
-- The privileges below are spelled out rather than assumed. 0001's
-- `grant ... on all tables in schema public` was a one-time statement: it
-- covered the tables that existed when it ran and cannot reach this one. What
-- has been covering later tables is the Supabase project's default privileges,
-- which grant everything to authenticated — so without the REVOKE here,
-- "append-only" would rest on a missing policy alone. Being explicit also
-- means this file behaves the same on a self-hosted instance or a plain
-- Postgres restore, which is the portability rule in CLAUDE.md.
-- -----------------------------------------------------------------------------
alter table public.institute_status_history enable row level security;

revoke all on public.institute_status_history from authenticated;
revoke all on public.institute_status_history from anon;
grant select on public.institute_status_history to authenticated;

drop policy if exists institute_status_history_select on public.institute_status_history;
create policy institute_status_history_select on public.institute_status_history
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- 3. Remembering which visit caused a change
--
-- log_visit() inserts the visit first and updates the institute afterwards, in
-- one transaction. This trigger fires on that insert and leaves a transaction
-- local note; the institutes trigger below reads it. The alternative was to
-- reproduce all 150 lines of log_visit() just to pass one id through, which is
-- how a function drifts from the copy in the previous migration.
--
-- The note carries the institute and the status as well as the visit id, and
-- the reader below uses it ONLY when both still match. So a transaction that
-- logs a visit against one school and then changes another school's status by
-- hand cannot mislink the two - the second change simply records no visit.
--
-- `set_config(..., true)` is transaction local: it is discarded at COMMIT or
-- ROLLBACK, which matters on a pooled connection where the next transaction may
-- belong to someone else entirely.
-- -----------------------------------------------------------------------------
create or replace function public.note_status_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status_set_to is not null then
    perform set_config(
      'app.status_visit',
      jsonb_build_object(
        'visit',     new.id,
        'institute', new.institute_id,
        'status',    new.status_set_to
      )::text,
      true
    );
  end if;
  return null;
end;
$$;

comment on function public.note_status_visit is
  'Leaves a transaction-local note saying which visit is about to change an '
  'institute''s status, for record_institute_status_change() to pick up.';

drop trigger if exists visits_note_status_visit on public.visits;
create trigger visits_note_status_visit
  after insert on public.visits
  for each row execute function public.note_status_visit();


-- -----------------------------------------------------------------------------
-- 4. Appending the history row
--
-- Fires only when the status actually moves. `is distinct from` rather than
-- `<>` so that null-to-a-value and a-value-to-null are both seen as changes,
-- and re-saving an institute without touching its status records nothing.
--
-- Setting a status back to null is NOT recorded: there is no such status, so
-- there would be nothing valid to write in the column. It stays visible in
-- status_updated_at, which 0001's trigger still maintains.
--
-- SECURITY DEFINER for two reasons: it must write to a table nobody holds an
-- INSERT grant on, and changed_by has to be the real caller rather than
-- whatever a client claims. AFTER, not BEFORE, so the institute row is
-- guaranteed to exist for the foreign key.
-- -----------------------------------------------------------------------------
create or replace function public.record_institute_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note  jsonb;
  v_raw   text;
  v_visit uuid := null;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  if new.status is null then
    return null;
  end if;

  v_raw := nullif(current_setting('app.status_visit', true), '');
  if v_raw is not null then
    begin
      v_note := v_raw::jsonb;
      if (v_note->>'institute')::uuid = new.id
         and v_note->>'status' = new.status then
        v_visit := (v_note->>'visit')::uuid;
      end if;
    exception when others then
      -- A malformed note is not a reason to refuse a status change. The row is
      -- still written; it simply records no visit.
      v_visit := null;
    end;
  end if;

  insert into public.institute_status_history (institute_id, status, changed_by, visit_id)
  values (new.id, new.status, (select auth.uid()), v_visit);

  return null;
end;
$$;

comment on function public.record_institute_status_change is
  'Appends one institute_status_history row per real status change, whatever '
  'path made it. Runs beside institutes_touch_status from 0001, which still '
  'maintains status_updated_at and status_updated_by.';

drop trigger if exists institutes_record_status_change on public.institutes;
create trigger institutes_record_status_change
  after insert or update of status on public.institutes
  for each row execute function public.record_institute_status_change();


-- -----------------------------------------------------------------------------
-- 5. Backfill - one row for the change we already know about
--
-- Without this, every institute in the registry shows an empty timeline on the
-- day this ships, including the ones whose status was set months ago. The
-- columns from 0001 already record the most recent change exactly:
-- status_updated_at and status_updated_by. That one change is real, so it is
-- written as the first entry rather than invented.
--
-- What this cannot recover is everything BEFORE the most recent change - those
-- values were overwritten and are gone. A backfilled timeline therefore starts
-- with one entry and grows properly from here.
--
-- Guarded by NOT EXISTS, so running this file twice adds nothing. If you would
-- rather every timeline start empty, delete this statement before running -
-- nothing else depends on it.
-- -----------------------------------------------------------------------------
insert into public.institute_status_history (institute_id, status, changed_by, changed_at, visit_id)
select i.id,
       i.status,
       i.status_updated_by,
       coalesce(i.status_updated_at, i.created_at),
       null
  from public.institutes i
 where i.status is not null
   and not exists (
     select 1 from public.institute_status_history h where h.institute_id = i.id
   );


-- -----------------------------------------------------------------------------
-- 6. Reading it back
--
-- The timeline, newest first, with the category joined from 0010's lookup
-- rather than stored on the row:
--
--   select h.changed_at,
--          h.status,
--          s.category,
--          p.name as changed_by,
--          h.visit_id
--     from public.institute_status_history h
--     join public.institute_statuses s on s.status = h.status
--     left join public.profiles p       on p.id     = h.changed_by
--    where h.institute_id = '...'
--    order by h.changed_at desc;
--
-- Note that `p.name` is subject to RLS: a rep may only read their own profile
-- row, so another member's name comes back null and the app shows "a team
-- member". That is the same behaviour as an admin-assigned plan entry.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 7. Prove the wiring is live
--
-- Both triggers and the table have to exist together: the history table with
-- no trigger silently records nothing, which is the failure that would take
-- longest to notice.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
begin
  if to_regclass('public.institute_status_history') is null then
    problems := problems || 'institute_status_history is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_record_status_change'
       and tgrelid = 'public.institutes'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the institutes_record_status_change trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'visits_note_status_visit'
       and tgrelid = 'public.visits'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'the visits_note_status_visit trigger is missing';
  end if;

  -- 0001's audit columns must still be maintained; this feature sits beside
  -- them rather than replacing them.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_touch_status'
       and tgrelid = 'public.institutes'::regclass
       and not tgisinternal
  ) then
    problems := problems || 'institutes_touch_status from 0001 has gone missing';
  end if;

  -- Append-only is a privilege fact, not just a missing policy — assert it.
  if to_regclass('public.institute_status_history') is not null then
    if not has_table_privilege('authenticated', 'public.institute_status_history', 'SELECT') then
      problems := problems || 'authenticated cannot read the history table';
    end if;
    if has_table_privilege('authenticated', 'public.institute_status_history', 'INSERT')
       or has_table_privilege('authenticated', 'public.institute_status_history', 'UPDATE')
       or has_table_privilege('authenticated', 'public.institute_status_history', 'DELETE') then
      problems := problems || 'authenticated can write to the history table; it must be append-only';
    end if;
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Status history is not correctly wired: %',
      array_to_string(problems, '; ');
  end if;

  raise notice 'Status history: table and both triggers in place; % rows backfilled so far.',
    (select count(*) from public.institute_status_history);
end $$;
