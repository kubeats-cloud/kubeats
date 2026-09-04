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
-- EDIT EXACTLY TWO THINGS: the text between the quotes on the two lines marked
-- <<< below. Do not use find-and-replace on this file — the words project_url
-- and service_role_key appear elsewhere as the names the secrets are stored
-- under, and overwriting those breaks the purge in a way you would not notice
-- until a month from now.
--
-- Paste into the Supabase SQL editor, fill the two values in THERE, and run it
-- there. The copy in the repo keeps its placeholders.
--
--   project URL       Dashboard -> Project Settings -> Data API -> Project URL
--                     looks like https://abcdefghijklm.supabase.co
--   service_role key  Dashboard -> Project Settings -> API Keys -> service_role
--                     a long token beginning eyJ
-- -----------------------------------------------------------------------------
do $$
declare
  v_url text := 'paste project URL between these quotes';    -- <<< EDIT THIS LINE
  v_key text := 'paste service_role key between these quotes'; -- <<< EDIT THIS LINE
  v_id  uuid;
begin
  -- Checked by shape rather than by comparing against the placeholder text, so
  -- that a careless find-and-replace cannot switch the guard off along with it.
  v_url := rtrim(btrim(v_url), '/');
  v_key := btrim(v_key);

  if v_url !~ '^https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' then  -- a host, not prose
    raise exception
      'STEP 2: v_url is not a Supabase project URL. Expected https://<ref>.supabase.co';
  end if;

  if v_key !~ '^eyJ' or length(v_key) < 100 then
    raise exception
      'STEP 2: v_key is not a service_role key. Expected a long token beginning eyJ';
  end if;

  -- Update in place when the secret already exists; create_secret rejects a
  -- duplicate name, and this file is meant to be safe to re-run.
  select id into v_id from vault.secrets where name = 'project_url';
  if v_id is null then
    perform vault.create_secret(v_url, 'project_url',
      'Field Ops: Storage API base URL, used by purge_old_visit_photos()');
  else
    perform vault.update_secret(v_id, v_url, 'project_url',
      'Field Ops: Storage API base URL, used by purge_old_visit_photos()');
  end if;

  select id into v_id from vault.secrets where name = 'service_role_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'service_role_key',
      'Field Ops: used only by purge_old_visit_photos()');
  else
    perform vault.update_secret(v_id, v_key, 'service_role_key',
      'Field Ops: used only by purge_old_visit_photos()');
  end if;

  -- Prove the purge function will actually find them, under exactly the names
  -- it looks for. If a rename slipped in, fail here rather than a month from
  -- now when the first photo fails to expire.
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise exception
      'The secrets did not land under the names project_url and service_role_key.';
  end if;
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
