-- =============================================================================
-- KUbeats - migration 0063: an admin may correct a filed Call Report
--
-- NET-NEW, ADMIN ONLY. Nothing here touches `visits`, `log_visit()`, or
-- `close_visit()` - Visit Report behaviour is unchanged. A rep and a team
-- lead gain nothing from this file; `log_call()` (0052) is untouched, so a
-- rep still files a call exactly as they do today.
--
-- WHAT THIS ADDS
--
--   1. public.call_report_edits - an append-only audit row per admin edit,
--      one row per field changed-or-not (old AND new, so "what did this
--      actually change" never has to be reconstructed from a diff).
--   2. public.admin_update_call_report() - the one RPC. SECURITY INVOKER,
--      with is_admin() as its own first statement (stricter than RLS: RLS
--      already lets a team lead reach their rep's follow_up_tasks row
--      since 0042's supervises() rewrite, but this function is not that
--      door - it is its own, admin-only).
--
-- THE RULE THIS FILE MIRRORS, STATED ONCE
--
-- log_call() (0046/0052) does two things to the wider world when a call is
-- filed: it writes `institutes.status` (which fires 0011's history trigger
-- and 0048's cancel_upcoming_follow_ups() exactly as a visit would), and a
-- closed status takes no next_action and starts no new follow-up. An admin
-- CORRECTING a call after the fact should move the same levers, but only
-- when correcting it is still the right thing to do to the institute:
--
--   * IF THIS CALL IS THE INSTITUTE'S MOST RECENT STATUS-SETTING EVENT
--     (no visit and no other call reported any later), the edited status is
--     applied to `institutes.status` too - same trigger cascade as filing
--     a call fresh: institute_status_history gets a row (changed_by the
--     admin, visit_id null - a direct update, exactly as 0011 already
--     documents for any non-visit path), status_updated_by/_at move, and
--     cancel_upcoming_follow_ups() fires if the new status cancels (Not
--     Interested's own behaviour, unchanged).
--   * OTHERWISE a later event has already decided what the institute is
--     doing now, and overwriting it with a correction to older history
--     would be the institute visibly going BACKWARDS. Only the call row
--     itself moves.
--
--   A CLOSED new status clears `next_action` (0048's rule for a visit,
--   `log_call()`'s inline rule for a filed call - same outcome, enforced
--   here by hand since `enforce_closed_visit_has_no_next_action` is a
--   `visits`-only trigger and a call is never a visits row). This function
--   never inserts a new follow_up_tasks row under any status - an edit is a
--   correction, not a second filing, so "creates no new follow-up" holds
--   for every status, open or closed, not only the closed ones.
--
-- WHAT IS DELIBERATELY NOT RE-VALIDATED
--
--   FO041/FO042/FO043/FO044 (notes required / head count / session topic /
--   taken by) are `log_call()`'s rules for a FRESH filing, and they ask
--   about `session_topic`, `session_taken_by` and `students_attended` -
--   none of which this function's caller can even see, because none of
--   them is an editable field here. Re-asking FO041 against a possibly
--   unrelated status would make some corrections impossible to save
--   through the one form this ships with. The five fields this function
--   DOES touch keep the validation that already applies to them:
--   `p_status_set_to` must exist (the same FK `log_call()` already relies
--   on as its backstop), the follow-up date is required when the new
--   status is open (FO016, the same rule, the same code), the expected
--   date is required when the status asks for one (FO040, likewise), and
--   `outcome`'s four-value vocabulary is the existing
--   `follow_up_tasks_outcome_valid` CHECK.
--
-- NEW ERROR CODES: FO045 (not an admin) and FO046 (no such filed call).
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file
--   -> Run. Idempotent: safe to run twice.
--
-- DOWN
--   supabase/rollbacks/0063_admin_call_report_edit_down.sql drops both the
--   function and the table. Nothing in 0062 or earlier depends on either.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. call_report_edits - append-only, admin-readable, one row per edit
--
-- NO CASCADING FK, on purpose - the same call institute_reassignment_history
-- (0058) makes about its own audit trail: a later deletion of the call or the
-- admin must not take the record that an edit happened with it. Nothing in
-- this app deletes a follow_up_tasks row today, so the default NO ACTION
-- is simply the honest answer rather than a hypothetical one.
-- -----------------------------------------------------------------------------
create table if not exists public.call_report_edits (
  id                 uuid primary key default gen_random_uuid(),
  call_id            uuid not null references public.follow_up_tasks (id),
  edited_by          uuid references public.profiles (id) on delete set null,
  edited_at          timestamptz not null default now(),
  old_status_set_to  text,
  new_status_set_to  text,
  old_follow_up_date date,
  new_follow_up_date date,
  old_expected_date  date,
  new_expected_date  date,
  old_outcome        text,
  new_outcome        text,
  old_call_notes     text,
  new_call_notes     text
);

comment on table public.call_report_edits is
  'Append-only: one row per admin_update_call_report() call, old and new value '
  'for every field it can touch. Written only by that function.';

create index if not exists call_report_edits_call_idx
  on public.call_report_edits (call_id, edited_at desc);

alter table public.call_report_edits enable row level security;

revoke all on public.call_report_edits from public;
revoke all on public.call_report_edits from anon;
revoke all on public.call_report_edits from authenticated;
grant select, insert on public.call_report_edits to authenticated;

-- SELECT: admin-only, matching reassignment_admin_read (0058) - this is an
-- audit trail, not anyone's data to browse.
drop policy if exists call_report_edits_admin_read on public.call_report_edits;
create policy call_report_edits_admin_read on public.call_report_edits
  for select to authenticated
  using (public.is_admin());

-- INSERT: admin-only too, and load-bearing - admin_update_call_report() is
-- SECURITY INVOKER, so its own insert into this table passes through this
-- policy as the calling admin. Without it the function's audit write would
-- be refused by RLS and the whole edit would roll back.
drop policy if exists call_report_edits_admin_insert on public.call_report_edits;
create policy call_report_edits_admin_insert on public.call_report_edits
  for insert to authenticated
  with check (public.is_admin());

-- Append-only: no UPDATE or DELETE policy at all, and the statement-level
-- trigger below refuses both outright - the same double lock
-- institute_reassignment_history (0058) uses, kept for the same reason: an
-- absent policy is "no door"; this is "a door that raises if anyone tries it".
create or replace function public.reject_call_report_edit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Call report edit history is append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_call_report_edit_mutation() from public, anon, authenticated;

drop trigger if exists call_report_edits_immutable on public.call_report_edits;
create trigger call_report_edits_immutable
  before update or delete or truncate
  on public.call_report_edits
  for each statement
  execute function public.reject_call_report_edit_mutation();


-- -----------------------------------------------------------------------------
-- 2. admin_update_call_report() - the one RPC
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_call_report(
  p_task_id        uuid,
  p_status_set_to  text default null,
  p_follow_up_date date default null,
  p_expected_date  date default null,
  p_outcome        text default null,
  p_notes          text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caller          uuid := (select auth.uid());
  v_task            public.follow_up_tasks%rowtype;
  v_asks_expected   boolean;
  v_is_open         boolean;
  v_has_later_event boolean;
begin
  -- ⚠ STRICTER THAN RLS, DELIBERATELY. follow_up_tasks_update already lets a
  -- team lead reach their own rep's row (0042's supervises() rewrite) - this
  -- function is a SEPARATE, narrower door that the client asked be admin-only.
  if not public.is_admin() then
    raise exception 'Only an admin can edit a Call Report.' using errcode = 'FO045';
  end if;

  if p_task_id is null then
    raise exception 'No call report was named.' using errcode = 'FO046';
  end if;

  -- Only an already-filed call - never an open task, never a meeting. RLS
  -- would already narrow an admin to every row (is_admin() in
  -- follow_up_tasks_select), so this WHERE is the business rule, not the
  -- security boundary.
  select * into v_task
    from public.follow_up_tasks
   where id = p_task_id
     and kind = 'call'
     and reported_at is not null
   for update;

  if not found then
    raise exception 'That Call Report could not be found.' using errcode = 'FO046';
  end if;

  -- Rule 4, same as log_call(): a status is compulsory.
  if p_status_set_to is null then
    raise exception 'Choose a status before saving.' using errcode = 'FO024';
  end if;

  select s.asks_expected_date into v_asks_expected
    from public.institute_statuses s
   where s.status = p_status_set_to;
  v_is_open := public.institute_status_is_open(p_status_set_to);

  -- Rule 3's date, exactly as log_call() asks it (FO040). An unrecognised
  -- status leaves v_asks_expected null, which coalesce() reads as "no" - the
  -- FK below is what actually refuses the status itself.
  if coalesce(v_asks_expected, false) and p_expected_date is null then
    raise exception '"%" needs an expected date.', p_status_set_to
      using errcode = 'FO040';
  end if;

  -- Rule 5, exactly as log_call() asks it (FO016) - minus the `next_action`
  -- half, because this function never takes one as a parameter.
  if v_is_open and p_follow_up_date is null then
    raise exception 'That status leaves the institute open, so a follow-up date is needed.'
      using errcode = 'FO016';
  end if;

  -- The audit row, BEFORE the mutation: if this insert is refused (RLS, a
  -- length CHECK on a future column, anything) nothing else has moved yet.
  insert into public.call_report_edits (
    call_id, edited_by,
    old_status_set_to,  new_status_set_to,
    old_follow_up_date,  new_follow_up_date,
    old_expected_date,  new_expected_date,
    old_outcome,         new_outcome,
    old_call_notes,      new_call_notes
  ) values (
    p_task_id, v_caller,
    v_task.status_set_to, p_status_set_to,
    v_task.follow_up_date, p_follow_up_date,
    v_task.expected_date, p_expected_date,
    v_task.outcome, coalesce(p_outcome, v_task.outcome),
    v_task.call_notes, p_notes
  );

  -- The five editable fields. `outcome` is the one that may be left alone
  -- (coalesce) - the client named it an editable field, not a required one,
  -- and a blank picker should not silently blank a report's outcome.
  --
  -- `next_action` clears when the new status is CLOSED, mirroring 0048's
  -- rule for a visit (`enforce_closed_visit_has_no_next_action`) and
  -- log_call()'s own inline refusal for a fresh filing - "a closed status
  -- gets no next action" the same way, by a different door, because that
  -- trigger is `visits`-only and a call is never a visits row.
  --
  -- NO NEW follow_up_tasks ROW IS EVER INSERTED HERE. "Creates no new
  -- follow-up" is not conditional on closed vs open for an EDIT: a
  -- correction to an already-filed call is not a second filing, so this
  -- function is a plain UPDATE and nothing else, for every status.
  update public.follow_up_tasks
     set status_set_to  = p_status_set_to,
         follow_up_date = p_follow_up_date,
         expected_date  = p_expected_date,
         outcome        = coalesce(p_outcome, outcome),
         call_notes     = p_notes,
         next_action    = case when v_is_open is false then null else next_action end
   where id = p_task_id;

  -- THE MOST-RECENT-EVENT RULE. A status-setting event is a visit or a call
  -- whose own status_set_to is not null, read by its reported_at - the same
  -- timestamp log_call() and close_visit() both stamp at the moment they
  -- file. If nothing else has reported later than THIS call did, this call
  -- is still the institute's current word on the matter and the edit may
  -- speak for the institute too. If something later exists, the institute
  -- has already moved on and this correction must not drag it back.
  select exists (
    select 1 from public.visits v
     where v.institute_id = v_task.institute_id
       and v.status_set_to is not null
       and v.reported_at > v_task.reported_at
    union all
    select 1 from public.follow_up_tasks f
     where f.institute_id = v_task.institute_id
       and f.kind = 'call'
       and f.id <> p_task_id
       and f.status_set_to is not null
       and f.reported_at > v_task.reported_at
  ) into v_has_later_event;

  if not v_has_later_event then
    -- Same statement log_call() itself runs. institutes_record_status_change
    -- (0011) and institutes_cancel_follow_ups (0048) both fire from this one
    -- UPDATE exactly as they do for any other path - nothing here duplicates
    -- either trigger.
    update public.institutes
       set status = p_status_set_to
     where id = v_task.institute_id;
  end if;
end;
$$;

comment on function public.admin_update_call_report is
  'Admin-only correction to an already-filed Call Report: status_set_to, '
  'follow_up_date, expected_date, outcome, call_notes. SECURITY INVOKER with '
  'is_admin() as its own first statement - a narrower, separate door from '
  'follow_up_tasks RLS. Applies the status to the institute too, through the '
  'SAME triggers log_call() relies on, only when this call is the institute''s '
  'most recent status-setting event; otherwise only the call row moves. A '
  'closed status clears next_action and no new follow-up task is ever '
  'inserted. Every call records one append-only call_report_edits row. '
  'Raises FO016, FO024, FO040, FO045, FO046.';

revoke all on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) from public;
revoke all on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) from anon;
grant execute on function public.admin_update_call_report(
  uuid, text, date, date, text, text
) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Prove it landed
--
-- array_append() throughout - see 0032 and 0035 for why `||` on a text[] with
-- a bare literal fails with 22P02 exactly when a check has something to
-- report. search_path asked with LIKE 'search_path=%' against proconfig,
-- never array containment - see 0042/0045 for why `@>` gives a false alarm.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  c        text;
  n        integer;
  body     text;
  pol      record;
begin
  -- 3a. The table, its columns, RLS on, and the right grants.
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'call_report_edits'
  ) then
    problems := array_append(problems, 'public.call_report_edits is missing');
  else
    foreach c in array array[
      'call_id', 'edited_by', 'edited_at',
      'old_status_set_to', 'new_status_set_to',
      'old_follow_up_date', 'new_follow_up_date',
      'old_expected_date', 'new_expected_date',
      'old_outcome', 'new_outcome',
      'old_call_notes', 'new_call_notes'
    ] loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'call_report_edits'
           and column_name = c
      ) then
        problems := array_append(problems, format('call_report_edits.%s is missing', c));
      end if;
    end loop;

    if not (
      select relrowsecurity from pg_class
       where oid = 'public.call_report_edits'::regclass
    ) then
      problems := array_append(
        problems, 'row level security is NOT enabled on call_report_edits');
    end if;

    if exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'call_report_edits'
         and grantee = 'anon'
    ) then
      problems := array_append(problems, 'anon holds a grant on call_report_edits');
    end if;
  end if;

  -- 3b. Exactly the two policies, and each asks is_admin().
  n := 0;
  for pol in
    select policyname, cmd, qual, with_check from pg_policies
     where schemaname = 'public' and tablename = 'call_report_edits'
  loop
    n := n + 1;
    if pol.cmd = 'SELECT' and (pol.qual is null or pol.qual not like '%is_admin%') then
      problems := array_append(problems, 'call_report_edits SELECT is not admin-only');
    end if;
    if pol.cmd = 'INSERT'
       and (pol.with_check is null or pol.with_check not like '%is_admin%') then
      problems := array_append(problems, 'call_report_edits INSERT is not admin-only');
    end if;
  end loop;
  if n <> 2 then
    problems := array_append(problems, format(
      'expected 2 policies on call_report_edits (select, insert), found %s', n));
  end if;

  -- 3c. Append-only: the statement trigger is attached, and update/delete are
  --     refused in practice, not merely by an absent policy.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'call_report_edits_immutable'
       and tgrelid = 'public.call_report_edits'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'call_report_edits_immutable trigger is not attached');
  end if;

  begin
    update public.call_report_edits set edited_at = now() where false;
    problems := array_append(
      problems, 'an UPDATE on call_report_edits did not raise - append-only is not enforced');
  exception when sqlstate '42501' then
    null; -- expected
  end;

  -- 3d. admin_update_call_report(): one overload, INVOKER, search_path
  --     pinned, the right grants, and the FO codes still in the body.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_update_call_report';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 admin_update_call_report, found %s', n));
  else
    if (select p.prosecdef
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'admin_update_call_report') then
      problems := array_append(
        problems,
        'admin_update_call_report() is SECURITY DEFINER - RLS would stop applying inside it');
    end if;

    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[])) as cfg(setting)
       where ns.nspname = 'public' and p.proname = 'admin_update_call_report'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(problems, 'admin_update_call_report() does not pin search_path');
    end if;

    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'admin_update_call_report';

    foreach c in array array['FO016', 'FO024', 'FO040', 'FO045', 'FO046'] loop
      if body is null or position(c in body) = 0 then
        problems := array_append(problems, format('admin_update_call_report() no longer raises %s', c));
      end if;
    end loop;

    if body is null or position('is_admin' in body) = 0 then
      problems := array_append(problems, 'admin_update_call_report() lost its own is_admin() check');
    end if;

    if body is null or position('call_report_edits' in body) = 0 then
      problems := array_append(problems, 'admin_update_call_report() no longer writes call_report_edits');
    end if;

    if body is null or position('reported_at >' in body) = 0 then
      problems := array_append(
        problems, 'admin_update_call_report() lost the most-recent-event comparison');
    end if;

    -- It must never insert a SECOND follow_up_tasks row.
    if body is null or (
      position('insert into public.follow_up_tasks' in body) > 0
      or position('insert into follow_up_tasks' in body) > 0
    ) then
      problems := array_append(
        problems,
        'admin_update_call_report() inserts into follow_up_tasks - an edit must never create a new task');
    end if;
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.admin_update_call_report(uuid, text, date, date, text, text)',
    'execute'
  ) then
    problems := array_append(problems, 'authenticated may not execute admin_update_call_report()');
  end if;

  if has_function_privilege(
    'anon',
    'public.admin_update_call_report(uuid, text, date, date, text, text)',
    'execute'
  ) then
    problems := array_append(problems, 'anon may execute admin_update_call_report()');
  end if;

  -- 3e. Nothing already live was touched by this file.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'log_call'
  ) then
    problems := array_append(problems, 'log_call() has gone missing');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_cancel_follow_ups'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_cancel_follow_ups (0048) has gone');
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'institutes_record_status_change'
       and tgrelid = 'public.institutes'::regclass and not tgisinternal
  ) then
    problems := array_append(problems, 'institutes_record_status_change (0011) has gone');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0063 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0063 applied: admin_update_call_report() lets an admin correct a filed Call Report, recording every edit in call_report_edits and moving institutes.status only when the call is still the institute''s most recent status-setting event. log_call(), institutes_cancel_follow_ups and institutes_record_status_change are all untouched.';
end $$;


-- =============================================================================
-- Afterwards
--
--   -- an edit's trail
--   select edited_at, edited_by, old_status_set_to, new_status_set_to
--     from public.call_report_edits
--    where call_id = '<id>'
--    order by edited_at desc;
--
--   -- which calls are the most-recent event for their institute right now
--   select f.id, f.institute_id, f.reported_at
--     from public.follow_up_tasks f
--    where f.kind = 'call' and f.status_set_to is not null
--      and not exists (
--        select 1 from public.visits v
--         where v.institute_id = f.institute_id and v.status_set_to is not null
--           and v.reported_at > f.reported_at
--      )
--      and not exists (
--        select 1 from public.follow_up_tasks f2
--         where f2.institute_id = f.institute_id and f2.kind = 'call'
--           and f2.id <> f.id and f2.status_set_to is not null
--           and f2.reported_at > f.reported_at
--      );
-- =============================================================================
