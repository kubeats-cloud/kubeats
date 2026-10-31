-- =============================================================================
-- KUbeats - DOWN migration 0068
--
-- Reverses supabase/migrations/0068_delete_member_call_report_edits.sql.
-- NOT applied by walking migrations/ - this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   reject_call_report_edit_mutation(), restored to 0063's body: raises its
--   append-only refusal unconditionally again, with no bypass.
--
--   delete_member(), restored to 0032's body: no (f2) step, so a member with
--   any call_report_edits row touching them (either side) is refused again -
--   23503 if they made the call, 42501 if they made the edit.
--
-- WHAT IT REFUSES TO UNDO
--
--   Nothing is deleted by this file. Any call_report_edits row 0068's
--   delete_member() has already removed, or any edited_by it has already
--   nulled, stays exactly as it is - those were ordinary deletes/updates in
--   past transactions that already committed, and this file only changes
--   what the two functions do FROM HERE.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. reject_call_report_edit_mutation(), back to 0063's unconditional raise.
-- -----------------------------------------------------------------------------
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


-- -----------------------------------------------------------------------------
-- 2. delete_member(), back to 0032's body - no (f2) step.
-- -----------------------------------------------------------------------------
create or replace function public.delete_member(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller   uuid := (select auth.uid());
  v_role     text;
  v_admins   integer;
  v_blocked  integer;
  v_names    text;
  v_removed  jsonb := '{}'::jsonb;
  n          integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete a member.'
      using errcode = '42501';
  end if;

  if p_member is null then
    raise exception 'No member was named.'
      using errcode = 'FO027';
  end if;

  select role into v_role from public.profiles where id = p_member;
  if v_role is null then
    raise exception 'That member no longer exists.'
      using errcode = 'FO027';
  end if;

  if p_member = v_caller then
    raise exception 'You cannot delete your own account.'
      using errcode = 'FO027';
  end if;

  if v_role = 'admin' then
    select count(*) into v_admins from public.profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception
        'That is the only admin account. Create another admin first.'
        using errcode = 'FO027';
    end if;
  end if;

  select count(*), string_agg(distinct i.name, ', ' order by i.name)
    into v_blocked, v_names
    from public.institutes i
   where i.registered_by = p_member
     and (
       exists (
         select 1 from public.visits v
          where v.institute_id = i.id and v.member <> p_member
       )
       or exists (
         select 1 from public.daily_plans dp
          where dp.institute_id = i.id and dp.member <> p_member
       )
     );

  if coalesce(v_blocked, 0) > 0 then
    raise exception
      'Nothing was deleted. % institute(s) owned by this member carry work '
      'logged by somebody else (%). Reassign them to another rep first, then '
      'delete.', v_blocked, v_names
      using errcode = 'FO027';
  end if;

  delete from public.visit_people vp
   where exists (
     select 1 from public.visits v
      where v.id = vp.visit_id and v.member = p_member
   );
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('visit_people', n);

  delete from public.visits where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('visits', n);

  delete from public.daily_plans where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('daily_plans', n);

  delete from public.targets where member = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('targets', n);

  if to_regclass('public.weekly_targets') is not null then
    execute 'delete from public.weekly_targets where member = $1' using p_member;
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('weekly_targets', n);
  end if;

  if to_regclass('public.weekly_targets_pre_0013') is not null then
    execute 'delete from public.weekly_targets_pre_0013 where member = $1'
      using p_member;
    get diagnostics n = row_count;
    v_removed := v_removed || jsonb_build_object('weekly_targets_pre_0013', n);
  end if;

  delete from public.institutes where registered_by = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('institutes', n);

  delete from public.profiles where id = p_member;
  get diagnostics n = row_count;
  v_removed := v_removed || jsonb_build_object('profiles', n);

  return v_removed;
end;
$$;

comment on function public.delete_member(uuid) is
  'Deletes a member and every row that is theirs alone, in one transaction and '
  'in the order the foreign keys allow: visit_people, visits, daily_plans, '
  'targets, the weekly_targets archive under either name, the institutes they '
  'own, then the profile. Refuses with FO027 when an owned institute carries '
  'another member''s work, rather than wiping it. Does NOT touch auth.users, '
  'storage, or materials. SECURITY DEFINER with is_admin() as its first '
  'statement.';

revoke all on function public.delete_member(uuid) from public;
revoke all on function public.delete_member(uuid) from anon;
grant execute on function public.delete_member(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Did it land?
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  body     text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'reject_call_report_edit_mutation';

  if body is null then
    problems := array_append(problems, 'reject_call_report_edit_mutation() is missing');
  elsif position('kubeats.deleting_member' in body) > 0 then
    problems := array_append(problems,
      '0068 down did not apply - the bypass is still in reject_call_report_edit_mutation()');
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'delete_member';

  if body is null then
    problems := array_append(problems, 'delete_member() is missing');
  elsif position('call_report_edits' in body) > 0 then
    problems := array_append(problems,
      '0068 down did not apply - delete_member() still handles call_report_edits');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0068 down did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0068 down applied: reject_call_report_edit_mutation() raises '
    'unconditionally again, and delete_member() has no call_report_edits '
    'step - both back to their pre-0068 bodies.';
end $$;
