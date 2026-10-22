-- Preserve unstarted plans when Not Interested cancels follow-ups.
-- Apply before code; existing records remain unchanged.
begin;
alter table public.daily_plans add column if not exists cancelled_at timestamptz;
create or replace function public.cancel_upcoming_follow_ups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cancels boolean;
begin
  select s.cancels_follow_ups into v_cancels
    from public.institute_statuses s
   where s.status = new.status;

  if v_cancels is not true then
    return new;
  end if;

  -- Open tasks leave Pending and the Daily Plan. The row stays, marked
  -- cancelled, so the fact that a follow-up had been owed is still a record.
  -- Already-finished tasks are not rewritten.
  update public.follow_up_tasks
     set done_at = now(),
         outcome = 'cancelled'
   where institute_id = new.id
     and done_at is null;

  -- Cancel upcoming unstarted plans without deleting their records.
  -- A checked-in row is the visit in progress and stays (FO014 would refuse
  -- a rep deleting it anyway). A past row is history, including Rule 7's
  -- meetings_actual, and stays. checkout_missing is an admin's record.
  -- Plan IDs and all existing links remain intact.
  update public.daily_plans
     set cancelled_at = coalesce(cancelled_at, now())
   where institute_id = new.id
     and date >= public.app_today()
     and checkin_at is null
     and checkout_at is null
     and meetings_actual is null
     and checkout_missing = false;

  -- Today's arrival, which we kept, must not still advertise a chase date.
  -- Past plans keep theirs.
  update public.daily_plans
     set follow_up_date = null
   where institute_id = new.id
     and date >= public.app_today()
     and follow_up_date is not null;

  return new;
end;
$$;

create or replace function public.guard_cancelled_plan()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.cancelled_at is not null and new.checkin_at is not null then
    raise exception 'A cancelled plan cannot be checked in.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.cancelled_at is not null
     and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'A cancelled plan remains part of history.' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists daily_plans_guard_cancelled on public.daily_plans;
create trigger daily_plans_guard_cancelled before insert or update
on public.daily_plans for each row execute function public.guard_cancelled_plan();

commit;
