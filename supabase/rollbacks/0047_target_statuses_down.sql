-- Behavioral DOWN: preserve all Admin-created target status records.
begin;
revoke insert, update, delete on public.target_statuses from authenticated;
commit;
