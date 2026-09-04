-- =============================================================================
-- Field Ops — plain-Postgres compatibility prelude
--
-- NOT FOR SUPABASE. Hosted and self-hosted Supabase both provide everything
-- below already; running this there would shadow the real thing and break
-- authentication. It exists for one purpose: to prove — and to allow — the
-- schema to be rebuilt on a stock Postgres server, for a client who wants their
-- own database without the rest of the Supabase stack.
--
-- Everything here is a stand-in for something Supabase supplies. That is the
-- point of the file: it is the complete list of what this application's schema
-- borrows from its host, and it is short.
--
--   the four roles          Supabase's anon / authenticated / service_role
--   auth.users              the account table our profiles hang off
--   auth.uid()              the signed-in user, read from a session setting
--   storage.buckets/objects the file metadata the photo policies reference
--   storage.foldername()    splits an object path, used by those policies
--
-- With this applied first, 0001–0003 run unchanged. 0004 does not, and cannot:
-- it schedules a job with pg_cron and calls the Storage HTTP API through pg_net
-- and Vault. On plain Postgres, photo retention has to be a cron job on the
-- host instead — see docs/BACKUP-RESTORE.md.
--
-- HOW TO RUN
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/compat/plain-postgres-prelude.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
--   ...then 0002 and 0003.
-- =============================================================================

-- The roles every policy in 0001 is granted to.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- Accounts. Supabase's real auth.users has far more columns; these are the ones
-- this application's schema actually references.
create table if not exists auth.users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  created_at  timestamptz not null default now()
);

/**
 * The signed-in user.
 *
 * Supabase derives this from the request's JWT. Here it is read from a session
 * setting, so an application connecting directly to Postgres must set it per
 * connection — `set local request.jwt.claim.sub = '<user id>'` — before any
 * query that RLS applies to. Returning NULL when unset matches Supabase's
 * behaviour for an anonymous request, which every policy already handles.
 */
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Storage metadata. The photo policies in 0001 are written against these.
create table if not exists storage.buckets (
  id         text primary key,
  name       text not null,
  public     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id) on delete cascade,
  name        text not null,
  owner       uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  metadata    jsonb
);

alter table storage.objects enable row level security;

/** Splits 'user-id/photo.jpg' into its path segments, as Supabase does. */
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant all on storage.objects, storage.buckets to service_role;
