-- =============================================================================
-- KUbeats - migration 0045: an optional rupee amount on each slab
--
-- ADDITIVE. SAFE TO APPLY AT ANY TIME. Existing rows gain a null amount, which
-- is "no amount", and every save_slabs() call that omits the key still stores
-- null. The signature does not change, so a build that has not shipped this
-- column's form still calls the same five parameters.
--
-- WHAT CHANGED, AND WHAT DID NOT.
--
--   institute_slabs.amount     nullable integer, null or >= 0.
--   save_slabs()               same arguments. The body is 0044's, plus the
--                              amount read. A negative amount is FO036, the
--                              same code a negative start already raises; the
--                              CHECK is what holds against a direct insert.
--   decide_slabs()             untouched.
--   guard_slab_decision()      untouched.
--   institute_is_empanelled()  untouched.
--   RLS                        untouched.
--
-- No DROP FUNCTION. CREATE OR REPLACE keeps the one overload 0044 asserted.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The column, and the constraint that holds against a direct insert
-- -----------------------------------------------------------------------------
alter table public.institute_slabs
  add column if not exists amount integer;

comment on column public.institute_slabs.amount is
  'Optional whole rupees for this slab. Null means the rep left it blank, '
  'never zero and never "unknown". Zero is a real amount and is stored as 0.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'slab_amount_non_negative'
  ) then
    alter table public.institute_slabs
      add constraint slab_amount_non_negative
      check (amount is null or amount >= 0);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. save_slabs() — 0044's body, with the amount written on the insert
--
-- The signature is unchanged on purpose. Amount travels inside p_slabs, the
-- same jsonb array the ranges already use, so a sixth parameter would have
-- been a second way to say "one row".
--
-- A missing "amount" key, JSON null, and "" all store null. A negative number
-- is refused here as FO036, before the insert, because the CHECK below would
-- otherwise surface as 23514 — a code the app does not map, and not the code
-- a negative start already uses.
-- -----------------------------------------------------------------------------
create or replace function public.save_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_slabs     jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count   integer;
  v_prev_end integer;
  v_start   integer;
  v_end     integer;
  v_amount  integer;
  v_i       integer;
  v_owner   uuid;
begin
  if p_institute is null then
    raise exception 'No institute was named.' using errcode = 'FO036';
  end if;

  if p_scope not in ('program', 'total') then
    raise exception 'A slab set is either program-wise or total.' using errcode = 'FO036';
  end if;

  -- The scope's shape, said before anything is written so the message names the
  -- field rather than arriving as a constraint violation.
  if p_scope = 'total' and (btrim(coalesce(p_college, '')) <> '' or btrim(coalesce(p_program, '')) <> '') then
    raise exception
      'A total slab set covers every programme, so it carries no college or programme.'
      using errcode = 'FO036';
  end if;

  if p_scope = 'program'
     and (btrim(coalesce(p_college, '')) = '' or btrim(coalesce(p_program, '')) = '') then
    raise exception
      'A program-wise slab set needs both a college and a programme.'
      using errcode = 'FO036';
  end if;

  if jsonb_typeof(p_slabs) <> 'array' then
    raise exception 'Slabs must be a list.' using errcode = 'FO036';
  end if;

  /*
   * ⚠ AN APPROVED SET IS FROZEN, AND THIS IS WHERE THAT IS ENFORCED FOR THIS
   * PATH. The integration suite caught its absence.
   *
   * FO035 is `before insert or update` and this function REPLACES — delete then
   * insert — so the approved rows were removed by a statement the trigger never
   * saw, and the inserts that followed were new rows, legitimately pending. The
   * rep silently un-approved their own work, which is exactly what the freeze
   * exists to stop, through the one mechanism that makes set-editing possible
   * at all.
   *
   * Checked before anything is deleted, so a refusal leaves the set whole.
   */
  if exists (
    select 1 from public.institute_slabs s
     where s.institute_id = p_institute
       and s.scope = p_scope
       and coalesce(s.college, '') = coalesce(p_college, '')
       and coalesce(s.program, '') = coalesce(p_program, '')
       and s.status = 'approved'
  ) then
    raise exception
      'These slabs are approved and cannot be edited. Ask an admin to revoke them first.'
      using errcode = 'FO035';
  end if;

  v_count := jsonb_array_length(p_slabs);
  if v_count = 0 then
    raise exception 'Add at least one slab.' using errcode = 'FO036';
  end if;

  /*
   * THE SET RULES, IN ORDER, each with the sentence the rep will read.
   *
   * Walked in the order given rather than sorted first: the order IS part of
   * what is being validated. Sorting would silently repair "1-10, 21-30, 11-20"
   * into something the rep did not type, and the next slab's start is the whole
   * point of the rule.
   */
  v_prev_end := null;
  for v_i in 0 .. v_count - 1 loop
    v_start := (p_slabs -> v_i ->> 'start')::integer;
    v_end   := nullif(p_slabs -> v_i ->> 'end', '')::integer;

    if v_start is null then
      raise exception 'Slab %: a start is required.', v_i + 1 using errcode = 'FO036';
    end if;

    if v_start < 0 then
      raise exception 'Slab %: a start cannot be negative.', v_i + 1 using errcode = 'FO036';
    end if;

    -- Only the LAST slab may be open-ended, and it MUST be.
    if v_i < v_count - 1 and v_end is null then
      raise exception
        'Slab % needs an end. Only the last slab is open-ended.', v_i + 1
        using errcode = 'FO036';
    end if;

    if v_i = v_count - 1 and v_end is not null then
      raise exception
        'The last slab must be open-ended - leave its end blank for "% and above".', v_start
        using errcode = 'FO036';
    end if;

    if v_end is not null and v_end < v_start then
      raise exception
        'Slab %: the end cannot be before the start.', v_i + 1
        using errcode = 'FO036';
    end if;

    -- CONTIGUOUS: no gap and no overlap, which is one rule, not two.
    if v_prev_end is not null and v_start <> v_prev_end + 1 then
      raise exception
        'Slab % must start at %, right after the previous slab ends.', v_i + 1, v_prev_end + 1
        using errcode = 'FO036';
    end if;

    -- Optional whole rupees. Absent, null and "" are all "no amount".
    v_amount := nullif(p_slabs -> v_i ->> 'amount', '')::integer;
    if v_amount is not null and v_amount < 0 then
      raise exception 'Slab %: an amount cannot be negative.', v_i + 1
        using errcode = 'FO036';
    end if;

    v_prev_end := v_end;
  end loop;

  /*
   * REPLACED, NOT MERGED. The delete and the inserts are one statement pair in
   * one transaction, so the half-edited states the rules forbid never exist -
   * which is the whole reason this is an RPC rather than row-level writes.
   *
   * RLS applies to both halves because this is SECURITY INVOKER: a rep who
   * cannot see the institute deletes nothing and inserts nothing.
   */
  delete from public.institute_slabs s
   where s.institute_id = p_institute
     and s.scope = p_scope
     and coalesce(s.college, '') = coalesce(p_college, '')
     and coalesce(s.program, '') = coalesce(p_program, '');

  insert into public.institute_slabs
    (institute_id, scope, college, program, start_count, end_count, amount)
  select
    p_institute,
    p_scope,
    case when p_scope = 'total' then null else p_college end,
    case when p_scope = 'total' then null else p_program end,
    (value ->> 'start')::integer,
    nullif(value ->> 'end', '')::integer,
    nullif(value ->> 'amount', '')::integer
  from jsonb_array_elements(p_slabs) as value;

  -- Nothing was written: the institute is not one this caller may touch. Said
  -- rather than returning 0 quietly, because "saved" and "silently discarded"
  -- must not look the same.
  select registered_by into v_owner from public.institutes where id = p_institute;
  if not found then
    raise exception
      'That institute is not yours to add slabs to.'
      using errcode = 'FO036';
  end if;

  return v_count;
end;
$$;

comment on function public.save_slabs is
  'Validates and REPLACES one scope''s slab set in a single transaction. The '
  'set is the unit: a contiguous inclusive cover with exactly one open-ended '
  'slab last, so no sequence of row-level writes could reach it legally. '
  'Each slab may carry an optional whole-rupee amount; blank is null. '
  'SECURITY INVOKER, so RLS and FO035 apply inside. Raises FO036.';

revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from public;
revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from anon;
grant execute on function public.save_slabs(uuid, text, text, text, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Prove it landed, and prove the shape 0044 left is still the shape
--
-- array_append() throughout — see 0032 and 0035 for why `||` on a text[] with a
-- bare literal fails with 22P02 exactly when a check has something to report.
--
-- search_path is asked with LIKE 'search_path=%' against proconfig, never
-- array containment. An empty search_path flattens to `search_path=""`, so
-- `@> array['search_path=']` is false for a function that pins it perfectly.
-- That false alarm rolled 0035 back on dev once.
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  n        integer;
  args     text;
  body     text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'institute_slabs'
       and column_name = 'amount'
  ) then
    problems := array_append(problems, 'institute_slabs.amount is missing');
  elsif (
    select is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'institute_slabs'
       and column_name = 'amount'
  ) <> 'YES' then
    problems := array_append(
      problems,
      'institute_slabs.amount is NOT NULL - a slab with no amount could not be saved');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'slab_amount_non_negative'
  ) then
    problems := array_append(
      problems,
      'slab_amount_non_negative is missing - a direct insert could store a negative amount');
  end if;

  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'save_slabs';

  if n <> 1 then
    problems := array_append(problems, format(
      'expected exactly 1 save_slabs, found %s - a second overload would make every call ambiguous', n));
  else
    if (select p.prosecdef
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'save_slabs') then
      problems := array_append(
        problems,
        'save_slabs() is SECURITY DEFINER - RLS would stop applying inside it');
    end if;

    if not exists (
      select 1
        from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proconfig, '{}'::text[]))
          as cfg(setting)
       where ns.nspname = 'public'
         and p.proname = 'save_slabs'
         and cfg.setting like 'search_path=%'
    ) then
      problems := array_append(
        problems,
        'save_slabs() does not pin search_path');
    end if;

    select pg_get_function_identity_arguments(p.oid) into args
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'save_slabs';

    if args is distinct from 'p_institute uuid, p_scope text, p_college text, p_program text, p_slabs jsonb' then
      problems := array_append(problems, format(
        'save_slabs() signature changed to "%s" - amount belongs inside p_slabs, not as a new parameter', args));
    end if;

    select regexp_replace(
             regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
             '--[^' || chr(10) || ']*', '', 'g')
      into body
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'save_slabs';

    if body is null or position('nullif(value ->> ''amount'', '''')::integer' in body) = 0 then
      problems := array_append(
        problems,
        'save_slabs() does not write amount - a saved rupee figure would be discarded');
    end if;

    if body is null or position('an amount cannot be negative' in body) = 0 then
      problems := array_append(
        problems,
        'save_slabs() does not refuse a negative amount as FO036');
    end if;

    -- The 0044 shape, still in the body rather than only in a comment about it.
    if body is null
       or position('FO035' in body) = 0
       or position('Only the last slab is open-ended' in body) = 0
       or position('a start cannot be negative' in body) = 0 then
      problems := array_append(
        problems,
        'save_slabs() lost a 0044 rule while amount was added');
    end if;
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.save_slabs(uuid, text, text, text, jsonb)',
    'execute'
  ) then
    problems := array_append(problems, 'authenticated may not execute save_slabs()');
  end if;

  if has_function_privilege(
    'anon',
    'public.save_slabs(uuid, text, text, text, jsonb)',
    'execute'
  ) then
    problems := array_append(problems, 'anon may execute save_slabs()');
  end if;

  if array_length(problems, 1) > 0 then
    raise exception '0045 did not apply cleanly: %', array_to_string(problems, '; ');
  end if;

  raise notice
    '0045 applied: institute_slabs.amount is an optional non-negative integer, and save_slabs() still takes (uuid, text, text, text, jsonb).';
end $$;
