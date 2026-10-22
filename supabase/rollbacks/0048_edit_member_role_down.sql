-- Removes only the new edit entry point. Saved roles and all history remain.
begin;
drop function if exists public.edit_team_member(uuid,text,text,uuid,boolean);
commit;
