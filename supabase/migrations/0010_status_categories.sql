-- =============================================================================
-- KUbeats - migration 0010: the event-invitation statuses, and open vs closed
--
-- WHAT THIS ADDS
--
--   1. Three new institute statuses for the event-invitation workflow:
--        'Invited principal for event'  open
--        'RSVP received'                closed
--        'Will not come'                closed
--      Rule 4 is unchanged - status is still set by hand, never derived - so
--      this only widens the two CHECK constraints that list the vocabulary.
--
--   2. An OPEN/CLOSED category for all nine statuses, as a lookup table plus
--      two functions, so the database can tell one from the other. Open means
--      the institute is still in play; closed means that loop is finished.
--
--   3. Rule 5 widened by one status: 'Invited principal for event' now requires
--      a follow-up date, exactly as 'Pending for management approval' has since
--      0001. Both are open loops waiting on someone else's answer.
--
-- WHY A TABLE AND NOT A CASE EXPRESSION
--
-- public.institute_statuses is the database's single source of truth for the
-- mapping, and public.institute_status_category() reads it rather than
-- restating it. Adding a tenth status later is then an INSERT plus widening the
-- two CHECKs - never a hunt for every CASE that had an opinion about
-- categories. The functions are STABLE rather than IMMUTABLE because they read
-- a table; that is correct, and it means a category may be used in a trigger or
-- a query but not in a CHECK or an index.
--
-- MUST MATCH THE APP
--
-- src/lib/validation/institute.ts holds INSTITUTE_STATUS_CATALOGUE, the same
-- nine rows with the same categories in the same order. The two halves are
-- held together by the institute_status_category suite in
-- tests/integration/rules.test.ts, which fails loudly if only one of them
-- moves - the same arrangement as app_today() in 0008.
--
-- NOTHING IS BACK-FILLED
--
-- Every existing row already carries one of the original six, all of which are
-- still valid and keep the category they always implied. No institute changes
-- status because of this migration.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The lookup table - the mapping, once
--
-- sort_order is the display order the app uses, so a query that orders by it
-- returns the list a rep sees in the dropdown.
-- -----------------------------------------------------------------------------
create table if not exists public.institute_statuses (
  status     text primary key,
  category   text    not null,
  sort_order integer not null,

  constraint institute_statuses_category_valid check (category in ('open', 'closed')),
  constraint institute_statuses_sort_order_unique unique (sort_order)
);

comment on table public.institute_statuses is
  'Rule 4''s nine statuses and their open/closed category. The database''s '
  'single source of truth for the mapping; mirrored by INSTITUTE_STATUS_CATALOGUE '
  'in src/lib/validation/institute.ts.';

comment on column public.institute_statuses.category is
  'open = the institute is still in play. closed = that loop is finished.';

-- Seeded idempotently: re-running fixes a hand-edited category rather than
-- failing or silently leaving it wrong.
insert into public.institute_statuses (status, category, sort_order) values
  ('First meeting done',              'open',   1),
  ('Session scheduled',               'open',   2),
  ('Session done',                    'closed', 3),
  ('Campus visit scheduled',          'open',   4),
  ('Campus visit done',               'closed', 5),
  ('Pending for management approval', 'open',   6),
  ('Invited principal for event',     'open',   7),
  ('RSVP received',                   'closed', 8),
  ('Will not come',                   'closed', 9)
on conflict (status) do update
  set category = excluded.category,
      sort_order = excluded.sort_order;

-- A vocabulary, not anyone's data: every signed-in user reads the same nine
-- rows. Writing one is a migration, so no write policy exists at all.
alter table public.institute_statuses enable row level security;

drop policy if exists institute_statuses_select on public.institute_statuses;
create policy institute_statuses_select on public.institute_statuses
  for select to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- 2. Asking the question in SQL
-- -----------------------------------------------------------------------------
create or replace function public.institute_status_category(p_status text)
returns text
language sql
stable
set search_path = ''
as $fn$
  select s.category
  from public.institute_statuses s
  where s.status = p_status;
$fn$;

comment on function public.institute_status_category(text) is
  'The open/closed category of a status. Null for an unknown status and for '
  'null, so a caller can tell "no status yet" from "closed".';

create or replace function public.institute_status_is_open(p_status text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select public.institute_status_category(p_status) = 'open';
$fn$;

comment on function public.institute_status_is_open(text) is
  'True only for an open status. Null for an unknown status and for null - an '
  'institute with no status yet is not "closed".';

revoke all on function public.institute_status_category(text) from public;
revoke all on function public.institute_status_is_open(text)   from public;
grant execute on function public.institute_status_category(text) to authenticated;
grant execute on function public.institute_status_is_open(text)   to authenticated;


-- -----------------------------------------------------------------------------
-- 3. The vocabulary itself, widened from six to nine
--
-- Recreated rather than altered: Postgres has no "alter constraint" for a
-- CHECK. Dropping and re-adding revalidates every existing row, which is the
-- point - if any row held something outside the nine, this migration fails
-- here rather than leaving a constraint that lies about the data.
-- -----------------------------------------------------------------------------
alter table public.institutes drop constraint if exists institutes_status_valid;
alter table public.institutes add constraint institutes_status_valid check (
  status is null or status in (
    'First meeting done',
    'Session scheduled',
    'Session done',
    'Campus visit scheduled',
    'Campus visit done',
    'Pending for management approval',
    'Invited principal for event',
    'RSVP received',
    'Will not come'
  )
);

alter table public.visits drop constraint if exists visits_status_set_to_valid;
alter table public.visits add constraint visits_status_set_to_valid check (
  status_set_to is null or status_set_to in (
    'First meeting done',
    'Session scheduled',
    'Session done',
    'Campus visit scheduled',
    'Campus visit done',
    'Pending for management approval',
    'Invited principal for event',
    'RSVP received',
    'Will not come'
  )
);

comment on column public.institutes.status is
  'One of nine fixed values, set manually. Never auto-derived from visit '
  'activity (rule 4). public.institute_statuses says which are open and which '
  'are closed.';


-- -----------------------------------------------------------------------------
-- 4. Rule 5 - an invitation now demands a date to chase on
--
-- 'Invited principal for event' joins 'Pending for management approval' as a
-- status that requires a follow-up date. What the two have in common is not
-- that they are open, but that they are waiting on someone else's answer with
-- nothing scheduled that would bring them back on its own - no session, no
-- campus visit, no date in anyone's diary. Without a follow-up they simply go
-- quiet, which is the failure this constraint exists to prevent.
--
-- The constraint is RENAMED as it is widened: 0001 called it
-- visits_follow_up_required_for_approval, and that name stops being true the
-- moment it covers a second status. Both names are dropped below, so this runs
-- cleanly whether or not an earlier version of 0010 has already been applied.
--
-- Nothing existing can fail the revalidation. A visit already logged against
-- 'Pending for management approval' necessarily carries a follow_up_date,
-- because the constraint being replaced demanded one; and no row can name
-- 'Invited principal for event' yet, because the vocabulary only started
-- accepting it a few statements ago.
--
-- The two closed statuses are deliberately NOT here. 'RSVP received' and 'Will
-- not come' finish the loop, so a follow-up is not required - but it stays
-- permitted, because "they said no, ask again next intake" is a real note to
-- leave and forbidding it would lose it.
--
-- The other half of Rule 5 is untouched: the two 'scheduled' statuses still
-- forbid a follow-up, because they carry their own expected date.
-- -----------------------------------------------------------------------------
alter table public.visits
  drop constraint if exists visits_follow_up_required_for_approval;
alter table public.visits
  drop constraint if exists visits_follow_up_required_when_awaiting;

alter table public.visits add constraint visits_follow_up_required_when_awaiting check (
  status_set_to is null
  or status_set_to not in (
    'Pending for management approval',
    'Invited principal for event'
  )
  or follow_up_date is not null
);

comment on constraint visits_follow_up_required_when_awaiting on public.visits is
  'Rule 5: a status that waits on someone else''s answer must carry a date to '
  'chase on. Mirrored by FOLLOW_UP_REQUIRED_FOR in src/lib/validation/visit.ts.';


-- -----------------------------------------------------------------------------
-- 5. Prove the copies agree
--
-- Statuses are now named in four places in this file: the lookup table, the two
-- vocabulary CHECKs, and Rule 5's required list. That is deliberate - a CHECK
-- cannot contain a subquery, so none of them can read the table - but it is
-- exactly the kind of duplication that rots. This block compares them and
-- refuses to leave the database in a state where they disagree.
--
-- Both directions are checked, twice over:
--
--   * every status in the table appears in each vocabulary CHECK, and neither
--     CHECK lists more literals than the table has rows;
--   * Rule 5's CHECK names both awaiting statuses, both are real statuses, and
--     it names no third one.
--
-- The status values contain no apostrophes, so matching quoted literals with a
-- regex is safe here.
-- -----------------------------------------------------------------------------
do $$
declare
  institutes_def  text;
  visits_def      text;
  required_def    text;
  table_count     integer;
  institutes_n    integer;
  visits_n        integer;
  required_n      integer;
  awaiting        text[] := array[
                     'Pending for management approval',
                     'Invited principal for event'
                   ];
  awaiting_status text;
  row_status      record;
  problems        text[] := '{}';
begin
  select pg_get_constraintdef(oid) into institutes_def
    from pg_constraint where conname = 'institutes_status_valid';
  select pg_get_constraintdef(oid) into visits_def
    from pg_constraint where conname = 'visits_status_set_to_valid';
  select pg_get_constraintdef(oid) into required_def
    from pg_constraint where conname = 'visits_follow_up_required_when_awaiting';

  if institutes_def is null or visits_def is null or required_def is null then
    raise exception
      'Status vocabulary check: a CHECK constraint is missing (institutes=%, visits=%, follow-up=%).',
      institutes_def is not null, visits_def is not null, required_def is not null;
  end if;

  select count(*) into table_count from public.institute_statuses;

  for row_status in select status from public.institute_statuses order by sort_order loop
    if position(quote_literal(row_status.status) in institutes_def) = 0 then
      problems := problems || format('institutes_status_valid does not accept %L', row_status.status);
    end if;
    if position(quote_literal(row_status.status) in visits_def) = 0 then
      problems := problems || format('visits_status_set_to_valid does not accept %L', row_status.status);
    end if;
  end loop;

  select count(*) into institutes_n from regexp_matches(institutes_def, '''([^'']+)''', 'g');
  select count(*) into visits_n     from regexp_matches(visits_def,     '''([^'']+)''', 'g');

  if institutes_n <> table_count then
    problems := problems || format(
      'institutes_status_valid lists %s statuses but institute_statuses has %s',
      institutes_n, table_count);
  end if;
  if visits_n <> table_count then
    problems := problems || format(
      'visits_status_set_to_valid lists %s statuses but institute_statuses has %s',
      visits_n, table_count);
  end if;

  -- Rule 5's required list must name the two awaiting statuses and nothing
  -- else. Both directions again: each one present, and no third smuggled in.
  foreach awaiting_status in array awaiting loop
    if position(quote_literal(awaiting_status) in required_def) = 0 then
      problems := problems || format(
        'visits_follow_up_required_when_awaiting does not require a follow-up for %L',
        awaiting_status);
    end if;
    if (select count(*) from public.institute_statuses where status = awaiting_status) = 0 then
      problems := problems || format('%L is not a known status at all', awaiting_status);
    end if;
  end loop;

  select count(*) into required_n from regexp_matches(required_def, '''([^'']+)''', 'g');
  if required_n <> array_length(awaiting, 1) then
    problems := problems || format(
      'visits_follow_up_required_when_awaiting names %s statuses, expected %s',
      required_n, array_length(awaiting, 1));
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Status vocabulary has drifted: %', array_to_string(problems, '; ');
  end if;

  raise notice
    'Status vocabulary: % statuses, both CHECK constraints agree; % of them require a follow-up.',
    table_count, array_length(awaiting, 1);
end $$;
