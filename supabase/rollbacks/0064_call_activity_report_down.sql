-- DOWN migration 0064. Reverses supabase/migrations/0064_call_activity_report.sql.
-- NOT applied by walking migrations/ - lives in rollbacks/ so a forward apply
-- cannot run it by accident. Net-new function; nothing earlier depends on it.
begin;

drop function if exists public.call_activity_report(
  date, date, uuid, uuid, text, text, boolean, integer
);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'call_activity_report'
  ) then
    raise exception '0064 down did not apply cleanly: call_activity_report() is still present';
  end if;
  raise notice '0064 down applied: call_activity_report() is gone.';
end $$;

commit;
