-- =============================================================================
-- KUbeats — migration 0007: a cache for reverse-geocoded place names
--
-- The photo stamp gains a line under the coordinates: an approximate area name
-- like "Bopal, Ahmedabad, Gujarat", so a photo is readable by a person without
-- pasting numbers into a map. The coordinates stay exactly as they were — the
-- name is an extra line, never a replacement, because the numbers are the part
-- that cannot be argued with.
--
-- The name comes from OpenStreetMap's Nominatim, which is free and asks in
-- return that you identify yourself and do not hammer it. This table is how we
-- keep that promise: one row per rounded coordinate cell, so a team working the
-- same few neighbourhoods asks the service once and then stops asking.
--
-- WHY A TABLE AND NOT pincodes_cache
--   That one is keyed by a six-digit PIN and holds a state, a district and a
--   list of localities. This is keyed by a coordinate cell and holds one label.
--   Same idea, different shape; sharing the table would mean a nullable column
--   for each and a discriminator, which is worse than two small tables.
--
-- THE KEY
--   Coordinates rounded to 4 decimal places, formatted "lat,lon" — about 11
--   metres, which is finer than the area names being cached and coarse enough
--   that a rep standing still does not miss the cache on GPS jitter. The
--   rounding lives in src/lib/places.ts so the route and this table agree.
--
-- IT IS ONLY A CONVENIENCE
--   Nothing depends on this table. If it is empty, missing, or the service is
--   down, photos stamp with coordinates and time and the visit saves as normal.
--   Do not add a NOT NULL anything here.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Safe to re-run.
-- =============================================================================

create table if not exists public.place_cache (
  -- "lat,lon" rounded to 4dp. Text rather than two numerics so the primary key
  -- is the exact string the application computes, with no float comparison.
  cell        text primary key,
  label       text,
  latitude    double precision,
  longitude   double precision,
  cached_at   timestamptz not null default now(),

  constraint place_cache_cell_shape check (cell ~ '^-?[0-9]{1,3}\.[0-9]{1,6},-?[0-9]{1,3}\.[0-9]{1,6}$')
);

-- A miss is worth remembering too: somewhere genuinely unnamed, or a service
-- that had nothing, should not be asked again on every photo. `label` is
-- therefore nullable and a row with a null label means "asked, nothing there".
comment on column public.place_cache.label is
  'Human-readable area name, or null meaning the lookup found nothing.';

create index if not exists place_cache_cached_at_idx
  on public.place_cache (cached_at desc);

alter table public.place_cache enable row level security;

-- The route handler writes this with the service-role key, which bypasses RLS
-- entirely. These policies only cover direct client access — the same split as
-- pincodes_cache in 0001.
drop policy if exists place_cache_select on public.place_cache;
create policy place_cache_select on public.place_cache
  for select to authenticated using (true);

drop policy if exists place_cache_write on public.place_cache;
create policy place_cache_write on public.place_cache
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Check it took:
--
--   select count(*) from public.place_cache;          -- 0, and no error
--   select relrowsecurity from pg_class
--    where oid = 'public.place_cache'::regclass;      -- t
--
-- Finding the area a past visit was logged in, without storing it on the visit
-- (the label is already burned into that visit's photograph):
--
--   select v.id, v.date, p.label
--     from public.visits v
--     left join public.place_cache p
--       on p.cell = round(v.latitude::numeric, 4) || ',' || round(v.longitude::numeric, 4)
--    where v.latitude is not null;
-- -----------------------------------------------------------------------------
