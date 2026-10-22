-- Behavioral rollback; keep call report columns, constraints and data as history.
begin;
drop function if exists public.log_call(uuid,text,date,date,text,integer,text,text,text,text);
commit;
