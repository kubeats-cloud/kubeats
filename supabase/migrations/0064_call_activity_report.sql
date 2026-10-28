-- Call Activity Report: one row per rep, call counts by CURRENT status_set_to,
-- split Open/Closed from institute_statuses.category. Same security pattern
-- as 0055-0060: admin-or-team-lead checked in SQL, team lead scoped to their
-- own reps via supervises(), paginated and sorted in SQL (50 reps/page),
-- p_page < 1 means export (all rows, 31-day range required).
--
-- Counts the CURRENT follow_up_tasks.status_set_to for kind='call' rows that
-- have been filed (reported_at not null) — never a history ledger — so
-- editing a call (admin_update_call_report, 0063) moves its count on the
-- next read and never duplicates it. No Call Activity column/filter: a call
-- has one activity, "Call" (client decision); p_status is the only status
-- filter this function offers.
--
-- FILTERS (added in place for Part 3 — this file was never applied anywhere
-- but the rehearsal DB, so it is amended rather than versioned as 0065):
-- p_from/p_to compare the call's reported date in Asia/Kolkata, inclusive of
-- the whole p_to day — a calendar-date comparison, not a timestamp one, so
-- 23:59:59 IST on the To day is included and 00:00:00 IST the day after is
-- not. p_member narrows to one rep (and, for a team lead, cannot widen their
-- scope beyond their own reps — registry's supervises() is checked before
-- p_member is, so a foreign rep id simply matches nothing). p_institute is
-- NAME-CONTAINS, not an id — a 700-institute dropdown is exactly what this
-- avoids — case-insensitive via strpos(lower(...)), the same idiom
-- audit_institute_activity (0055) already uses for its own p_search.
begin;

drop function if exists public.call_activity_report(
  date, date, uuid, uuid, text, text, boolean, integer
);

create or replace function public.call_activity_report(
  p_from      date    default null,
  p_to        date    default null,
  p_member    uuid    default null,
  p_institute text    default null,
  p_status    text    default null,
  p_sort      text    default 'rep',
  p_desc      boolean default false,
  p_page      integer default 1
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_export boolean := coalesce(p_page,1) < 1;
begin
  if not (public.is_admin() or public.is_team_lead()) then
    raise exception 'Only an admin or a team lead can read the Call Activity Report.'
      using errcode = '42501';
  end if;
  if v_export then
    if p_from is null or p_to is null then
      raise exception 'Choose a From and To date for the Excel export.' using errcode = '22023';
    end if;
    if p_to < p_from then
      raise exception 'The To date must not be before the From date.' using errcode = '22023';
    end if;
    if p_to - p_from + 1 > 31 then
      raise exception 'Choose a date range of 31 days or fewer for the Excel export.' using errcode = '22023';
    end if;
  end if;

  return (
    with registry as materialized (
      select p.id, p.name from profiles p
      where p.role = 'rep' and public.supervises(p.id)
        and (p_member is null or p.id = p_member)
    ), ranged_calls as materialized (
      select f.id, f.member, f.status_set_to
      from follow_up_tasks f
      join registry r on r.id = f.member
      join institutes i on i.id = f.institute_id and i.deleted_at is null
      where f.kind = 'call' and f.status_set_to is not null and f.reported_at is not null
        and (p_from is null or (f.reported_at at time zone 'Asia/Kolkata')::date >= p_from)
        and (p_to is null or (f.reported_at at time zone 'Asia/Kolkata')::date <= p_to)
        and (coalesce(trim(p_institute),'') = ''
             or strpos(lower(i.name), lower(trim(p_institute))) > 0)
        and (p_status is null or f.status_set_to = p_status)
    ), call_counts as (
      select member, status_set_to, count(*) n from ranged_calls group by member, status_set_to
    ), per_rep as (
      select r.id, r.name,
        coalesce(jsonb_object_agg(c.status_set_to, c.n) filter (where c.status_set_to is not null), '{}'::jsonb) by_status,
        coalesce(sum(c.n) filter (where s.category = 'open'), 0)::int open_total,
        coalesce(sum(c.n) filter (where s.category = 'closed'), 0)::int closed_total,
        coalesce(sum(c.n), 0)::int grand_total
      from registry r
      left join call_counts c on c.member = r.id
      left join institute_statuses s on s.status = c.status_set_to
      group by r.id, r.name
    ), packed as (
      select id, name, jsonb_build_object(
        'id', id, 'name', name, 'statuses', by_status,
        'openTotal', open_total, 'closedTotal', closed_total, 'total', grand_total
      ) payload,
      case when p_sort = 'open_total' then to_jsonb(open_total)
        when p_sort = 'closed_total' then to_jsonb(closed_total)
        when p_sort = 'total' then to_jsonb(grand_total)
        when p_sort like 'status:%' then to_jsonb(coalesce((by_status ->> substring(p_sort from 8))::int, 0))
        else to_jsonb(lower(name))
      end sort_value
      from per_rep
    ), numbered as (
      select payload, row_number() over (
        order by case when not p_desc then sort_value end asc,
          case when p_desc then sort_value end desc, lower(name), id
      ) position
      from packed
    ), counts as (
      select count(*) total, greatest(1, ceil(count(*)/50.0)::integer) pages from registry
    ), totals as (
      select
        coalesce(jsonb_object_agg(s.status, coalesce(sc.n,0) order by s.sort_order, s.status), '{}'::jsonb) by_status,
        coalesce(sum(sc.n) filter (where s.category = 'open'), 0)::bigint open_total,
        coalesce(sum(sc.n) filter (where s.category = 'closed'), 0)::bigint closed_total,
        coalesce(sum(sc.n), 0)::bigint grand_total
      from institute_statuses s
      left join (
        select status_set_to, count(*) n from ranged_calls group by status_set_to
      ) sc on sc.status_set_to = s.status
      where s.is_active
    ), windowed as (
      select total, pages,
        case when coalesce(p_page,1) < 1 then 1 else least(pages, greatest(1,p_page)) end page,
        coalesce(p_page,1) < 1 all_rows
      from counts
    )
    select jsonb_build_object(
      'total', w.total, 'pages', w.pages, 'page', w.page,
      'statuses', (select coalesce(jsonb_agg(jsonb_build_object(
          'status', s.status, 'category', s.category, 'sortOrder', s.sort_order)
          order by s.sort_order, s.status), '[]'::jsonb)
        from institute_statuses s where s.is_active),
      'totals', jsonb_build_object(
        'byStatus', tot.by_status, 'openTotal', tot.open_total,
        'closedTotal', tot.closed_total, 'total', tot.grand_total),
      'rows', coalesce((select jsonb_agg(n.payload order by n.position) from numbered n
        where w.all_rows or (n.position > (w.page-1)*50 and n.position <= w.page*50)), '[]'::jsonb)
    )
    from windowed w, totals tot
  );
end $$;
revoke all on function public.call_activity_report(date,date,uuid,text,text,text,boolean,integer) from public,anon;
grant execute on function public.call_activity_report(date,date,uuid,text,text,text,boolean,integer) to authenticated;

commit;
