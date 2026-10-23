begin;
drop trigger institutes_record_reassignment on public.institutes;
drop function public.record_institute_reassignment();
-- Retain evidence and its admin-only RLS/immutability, rather than delete history.
alter table public.institute_reassignment_history rename to institute_reassignment_history_0058_archive;
commit;
