-- =============================================================================
-- KUbeats - migration 0072: an institute gets a SECOND status, for calls
--
-- PART 3, HALF ONE. STILL INERT for behaviour: it adds a column, a history
-- table and two triggers, and backfills the new column from calls that have
-- already been filed. Nothing in the app reads `institutes.call_status` until
-- 0073, and no RPC writes it until 0073 either - `institutes.status` keeps
-- meaning exactly what it means today (the Log Visit track's current status).
--
-- WHY A SECOND COLUMN RATHER THAN REUSING `institutes.status`:
--
--   `institutes.status` is written by log_visit()/close_visit() AND by
--   log_call() today. Once Call Status and Log Visit Status are independent
--   lists (0070), one column cannot honestly carry both. The visit track keeps
--   `status`; the call track gets `call_status`. `status_updated_at` /
--   `status_updated_by` stay visit-only, and this file adds the call-side trio
--   beside them rather than overloading the old pair.
--
-- WHY A HISTORY TABLE OF ITS OWN AND NOT A `source` COLUMN ON
-- institute_status_history:
--
--   0011's history table has a foreign key into institute_statuses. A call
--   status lives in call_statuses (0070), so its rows cannot be written there
--   without breaking that FK. A parallel table, mirroring 0011 column for
--   column, keeps both timelines append-only and lets the app union them.
--
--   The attribution column is `call_id` here, pointing at the follow_up_tasks
--   row that carried the call. `log_call()` (0073) leaves a transaction-local
--   note naming that call; the trigger below picks it up exactly as
--   note_status_visit()/record_institute_status_change() do for visits. An
--   admin correction (0073) names the same call id, so an edit is attributed
--   to the call it corrected.
--
-- THE BACKFILL (§3 of the approved design):
--
--   Every institute with at least one FILED call gets that call's status as
--   its current call_status, and one history row dated when the call was
--   filed. Institutes with no filed call stay NULL - "no call status yet" is
--   its own honest state, not a guess. Guarded on `call_status is null`, so a
--   re-run adds nothing and never rewinds a later change.
--
-- WHAT THIS FILE DOES NOT DO:
--
--   * It does not move follow_up_tasks_status_set_to_fk. That is 0074.
--   * It does not touch `institutes.status`, `status_updated_at` or
--     `status_updated_by`, nor the 0011 triggers on them.
--   * It does not change `institutes_cancel_follow_ups` (0048) - that trigger
--     is `update of status`, and call_status needs its own track-aware
--     treatment, which arrives with the shared body in 0073.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: every column is `add column if not exists`, every
--   constraint is guarded, and the backfill skips institutes that already
--   carry a call_status.
--
-- DOWN
--   supabase/rollbacks/0072_institutes_call_status_down.sql drops the column,
--   the history table and both triggers, and restores 0001's
--   touch_institute_status(). Refuses while 0073 still writes call_status.
-- =============================================================================

begin;


-- -----------------------------------------------------------------------------
-- 1. The column, its audit pair, and the FK into the call vocabulary
-- -----------------------------------------------------------------------------
alter table public.institutes
  add column if not exists call_status            text,
  add column if not exists call_status_updated_at timestamptz,
  add column if not exists call_status_updated_by uuid
    references public.profiles (id) on delete set null;

comment on column public.institutes.call_status is
  'The institute''s CURRENT Call Status, from public.call_statuses (0070). '
  'Independent of `status` (the Log Visit track): log_call() and the admin '
  'call-report edit write this column, never `status`. Null means no call has '
  'been filed yet.';

comment on column public.institutes.call_status_updated_at is
  'When call_status last changed. Maintained by touch_institute_status() '
  '(extended by 0072) exactly as status_updated_at is for the visit track.';

comment on column public.institutes.call_status_updated_by is
  'Who last changed call_status. See call_status_updated_at.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'institutes_call_status_fk'
  ) then
    alter table public.institutes add constraint institutes_call_status_fk
      foreign key (call_status) references public.call_statuses (status)
      on update restrict on delete restrict;
  end if;
end $$;

create index if not exists institutes_call_status_fk_idx
  on public.institutes (call_status) where call_status is not null;


-- -----------------------------------------------------------------------------
-- 2. touch_institute_status() learns about call_status
--
-- 0001's function, verbatim for the visit half, plus a second branch. The two
-- tracks are deliberately independent: changing call_status does NOT stamp
-- status_updated_at/by, and changing status does NOT stamp the call pair.
--
-- The call branch honours a transaction-local note (app.call_status_note) so
-- the 0072 backfill - and log_call() in 0073 - can date the change to the
-- moment the call was filed rather than to the moment this trigger ran. With
-- no note, or a note naming a different institute/status, it uses now() and
-- the caller, exactly as the visit half does.
-- -----------------------------------------------------------------------------
create or replace function public.touch_institute_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status is not null then
      new.status_updated_at := coalesce(new.status_updated_at, now());
      new.status_updated_by := coalesce(new.status_updated_by, (select auth.uid()));
    end if;
    if new.call_status is not null then
      new.call_status_updated_at := coalesce(new.call_status_updated_at, now());
      new.call_status_updated_by := coalesce(new.call_status_updated_by, (select auth.uid()));
    end if;
  else
    if new.status is distinct from old.status then
      new.status_updated_at := now();
      new.status_updated_by := (select auth.uid());
    end if;

    if new.call_status is distinct from old.call_status then
      v_note := public.call_status_note_for(new.id, new.call_status);
      if v_note is not null then
        begin
          new.call_status_updated_at := coalesce(
            (v_note->>'at')::timestamptz, now());
          new.call_status_updated_by := coalesce(
            (v_note->>'by')::uuid, (select auth.uid()));
        exception when others then
          new.call_status_updated_at := now();
          new.call_status_updated_by := (select auth.uid());
        end;
      else
        new.call_status_updated_at := now();
        new.call_status_updated_by := (select auth.uid());
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.touch_institute_status() is
  'Stamps the audit pair for whichever status actually moved - '
  'status_updated_at/by for the visit track (0001), call_status_updated_at/by '
  'for the call track (0072). The two never share a pair.';


-- -----------------------------------------------------------------------------
-- 3. The note the call-side history trigger reads
--
-- Same mechanism as note_status_visit() (0011), but set by the RPC itself
-- rather than by a trigger on follow_up_tasks: log_call() UPDATES the call row
-- rather than inserting it, and the 0072 backfill is not an RPC at all. The
-- note is transaction-local and is only honoured when both the institute and
-- the status it names still match the row being written, so a transaction that
-- touches two institutes cannot mis-attribute a change.
--
-- Internal: no grant. Both callers are SECURITY DEFINER triggers owned by the
-- table owner, which holds EXECUTE by default.
-- -----------------------------------------------------------------------------
create or replace function public.call_status_note_for(p_institute uuid, p_status text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw  text;
  v_note jsonb;
begin
  v_raw := nullif(current_setting('app.call_status_note', true), '');
  if v_raw is null or p_status is null then
    return null;
  end if;

  begin
    v_note := v_raw::jsonb;
    if (v_note->>'institute')::uuid = p_institute
       and v_note->>'status' = p_status then
      return v_note;
    end if;
  exception when others then
    -- A malformed note is not a reason to refuse a status change; the row is
    -- still written, it simply records no call and uses now()/the caller.
    return null;
  end;

  return null;
end;
$$;

comment on function public.call_status_note_for(uuid, text) is
  'Returns the transaction-local call-status note ONLY when it names this '
  'institute and this status; otherwise null. Used by the call-side touch and '
  'history triggers (0072) so a call can be attributed without a trigger on '
  'follow_up_tasks.';

revoke all on function public.call_status_note_for(uuid, text) from public;
revoke all on function public.call_status_note_for(uuid, text) from anon;
revoke all on function public.call_status_note_for(uuid, text) from authenticated;


-- -----------------------------------------------------------------------------
-- 4. institute_call_status_history - 0011's table, for the call track
-- -----------------------------------------------------------------------------
create table if not exists public.institute_call_status_history (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null
               references public.institutes (id) on delete cascade,
  status       text not null
               references public.call_statuses (status),
  changed_by   uuid references public.profiles (id) on delete set null,
  changed_at   timestamptz not null default now(),
  -- The call whose status_set_to caused this, when one did. Null for the
  -- backfill only when it could not be attributed - it always can here, so in
  -- practice null means a future non-call writer. ON DELETE SET NULL for the
  -- same reason 0011 uses it for visit_id: deleting the call must not erase
  -- the record that the institute moved.
  call_id      uuid references public.follow_up_tasks (id) on delete set null
);

comment on table public.institute_call_status_history is
  'Append-only record of every change to institutes.call_status. The call-side '
  'twin of institute_status_history (0011), written by '
  'institutes_record_call_status_change (0072), never by the application.';

comment on column public.institute_call_status_history.status is
  'The CALL status the institute was set TO. Resolves against '
  'public.call_statuses, not institute_statuses.';

comment on column public.institute_call_status_history.call_id is
  'The follow-up call that caused the change. Null only when the writing path '
  'named no call.';

create index if not exists institute_call_status_history_institute_idx
  on public.institute_call_status_history (institute_id, changed_at desc);

create index if not exists institute_call_status_history_call_idx
  on public.institute_call_status_history (call_id)
  where call_id is not null;

alter table public.institute_call_status_history enable row level security;

revoke all on public.institute_call_status_history from authenticated;
revoke all on public.institute_call_status_history from anon;
grant select on public.institute_call_status_history to authenticated;

drop policy if exists institute_call_status_history_select on public.institute_call_status_history;
create policy institute_call_status_history_select on public.institute_call_status_history
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- 5. The trigger that appends a row
--
-- SECURITY DEFINER for the same two reasons 0011 gives: it writes a table
-- nobody holds INSERT on, and changed_by must be the real caller rather than
-- whatever a client claims. AFTER, not BEFORE, so the institute row exists for
-- the FK.
-- -----------------------------------------------------------------------------
create or replace function public.record_institute_call_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note jsonb;
  v_call uuid := null;
  v_at   timestamptz := now();
  v_by   uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and new.call_status is not distinct from old.call_status then
    return null;
  end if;

  if new.call_status is null then
    return null;
  end if;

  v_note := public.call_status_note_for(new.id, new.call_status);
  if v_note is not null then
    begin
      v_call := (v_note->>'call')::uuid;
    exception when others then
      v_call := null;
    end;
    begin
      v_at := coalesce((v_note->>'at')::timestamptz, v_at);
      v_by := coalesce((v_note->>'by')::uuid, v_by);
    exception when others then
      null;
    end;
  end if;

  insert into public.institute_call_status_history
    (institute_id, status, changed_by, changed_at, call_id)
  values
    (new.id, new.call_status, v_by, v_at, v_call);

  return null;
end;
$$;

comment on function public.record_institute_call_status_change is
  'Appends one institute_call_status_history row per real call_status change, '
  'whatever path made it. Runs beside touch_institute_status() (0072), which '
  'maintains call_status_updated_at/by.';

drop trigger if exists institutes_record_call_status_change on public.institutes;
create trigger institutes_record_call_status_change
  after insert or update of call_status on public.institutes
  for each row execute function public.record_institute_call_status_change();


-- -----------------------------------------------------------------------------
-- 6. The backfill - each institute's most recent filed call
--
-- "Filed" is `reported_at is not null`, the same definition call_activity_report
-- (0064) and the audit view (0057) use. Ties on reported_at break on id, so the
-- result is deterministic.
--
-- The loop, rather than one INSERT...SELECT, exists only to leave the note the
-- two triggers above read: without it every backfilled row would be stamped at
-- migration time by a null actor, instead of at the call's own timestamp by the
-- rep who filed it.
--
-- Guarded on `i.call_status is null`, so re-running adds nothing and never
-- rewinds a change made after this file first ran.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select distinct on (f.institute_id)
           f.institute_id, f.status_set_to, f.reported_at, f.member, f.id
      from public.follow_up_tasks f
      join public.institutes i on i.id = f.institute_id
     where f.kind = 'call'
       and f.status_set_to is not null
       and f.reported_at is not null
       and i.call_status is null
     order by f.institute_id, f.reported_at desc, f.id desc
  loop
    perform set_config(
      'app.call_status_note',
      jsonb_build_object(
        'institute', r.institute_id,
        'status',    r.status_set_to,
        'call',      r.id,
        'at',        r.reported_at,
        'by',        r.member
      )::text,
      true
    );

    update public.institutes
       set call_status            = r.status_set_to,
           call_status_updated_at = r.reported_at,
           call_status_updated_by = r.member
     where id = r.institute_id
       and call_status is null;
  end loop;

  perform set_config('app.call_status_note', '', true);
end $$;


-- -----------------------------------------------------------------------------
-- 7. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  n        integer;
  body     text;
begin
  -- 7a. The columns, in parity with the visit pair.
  foreach c in array array[
    'call_status', 'call_status_updated_at', 'call_status_updated_by'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'institutes'
         and column_name = c
    ) then
      problems := array_append(problems, format('institutes.%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conname = 'institutes_call_status_fk'
       and conrelid = 'public.institutes'::regclass
       and confrelid = 'public.call_statuses'::regclass
       and confupdtype = 'r'
       and confdeltype = 'r'
  ) then
    problems := array_append(problems,
      'institutes.call_status has no restrict-on-update/restrict-on-delete FK to call_statuses');
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'institutes'
       and indexname = 'institutes_call_status_fk_idx'
  ) then
    problems := array_append(problems, 'institutes_call_status_fk_idx is missing');
  end if;

  -- 7b. The history table, mirroring 0011.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'institute_call_status_history'
  ) then
    problems := array_append(problems, 'institute_call_status_history is missing');
  else
    foreach c in array array['id', 'institute_id', 'status', 'changed_by', 'changed_at', 'call_id'] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'institute_call_status_history'
           and column_name = c
      ) then
        problems := array_append(problems,
          format('institute_call_status_history.%s is missing', c));
      end if;
    end loop;

    if not (
      select relrowsecurity from pg_class
       where oid = 'public.institute_call_status_history'::regclass
    ) then
      problems := array_append(problems,
        'row level security is NOT enabled on institute_call_status_history');
    end if;

    if has_table_privilege(
         'authenticated', 'public.institute_call_status_history', 'INSERT')
       or has_table_privilege(
         'authenticated', 'public.institute_call_status_history', 'UPDATE')
       or has_table_privilege(
         'authenticated', 'public.institute_call_status_history', 'DELETE') then
      problems := array_append(problems,
        'authenticated can write to institute_call_status_history; it must be append-only');
    end if;

    if not exists (
      select 1 from pg_policy
       where polname = 'institute_call_status_history_select'
         and polrelid = 'public.institute_call_status_history'::regclass
         and pg_get_expr(polqual, polrelid) = 'true'
    ) then
      problems := array_append(problems,
        'institute_call_status_history_select is missing or not using(true)');
    end if;

    -- The status FK must resolve against the CALL vocabulary.
    if not exists (
      select 1 from pg_constraint
       where conname = 'institute_call_status_history_status_fkey'
         and conrelid = 'public.institute_call_status_history'::regclass
         and confrelid = 'public.call_statuses'::regclass
    ) then
      problems := array_append(problems,
        'institute_call_status_history.status does not reference call_statuses');
    end if;
  end if;

  -- 7c. The trigger is attached, and the visit-side ones are untouched.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_record_call_status_change'
       and tgrelid = 'public.institutes'::regclass
       and not tgisinternal
  ) then
    problems := array_append(problems,
      'the institutes_record_call_status_change trigger is missing');
  end if;

  foreach c in array array['institutes_touch_status', 'institutes_record_status_change'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = c and tgrelid = 'public.institutes'::regclass and not tgisinternal
    ) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'touch_institute_status';

  if body is null then
    problems := array_append(problems, 'touch_institute_status() is missing');
  else
    if position('call_status_updated_at' in body) = 0 then
      problems := array_append(problems,
        'touch_institute_status() does not maintain call_status_updated_at');
    end if;
    if position('status_updated_at' in body) = 0 then
      problems := array_append(problems,
        'touch_institute_status() no longer maintains status_updated_at');
    end if;
  end if;

  -- 7d. The backfill covered every institute that has a filed call.
  select count(*) into n
    from public.institutes i
   where i.call_status is null
     and exists (
       select 1 from public.follow_up_tasks f
        where f.institute_id = i.id and f.kind = 'call'
          and f.status_set_to is not null and f.reported_at is not null
     );
  if n <> 0 then
    problems := array_append(problems, format(
      '%s institute(s) with a filed call still have no call_status', n));
  end if;

  -- Every history row resolves in the call vocabulary, and every row's
  -- institute exists (the FK proves the latter; this catches a bad backfill).
  select count(*) into n
    from public.institute_call_status_history h
   where not exists (
     select 1 from public.call_statuses s where s.status = h.status
   );
  if n <> 0 then
    problems := array_append(problems, format(
      '%s call-status history row(s) name a status that is not in call_statuses', n));
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0072 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0072 applied: institutes.call_status (+ audit pair) added; % institute(s) '
    'backfilled from their most recent filed call; % history row(s) written; '
    'visit-track status columns and triggers untouched.',
    (select count(*) from public.institutes where call_status is not null),
    (select count(*) from public.institute_call_status_history);
end $$;

commit;


-- =============================================================================
-- Afterwards
--
--   -- parity of the two tracks right after apply
--   select count(*) filter (where status is not null)      visit_status,
--          count(*) filter (where call_status is not null) call_status
--     from public.institutes;
--
--   -- the backfilled timeline for one institute
--   select h.changed_at, h.status, s.category, p.name as changed_by, h.call_id
--     from public.institute_call_status_history h
--     left join public.call_statuses s on s.status = h.status
--     left join public.profiles p      on p.id     = h.changed_by
--    where h.institute_id = '<id>'
--    order by h.changed_at desc;
-- =============================================================================
