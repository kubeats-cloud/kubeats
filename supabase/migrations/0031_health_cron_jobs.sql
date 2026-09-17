-- =============================================================================
-- KUbeats - migration 0031: let the health check see whether cron is scheduled
--
-- APPLY THIS AT ANY TIME, BEFORE OR AFTER ITS DEPLOY. It adds one read-only
-- function and changes nothing that exists. The route that calls it treats the
-- function being absent as "could not tell" rather than as a failure, so the
-- app behaves identically on a database that has never seen this file.
--
-- WHY IT IS NEEDED AT ALL
--
-- /api/health's token-gated answer is what an external monitor polls, and the
-- thing worth alerting on is a PARTIAL failure: the Worker serving happily
-- while something behind it has stopped. Two of this app's rules are not code
-- at all, they are pg_cron jobs:
--
--   purge-visit-photos    0004. Deletes visit photographs past the retention
--                         window. If it stops, the storage bucket grows without
--                         limit and photographs outlive the promise made about
--                         them in /privacy.
--   sweep-open-checkins   0018. Closes a check-in left open overnight. If it
--                         stops, a rep who forgot to finish a visit is still
--                         "checked in" the next morning and FO013 refuses them
--                         every other institute — one forgotten tap and their
--                         day is over.
--
-- Neither failure shows up anywhere. No screen goes red, no request 500s, and
-- the symptom arrives days later as "the app will not let me check in". A
-- monitor can only notice if something tells it, and nothing could: `cron.job`
-- lives in the `cron` schema, which PostgREST does not expose, so the route had
-- no way to ask.
--
-- WHY A FUNCTION RATHER THAN EXPOSING THE SCHEMA. Exposing `cron` to PostgREST
-- would publish every job, its command text and its schedule to anything that
-- could reach the API. This answers one question about two named jobs and
-- nothing else.
--
-- SECURITY DEFINER, GRANTED TO service_role ALONE. It reads a catalogue an
-- ordinary role cannot, so it must be DEFINER; the grant is what keeps that
-- from being a hole. `anon` and `authenticated` are revoked explicitly rather
-- than left to default, for the reason 0011 and 0027 both give: a blanket grant
-- from 0001 cannot reach a table that did not exist then, but a function is
-- created with EXECUTE granted to PUBLIC, so saying nothing here would publish
-- it. The health route is the only caller and it uses the service-role key.
--
-- language plpgsql, NOT sql, AND THAT IS DELIBERATE. An SQL function body is
-- parsed when it is created, so `cron.job` would have to exist at that moment —
-- and this file would fail to apply on a database where pg_cron is not
-- installed. A plpgsql body is resolved when it RUNS, so this always applies,
-- and the "no pg_cron here" case arrives at the route as an error it already
-- knows how to report as "unknown".
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Idempotent: safe to run twice.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The one question, and only about the two jobs this app schedules
-- -----------------------------------------------------------------------------
create or replace function public.health_cron_jobs()
returns table (jobname text, active boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  -- Named explicitly rather than returning everything: a job somebody else
  -- scheduled is not this app's business, and its command text is not something
  -- to hand out over HTTP.
  return query
    select j.jobname::text, j.active
      from cron.job j
     where j.jobname in ('purge-visit-photos', 'sweep-open-checkins');
end;
$$;

-- Created with EXECUTE to PUBLIC by default, so this is not tidying.
revoke all on function public.health_cron_jobs() from public;
revoke all on function public.health_cron_jobs() from anon;
revoke all on function public.health_cron_jobs() from authenticated;
grant execute on function public.health_cron_jobs() to service_role;

comment on function public.health_cron_jobs is
  'Whether this app''s two pg_cron jobs are scheduled and active, for the '
  'token-gated half of /api/health. Returns one row per job FOUND, so an empty '
  'result means neither is scheduled. service_role only: it reads a catalogue '
  'an ordinary role cannot see, and the job command text is not public.';


-- -----------------------------------------------------------------------------
-- 2. Prove it landed
-- -----------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  scheduled integer;
begin
  if to_regprocedure('public.health_cron_jobs()') is null then
    problems := problems || 'health_cron_jobs() was not created';
  end if;

  -- It must NOT be callable by a signed-in user, let alone a stranger.
  if has_function_privilege('anon', 'public.health_cron_jobs()', 'execute')
     or has_function_privilege('authenticated', 'public.health_cron_jobs()', 'execute')
  then
    problems := problems
      || 'health_cron_jobs() is executable by anon or authenticated - it must be service_role only';
  end if;

  if not has_function_privilege('service_role', 'public.health_cron_jobs()', 'execute') then
    problems := problems || 'health_cron_jobs() is not executable by service_role, so the health route cannot call it';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Migration 0031 did not fully apply: %', array_to_string(problems, '; ');
  end if;

  -- REPORTED, NOT ENFORCED. A database where the jobs are not scheduled is
  -- exactly what this function exists to surface, so refusing to apply here
  -- would be refusing to install the smoke alarm because there is smoke.
  select count(*) into scheduled from public.health_cron_jobs() where active;
  if scheduled = 2 then
    raise notice 'health_cron_jobs() installed. Both jobs are scheduled and active.';
  else
    raise notice
      'health_cron_jobs() installed. WARNING: % of 2 jobs are scheduled and active - '
      'apply 0004 (purge-visit-photos) and 0018 (sweep-open-checkins), then re-check.',
      scheduled;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. Check it took
--
--   select * from public.health_cron_jobs();
--
--   -- ...and what the monitor will see. "cron":"ok" needs both rows active.
--   curl -s -H "x-health-token: $TOKEN" https://<host>/api/health
-- -----------------------------------------------------------------------------
