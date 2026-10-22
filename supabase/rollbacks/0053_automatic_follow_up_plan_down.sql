-- Behavioral DOWN; generated plans and their source links remain as history.
begin;
drop trigger if exists daily_plans_follow_up_link on public.daily_plans;
drop trigger if exists daily_plans_complete_follow_up on public.daily_plans;
drop trigger if exists follow_up_tasks_cancel_finished_plan on public.follow_up_tasks;
drop function if exists public.materialise_due_followups();
drop function if exists public.guard_plan_follow_up_link();
drop function if exists public.complete_planned_follow_up();
drop function if exists public.cancel_finished_follow_up_plan();
-- Retain columns and indexes so saved links and duplicate protection survive rollback.
commit;
