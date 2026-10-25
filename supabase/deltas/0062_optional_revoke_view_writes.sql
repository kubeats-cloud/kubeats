-- 0062 (PROPOSAL, NOT APPLIED): drop unused write grants on the two audit views.
--
-- On kubeats_prodshape both views inherit Supabase's default table ACLs, so
-- anon and authenticated hold INSERT/UPDATE/DELETE/TRUNCATE as well as SELECT.
-- Neither view is auto-updatable (pg_relation_is_updatable = 0) and neither has
-- an INSTEAD OF trigger or rule, so those write grants cannot succeed today.
-- Removing them is least-privilege hygiene, not a live vulnerability fix.
--
-- SELECT is deliberately left in place: anon still resolves the view and reads
-- zero rows through the base-table RLS, while a rep reads only their own
-- institutes (77 rows in the local production-shape database).
--
-- The owner runs this explicitly; nothing here is applied automatically.
begin;

revoke insert, update, delete, truncate on public.audit_registry
  from anon, authenticated;
revoke insert, update, delete, truncate on public.audit_open_follow_ups
  from anon, authenticated;

commit;
