-- Port the existing saved-call representation from deploy-iq6-client.
-- No duplicate reports or visits: the original follow_up_tasks row is updated.
begin;
-- =============================================================================
-- KUbeats - migration 0052: a follow-up call is logged like a visit
--
-- ADDITIVE AND SAFE TO APPLY AT ANY TIME. Nothing in the live app calls
-- log_call() yet - the UI for it is Phase 2, not this file - so every new
-- column stays null on every existing row and nothing already shipped reads
-- any of them.
--
-- THE SHAPE, IN ONE SENTENCE. A call gets the same admin-managed institute
-- status, the same status-driven fields (expected date, follow-up date, the
-- closing report's notes/students/session detail) and the same Next Action as
-- a normal Log Visit + closing report - but it is never a `visits` row and
-- never a `daily_plans` row, because it has no arrival, no photograph and no
-- check-out for either of those tables to mean anything about.
--
-- WHY THIS IS ONE NEW RPC AND NOT TWO EXISTING ONES WIDENED. `log_visit()` and
-- `close_visit()` both key their writes to a `visits` row that a call will
-- never have. `follow_up_tasks` is the call's only row, so one function reads
-- the task, writes everything onto it, and inserts the next task when there is
-- one - in a single transaction, for the reason CLAUDE.md gives close_visit():
-- "a check-out is not a thing you want half of."
--
-- outcome IS UNCHANGED. It stays the narrow 'done' / 'no_answer' / 'rescheduled'
-- vocabulary from 0038. log_call() always closes with outcome = 'done' - the
-- institute-status ANSWER lives on the new status_set_to column instead, which
-- is the whole point of this file. See the Phase 1 investigation this follows:
-- widening outcome itself was considered and rejected.
--
-- SECURITY INVOKER, same reasoning as log_visit() and close_visit(): RLS and
-- FO031 must apply inside this function exactly as they do to a direct insert,
-- or campus scoping and rep-ownership would have a hole punched through them.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: every column is `add column if not exists`, every
--   constraint is guarded by its own existence check, and the function is a
--   plain create-or-replace of a signature nothing else has ever used.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The columns a call now carries
--
-- ALL NINE NULLABLE. Every row already in the table predates this file and
-- must stay legal and readable; the same reasoning 0027 gives for
-- status_set_to being a trigger rather than a NOT NULL applies here to the
-- whole set.
-- -----------------------------------------------------------------------------
alter table public.follow_up_tasks
  add column if not exists status_set_to     text,
  add column if not exists expected_date     date,
  add column if not exists follow_up_date    date,
  add column if not exists students_attended integer,
  add column if not exists session_topic     text,
  add column if not exists session_taken_by  text,
  add column if not exists call_notes        text,
  add column if not exists next_action       text,
  add column if not exists reported_at       timestamptz;

comment on column public.follow_up_tasks.status_set_to is
  'Same vocabulary as institutes.status and visits.status_set_to (0026): a '
  'foreign key to public.institute_statuses, not a CHECK, so an admin-added '
  'status is legal here with no migration. Null until log_call() runs.';

comment on column public.follow_up_tasks.call_notes is
  'The closing report''s one free-text box, for a call. A SEPARATE column from '
  'the existing `note` (the task''s own 300-char reminder, written when the '
  'task was created) - the two answer different questions and one call''s row '
  'legitimately carries both.';

comment on column public.follow_up_tasks.next_action is
  'What the rep said they would do next, mirroring visits.next_action (0038): '
  'call, meeting, or nothing. The matching NEW follow_up_tasks row log_call() '
  'inserts is what is actually acted on; this is the answer as recorded on the '
  'task that was closed.';

comment on column public.follow_up_tasks.reported_at is
  'Stamped by log_call() the same moment done_at is. Kept as its own column, '
  'mirroring visits.reported_at, rather than reusing done_at for both meanings '
  '- a future caller that closes a task without filing a full report (the way '
  'closeFollowUpTask() already does for meetings) sets done_at alone.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'follow_up_tasks_status_set_to_fk'
  ) then
    alter table public.follow_up_tasks
      add constraint follow_up_tasks_status_set_to_fk
      foreign key (status_set_to) references public.institute_statuses (status)
      on update restrict on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'follow_up_tasks_students_attended_valid'
  ) then
    alter table public.follow_up_tasks
      add constraint follow_up_tasks_students_attended_valid
      check (students_attended is null or students_attended >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'follow_up_tasks_call_notes_length'
  ) then
    alter table public.follow_up_tasks
      add constraint follow_up_tasks_call_notes_length
      check (call_notes is null or length(call_notes) <= 2000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'follow_up_tasks_next_action_valid'
  ) then
    alter table public.follow_up_tasks
      add constraint follow_up_tasks_next_action_valid
      check (next_action is null or next_action in ('call', 'meeting'));
  end if;
end $$;

-- Same reasoning as institutes_status_fk_idx / visits_status_set_to_idx
-- (0026): the FK checks a value on the way in, this makes the reverse lookup
-- cheap.
create index if not exists follow_up_tasks_status_set_to_idx
  on public.follow_up_tasks (status_set_to) where status_set_to is not null;


-- -----------------------------------------------------------------------------
-- 2. log_call() - one task, closed like a visit
--
-- p_task_id has no default and must be first; every other parameter is
-- defaulted, matching the shape p_status_set_to onward would need if a second
-- parameter is ever appended after this file.
--
-- READS THE STATUS'S OWN FLAGS BY HAND. There is no trigger on follow_up_tasks
-- for any of expected_date, notes, students_attended, session_topic or
-- session_taken_by - on `visits` those live in the app's Zod layer
-- (eventDateRequired, notesRequired, makeReportSchema), which does not exist
-- for this flow yet. So this function asks institute_statuses the same four
-- questions those helpers ask the catalogue, and is - for this phase - the
-- ONLY place any of them is enforced.
--
-- THE SAME PRECEDENT LOG_VISIT SETS: an unrecognised status is not
-- pre-validated here. It is left for follow_up_tasks_status_set_to_fk to
-- refuse at the UPDATE below, exactly as visits_status_set_to_fk is the
-- backstop log_visit() relies on rather than checking itself.
-- -----------------------------------------------------------------------------
create or replace function public.log_call(
  p_task_id           uuid,
  p_status_set_to     text    default null,
  p_expected_date     date    default null,
  p_follow_up_date    date    default null,
  p_notes             text    default null,
  p_students_attended integer default null,
  p_session_topic     text    default null,
  p_session_taken_by  text    default null,
  p_next_action       text    default null,
  p_follow_up_note    text    default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member          uuid := (select auth.uid());
  v_task            public.follow_up_tasks%rowtype;
  v_category        text;
  v_asks_expected   boolean;
  v_asks_session    boolean;
  v_asks_head_count boolean;
  v_needs_notes     boolean;
begin
  if not public.is_rep() then
    raise exception 'Only a Rep can log a call.' using errcode='42501';
  end if;

  if v_member is null then
    raise exception 'You must be signed in to log this call.'
      using errcode = 'FO004';
  end if;

  -- Only the caller's own open call - never a colleague's, never a meeting
  -- task, and never one already closed. RLS (supervises()) would let a team
  -- lead reach a rep's row too; this is narrower on purpose, matching
  -- logFollowUpCallOutcome()'s existing `.eq("member", user.id)`.
  select * into v_task
    from public.follow_up_tasks
   where id = p_task_id
     and member = v_member
     and kind = 'call'
   for update;

  if not found then
    raise exception 'That call could not be found, or it is not yours to log.'
      using errcode = 'FO038';
  end if;

  if v_task.done_at is not null then
    raise exception 'That call has already been logged.'
      using errcode = 'FO039';
  end if;

  -- Rule 4, same as log_visit(): a status is compulsory.
  if p_status_set_to is null then
    raise exception 'Say where this call leaves the institute before saving it.'
      using errcode = 'FO024';
  end if;

  select s.category, s.asks_expected_date, s.asks_session_detail, s.asks_head_count
    into v_category, v_asks_expected, v_asks_session, v_asks_head_count
    from public.institute_statuses s
   where s.status = p_status_set_to;

  if v_category = 'closed' and p_next_action is not null then
    raise exception 'A closed status does not take a next action.' using errcode='22023';
  end if;

  -- Rule 3's date, asked of the status exactly as eventDateRequired() asks it.
  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  -- Rule 5, mirroring enforce_follow_up_when_open() (FO016) plus visitSchema's
  -- extension of it to a chosen next action - asked by hand, because that
  -- trigger lives on visits and a call is never one.
  if (public.institute_status_is_open(p_status_set_to) or p_next_action is not null)
     and p_follow_up_date is null then
    raise exception '%',
      case when p_next_action is not null
             then 'Say when this follow-up is due.'
           else 'That status leaves the institute open, so a follow-up date is needed.'
      end
      using errcode = 'FO016';
  end if;

  -- The closing report's own rules, asked exactly as makeReportSchema() asks
  -- them. An unrecognised status (v_category null) excuses notes, matching
  -- notesRequired()'s "no row means not required" - the FK above is what
  -- actually refuses the status itself, moments from now.
  v_needs_notes := v_category is not null and (
    v_category <> 'closed'
    or coalesce(v_asks_expected, false)
    or coalesce(v_asks_session, false)
    or coalesce(v_asks_head_count, false)
  );

  if v_needs_notes and (p_notes is null or btrim(p_notes) = '') then
    raise exception 'Add a note before saving this call.' using errcode = 'FO041';
  end if;

  if coalesce(v_asks_head_count, false) and p_students_attended is null then
    raise exception 'Enter the number of students.' using errcode = 'FO042';
  end if;

  if coalesce(v_asks_session, false)
     and (p_session_topic is null or btrim(p_session_topic) = '') then
    raise exception 'Enter the topic title.' using errcode = 'FO043';
  end if;

  if coalesce(v_asks_session, false)
     and (p_session_taken_by is null or btrim(p_session_taken_by) = '') then
    raise exception 'Enter who took it.' using errcode = 'FO044';
  end if;

  update public.follow_up_tasks
     set status_set_to     = p_status_set_to,
         expected_date     = p_expected_date,
         follow_up_date    = p_follow_up_date,
         students_attended = p_students_attended,
         session_topic     = p_session_topic,
         session_taken_by  = p_session_taken_by,
         call_notes        = p_notes,
         next_action       = p_next_action,
         outcome           = 'done',
         done_at           = now(),
         reported_at       = now()
   where id = p_task_id;

  -- Rule 4 — status is set by hand, same as log_visit(); institutes_touch_status
  -- stamps who changed it and when.
  if p_status_set_to is not null then
    update public.institutes
       set status = p_status_set_to
     where id = v_task.institute_id;

    if not found then
      raise exception 'That institute no longer exists.' using errcode = 'FO006';
    end if;
  end if;

  -- A3 — the next task, in the same transaction as the close, same reasoning
  -- close_visit() gives for its own follow-up insert. NEVER daily_plans, and
  -- from_visit_id is always null: a call has no visit behind it to point at.
  -- SECURITY INVOKER means FO031 applies to this insert exactly as it does to
  -- close_visit()'s.
  if p_next_action is not null then
    insert into public.follow_up_tasks (
      member, institute_id, kind, due_date, note, from_visit_id
    ) values (
      v_member, v_task.institute_id, p_next_action, p_follow_up_date, p_follow_up_note, null
    );
  end if;
end;
$$;

comment on function public.log_call is
  'Closes a follow-up call like a visit: the same admin-managed status, the '
  'same status-driven expected date / follow-up date / closing-report fields, '
  'and the same Next Action - with no photo, no check-in and never a visits or '
  'daily_plans row. SECURITY INVOKER, so RLS and FO031 apply inside. Raises '
  'FO004, FO006, FO016, FO024, FO038-FO044.';

revoke all on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) from public;
revoke all on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) from anon;
grant execute on function public.log_call(
  uuid, text, date, date, text, integer, text, text, text, text
) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with
-- a bare literal fails with 22P02 exactly when a check has something to
-- report. search_path is asked with LIKE 'search_path=%' against proconfig,
-- never array containment - see 0047 for why `@>` gives a false alarm here.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  n        integer;
  args     text;
  body     text;
begin
  -- 3a. The columns.
  foreach c in array array[
    'status_set_to', 'expected_date', 'follow_up_date', 'students_attended',
    'session_topic', 'session_taken_by', 'call_notes', 'next_action', 'reported_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'follow_up_tasks'
         and column_name = c
    ) then
      problems := array_append(problems, format('follow_up_tasks.%s is missing', c));
    elsif (
      select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'follow_up_tasks'
         and column_name = c
    ) <> 'YES' then
      problems := array_append(
        problems,
        format('follow_up_tasks.%s is NOT NULL - every existing row would have failed this migration', c));
    end if;
  end loop;

  -- 3b. The constraints and the index.
  foreach c in array array[
    'follow_up_tasks_status_set_to_fk', 'follow_up_tasks_students_attended_valid',
    'follow_up_tasks_call_notes_length', 'follow_up_tasks_next_action_valid'
  ] loop
    if not exists (select 1 from pg_constraint where conname = c) then
      problems := array_append(problems, format('%s is missing', c));
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'follow_up_tasks'
       and indexname = 'follow_up_tasks_status_set_to_idx'
  ) then
    problems := array_append(problems, 'follow_up_tasks_status_set_to_idx is missing');
  end if;

  -- 3c. log_call() itself: exactly one, INVOKER, search_path pinned, the
  -- right signature, the right grants, and the FO codes still in the body.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'log_call';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 log_call, found %s - a second overload would make every call ambiguous', n));
  else
    if (select p.prosecdef
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'log_call') then
      problems := array_append(
        problems, 'log_call() is SECURITY DEFINER - RLS and FO031 would stop applying inside it');
    end if;

    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public' and p.proname = 'log_call'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(problems, 'log_call() does not pin search_path');
    end if;

    select pg_get_function_identity_arguments(p.oid) into args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'log_call';

    if args is distinct from
      'p_task_id uuid, p_status_set_to text, p_expected_date date, p_follow_up_date date, '
      'p_notes text, p_students_attended integer, p_session_topic text, p_session_taken_by text, '
      'p_next_action text, p_follow_up_note text'
    then
      problems := array_append(problems, format('log_call() signature changed to "%s"', args));
    end if;

    select regexp_replace(
             regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
             '--[^' || chr(10) || ']*', '', 'g')
      into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'log_call';

    foreach c in array array[
      'FO004', 'FO006', 'FO016', 'FO024', 'FO038', 'FO039', 'FO040', 'FO041', 'FO042', 'FO043', 'FO044'
    ] loop
      if body is null or position(c in body) = 0 then
        problems := array_append(problems, format('log_call() no longer raises %s', c));
      end if;
    end loop;

    if body is null or position('from_visit_id' in body) = 0 then
      problems := array_append(problems, 'log_call() no longer inserts the next follow_up_tasks row');
    end if;

    if body is null or position('daily_plans' in body) > 0 then
      problems := array_append(problems, 'log_call() mentions daily_plans - a call must never touch it');
    end if;
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.log_call(uuid, text, date, date, text, integer, text, text, text, text)',
    'execute'
  ) then
    problems := array_append(problems, 'authenticated may not execute log_call()');
  end if;

  if has_function_privilege(
    'anon',
    'public.log_call(uuid, text, date, date, text, integer, text, text, text, text)',
    'execute'
  ) then
    problems := array_append(problems, 'anon may execute log_call()');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0052 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0052 applied: follow_up_tasks carries status_set_to and the closing-report '
    'fields, and log_call() closes a call the same way log_visit() + close_visit() '
    'close a visit.';
end $$;

commit;
