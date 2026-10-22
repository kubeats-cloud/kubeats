-- KUbeats rollback 0052_down: drop status_fields and custom_fields
begin;
drop table if exists public.status_fields cascade;
alter table public.visits drop column if exists custom_fields;
alter table public.follow_up_tasks drop column if exists custom_fields;
commit;
