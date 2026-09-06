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
-- 4. Rule 5 is deliberately untouched
--
-- The follow-up constraints still name only the statuses they always named:
-- 'Pending for management approval' requires a follow-up date, and the two
-- 'scheduled' statuses forbid one because they carry their own expected date.
--
-- None of the three new statuses joins either list. An invitation SHOULD carry
-- a follow-up - nobody is booked to come back to you - but a rep who does not
-- yet know when they will chase it must still be able to log the visit, so
-- that is a prompt in the form and not a constraint here. 'RSVP received' and
-- 'Will not come' are closed, so a follow-up is not required; it stays
-- permitted, because "they said no, try again next intake" is a real note to
-- leave and forbidding it would lose it.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 5. Prove the two SQL copies agree
--
-- The vocabulary is now written down three times in this file: the lookup
-- table and the two CHECK constraints. That is deliberate - a CHECK cannot
-- contain a subquery, so it cannot read the table - but it is exactly the kind
-- of duplication that rots. This block compares them and refuses to leave the
-- database in a state where they disagree.
--
-- Both directions are checked: every status in the table must appear in each
-- constraint, and each constraint must list no more literals than the table has
-- rows. The status values contain no apostrophes, so matching quoted literals
-- with a regex is safe here.
-- -----------------------------------------------------------------------------
do $$
declare
  institutes_def  text;
  visits_def      text;
  table_count     integer;
  institutes_n    integer;
  visits_n        integer;
  row_status      record;
  problems        text[] := '{}';
begin
  select pg_get_constraintdef(oid) into institutes_def
    from pg_constraint where conname = 'institutes_status_valid';
  select pg_get_constraintdef(oid) into visits_def
    from pg_constraint where conname = 'visits_status_set_to_valid';

  if institutes_def is null or visits_def is null then
    raise exception
      'Status vocabulary check: a CHECK constraint is missing (institutes=%, visits=%).',
      institutes_def is not null, visits_def is not null;
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

  if array_length(problems, 1) > 0 then
    raise exception 'Status vocabulary has drifted: %', array_to_string(problems, '; ');
  end if;

  raise notice 'Status vocabulary: % statuses, both CHECK constraints agree.', table_count;
end $$;
