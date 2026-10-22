-- Behavioral rollback, retaining deleted_at and cancelled_at as history.
-- Existing deleted records remain hidden by the compatible app until prior code is restored.
begin;
drop trigger if exists institutes_guard_deletion on public.institutes;
drop trigger if exists daily_plans_active_institute on public.daily_plans;
drop trigger if exists follow_up_tasks_active_institute on public.follow_up_tasks;
drop trigger if exists visits_active_institute on public.visits;
drop function if exists public.soft_delete_institute(uuid);
drop function if exists public.guard_active_institute_work();
drop function if exists public.guard_institute_deletion();
commit;
