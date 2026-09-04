-- =============================================================================
-- Field Ops — schedule the photo purge
--
-- Run 0003_photo_retention.sql FIRST. This file turns on the two extensions,
-- stores the credentials the purge needs, and schedules it to run every night.
--
-- !! THIS FILE HAS TWO PLACEHOLDERS YOU MUST REPLACE (step 2) !!
-- Replace them in the SQL editor, run it there, and do not save the edited
-- version back into the repo — the service-role key must never be committed.
--
-- Everything here is idempotent: running it twice re-stores the secrets and
-- re-schedules the same single job.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — extensions
--
-- pg_cron runs the nightly job; pg_net lets it call the Storage HTTP API.
-- If either CREATE EXTENSION is refused, enable it instead from
-- Dashboard -> Database -> Extensions (search for the name, flip it on) and
-- then run this file again from step 2.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- -----------------------------------------------------------------------------
-- STEP 2 — credentials, held in Vault
--
-- The purge deletes through the Storage API, which needs the service-role key.
-- Vault keeps it encrypted at rest; only the SECURITY DEFINER purge function
-- reads it, and that function is callable by nobody but the scheduler.
--
-- REPLACE both placeholders below:
--   PROJECT_URL_HERE       Dashboard -> Project Settings -> Data API -> Project URL
--                          e.g. https://abcdefghijklm.supabase.co
--   SERVICE_ROLE_KEY_HERE  Dashboard -> Project Settings -> API Keys -> service_role
-- -----------------------------------------------------------------------------
do $$
declare
  c_project_url text := 'PROJECT_URL_HERE';
  c_service_key text := 'SERVICE_ROLE_KEY_HERE';
begin
  if c_project_url = 'PROJECT_URL_HERE' or c_service_key = 'SERVICE_ROLE_KEY_HERE' then
    raise exception 'Replace the two placeholders in STEP 2 before running this file.';
  end if;

  -- create_secret fails on a duplicate name, so clear any previous value first.
  delete from vault.secrets where name in ('project_url', 'service_role_key');

  perform vault.create_secret(
    c_project_url, 'project_url',
    'Field Ops: Storage API base URL, used by purge_old_visit_photos()');
  perform vault.create_secret(
    c_service_key, 'service_role_key',
    'Field Ops: used only by purge_old_visit_photos()');
end $$;


-- -----------------------------------------------------------------------------
-- STEP 3 — the nightly job
--
-- 19:30 UTC is 01:00 IST: the middle of the night for the team, so a purge
-- never competes with a rep saving a photo at a school gate.
-- -----------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('purge-visit-photos');
exception
  when others then null;  -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'purge-visit-photos',
  '30 19 * * *',
  $job$ select public.purge_old_visit_photos(); $job$
);


-- =============================================================================
-- STEP 4 — check it (run these one at a time, they are just SELECTs)
--
--   -- the job exists and is active
--   select jobid, schedule, jobname, active from cron.job;
--
--   -- run it by hand once, right now
--   select * from public.purge_old_visit_photos();
--
--   -- what each run found. considered = 0 is the correct answer until there
--   -- are photos older than the window; the row proves the job ran.
--   select * from public.photo_purge_runs order by ran_at desc limit 5;
--
--   -- what the Storage API said. 200 means a file was deleted.
--   select id, status_code, created from net._http_response
--    order by created desc limit 10;
--
--   -- how many photo files are left
--   select count(*) from storage.objects where bucket_id = 'visit-photos';
--
--   -- every night's run, once it has been going a while
--   select * from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'purge-visit-photos')
--    order by start_time desc limit 10;
-- =============================================================================
