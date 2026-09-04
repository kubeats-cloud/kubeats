-- =============================================================================
-- Field Ops — automatic 30-day photo retention
--
-- Visit photos are proof of attendance, not archive material. They are also the
-- only thing in this app that grows without bound: ~100 KB per visit, twenty
-- reps, five visits a day, is roughly 300 MB a month against a 1 GB tier.
--
-- This file deletes the IMAGE FILES older than the retention window and nothing
-- else. Every visit row keeps its coordinates, its timestamp, its notes and its
-- photo_url. The record of the visit is permanent; only the picture expires.
--
--   NOTE for whatever later screen displays a photo: a visit older than the
--   window still has a photo_url, but the file behind it is gone. Treat a
--   missing object as "photo expired", not as an error.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run. This file only creates objects; it does not schedule
--   anything and does not need any extension to be installed yet.
--   Scheduling is 0004_photo_retention_schedule.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- THE RETENTION WINDOW.
--
-- This is the single place the 30 days is defined. Change the number here, run
-- the file again, and the scheduled job uses the new window on its next run.
-- -----------------------------------------------------------------------------
create or replace function public.visit_photo_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

comment on function public.visit_photo_retention_days is
  'The photo retention window in days. The only definition of it — change it '
  'here and everything that purges photos follows.';


-- -----------------------------------------------------------------------------
-- A small audit trail, so a job that quietly stops working is visible.
-- -----------------------------------------------------------------------------
create table if not exists public.photo_purge_runs (
  id             bigint generated always as identity primary key,
  ran_at         timestamptz not null default now(),
  retention_days integer     not null,
  -- Files found past the window on this run, and delete requests actually sent.
  considered     integer     not null,
  requested      integer     not null
);

comment on table public.photo_purge_runs is
  'One row per run of purge_old_visit_photos(). Read by admins to confirm the '
  'scheduled cleanup is still running.';

alter table public.photo_purge_runs enable row level security;

-- Operational data: admins may look, nobody writes through the API. The purge
-- function writes as its definer, which RLS does not apply to.
drop policy if exists photo_purge_runs_select on public.photo_purge_runs;
create policy photo_purge_runs_select on public.photo_purge_runs
  for select to authenticated
  using (public.is_admin());


-- -----------------------------------------------------------------------------
-- The purge itself.
--
-- Deletion goes through the Storage HTTP API rather than a DELETE against
-- storage.objects. Removing the metadata row on its own would orphan the actual
-- file in object storage: still billed, no longer reachable, impossible to find
-- later. The API removes both.
--
-- pg_net sends those requests asynchronously — it queues each one and returns
-- immediately, so this function reports what it ASKED for, not what completed.
-- That is safe to re-run into: anything that failed is still in storage.objects
-- and gets picked up again tomorrow. See 0004 for how to read the responses.
--
-- SECURITY DEFINER because it reads the service-role key out of Vault. Execute
-- is revoked from every API role below — only the scheduler (postgres) may call
-- it. An admin-facing "flush now" button, when Phase 7 adds one, needs its own
-- narrower wrapper; it must not be given this one.
-- -----------------------------------------------------------------------------
create or replace function public.purge_old_visit_photos()
returns public.photo_purge_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_batch     constant integer := 500;  -- a day's worth is ~100; this is headroom
  v_days      integer := public.visit_photo_retention_days();
  v_url       text;
  v_key       text;
  v_object    record;
  v_considered integer := 0;
  v_requested  integer := 0;
  v_run       public.photo_purge_runs;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise exception
      'Vault is missing project_url or service_role_key — see 0004_photo_retention_schedule.sql, step 2.'
      using errcode = 'FO101';
  end if;

  v_url := rtrim(v_url, '/');

  for v_object in
    select o.name
      from storage.objects o
     where o.bucket_id = 'visit-photos'
       and o.created_at < now() - make_interval(days => v_days)
     order by o.created_at
     limit c_batch
  loop
    v_considered := v_considered + 1;

    -- Paths are '<uuid>/<uuid>.jpg', generated by the app, so there is nothing
    -- in them that needs URL-encoding.
    perform net.http_delete(
      url     => v_url || '/storage/v1/object/visit-photos/' || v_object.name,
      headers => jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'apikey',        v_key
      )
    );

    v_requested := v_requested + 1;
  end loop;

  insert into public.photo_purge_runs (retention_days, considered, requested)
  values (v_days, v_considered, v_requested)
  returning * into v_run;

  return v_run;
end;
$$;

comment on function public.purge_old_visit_photos is
  'Deletes visit photo FILES older than visit_photo_retention_days(), leaving '
  'every visit row untouched. Called by the pg_cron job scheduled in 0004.';

revoke all on function public.purge_old_visit_photos() from public;
revoke all on function public.purge_old_visit_photos() from anon;
revoke all on function public.purge_old_visit_photos() from authenticated;
