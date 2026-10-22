-- Behavioral DOWN: keep every status field and saved custom_fields payload.
-- Restore prior app code, then disable configuration writes; SELECT keeps historical labels readable.
begin;
revoke insert, update, delete on public.status_fields from authenticated;
commit;
