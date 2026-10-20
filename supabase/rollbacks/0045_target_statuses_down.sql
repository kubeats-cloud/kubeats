-- =============================================================================
-- KUbeats - DOWN migration 0045
--
-- Reverses supabase/migrations/0045_target_statuses.sql.
-- NOT applied by walking migrations/ — this file lives in rollbacks/ so a
-- forward apply cannot run it by accident.
--
-- WHAT IT UNDOES
--
--   both RLS policies, the grants, and the table itself.
--
-- WHY A REAL DROP, NOT A RETIREMENT
--
-- Nothing in the schema references public.target_statuses — no visit, plan,
-- or history row points at one of its rows, because nothing was ever asked
-- to count against it. There is therefore nothing a drop could strand, unlike
-- institute_statuses (0027), whose foreign keys exist precisely because
-- dropping it WOULD orphan history. Re-applying 0045 afterwards restores an
-- empty table; whatever status names an admin had added are not recoverable
-- from this rollback alone (see docs/BACKUP-RESTORE.md for a logical backup
-- taken before running this).
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
--   Idempotent: safe to run twice.
-- =============================================================================

drop policy if exists target_statuses_select on public.target_statuses;
drop policy if exists target_statuses_insert on public.target_statuses;

revoke all on public.target_statuses from authenticated;
revoke all on public.target_statuses from anon;

drop table if exists public.target_statuses;
