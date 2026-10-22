-- Behavioral DOWN; cancelled_at is retained to preserve cancellation history.
-- Deploy prior code after rollback. No plan, visit, or task row is removed.
begin;
drop trigger if exists daily_plans_guard_cancelled on public.daily_plans;
drop function if exists public.guard_cancelled_plan();
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

  -- Upcoming plan rows that have not started, so they leave the Daily Plan.
  -- A checked-in row is the visit in progress and stays (FO014 would refuse
  -- a rep deleting it anyway). A past row is history, including Rule 7's
  -- meetings_actual, and stays. checkout_missing is an admin's record.
  -- visits.daily_plan_id is ON DELETE SET NULL, so a visit that pointed at
  -- one of these rows keeps the visit and loses only the link.
  delete from public.daily_plans
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
commit;
