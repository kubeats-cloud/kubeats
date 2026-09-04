import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/errors";
import {
  canonicalAreaName,
  canonicalCityName,
  canonicalStateName,
  findExisting,
  normalizeName,
} from "@/lib/location-names";

/**
 * The State -> City -> Area tree.
 *
 * Small enough to hand to the browser whole — 36 states and 85 cities seeded,
 * and areas only accumulate as reps and PIN lookups add them. Loading it in one
 * go keeps the cascading picker instant with no round trip per level, which
 * matters on a phone with patchy reception in a school corridor.
 */

export interface AreaNode {
  id: string;
  name: string;
}
export interface CityNode {
  id: string;
  name: string;
  areas: AreaNode[];
}
export interface StateNode {
  id: string;
  name: string;
  cities: CityNode[];
}

export async function getLocationTree(): Promise<StateNode[]> {
  const supabase = await createClient();

  const [states, cities, areas] = await Promise.all([
    supabase.from("location_states").select("id, name").order("name"),
    supabase.from("location_cities").select("id, name, state_id").order("name"),
    supabase.from("location_areas").select("id, name, city_id").order("name"),
  ]);

  if (states.error || cities.error || areas.error) {
    logError("locations", states.error ?? cities.error ?? areas.error);
    return [];
  }

  const areasByCity = new Map<string, AreaNode[]>();
  for (const a of areas.data ?? []) {
    const list = areasByCity.get(a.city_id) ?? [];
    list.push({ id: a.id, name: a.name });
    areasByCity.set(a.city_id, list);
  }

  const citiesByState = new Map<string, CityNode[]>();
  for (const c of cities.data ?? []) {
    const list = citiesByState.get(c.state_id) ?? [];
    list.push({ id: c.id, name: c.name, areas: areasByCity.get(c.id) ?? [] });
    citiesByState.set(c.state_id, list);
  }

  return (states.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    cities: citiesByState.get(s.id) ?? [],
  }));
}

/**
 * Find-or-create helpers used by the PIN lookup.
 *
 * These run on the service-role client because a PIN lookup may need to create
 * a state or city, and rule 11 only opens up *areas* to non-admins. The unique
 * constraints make the create step racy under concurrency, so a duplicate-key
 * result is treated as "someone else just made it" and re-read rather than
 * failing the request.
 */
/**
 * Either Supabase client fits here, and which one a caller passes is a
 * deliberate choice. The PIN lookup passes the service-role client because a
 * rep may trigger a state or city insert that RLS would refuse. The admin
 * screens pass the admin's own session client, so the RLS policy keyed on
 * is_admin() stays a second line of defence behind their own check.
 */
type Admin = SupabaseClient;

const UNIQUE_VIOLATION = "23505";

export interface NamedRow {
  id: string;
  name: string;
}

/**
 * Find-or-create, matched leniently and created canonically.
 *
 * The lookup compares against every existing row after aliasing and
 * normalising, so "Bangalore" finds the seeded "Bengaluru" instead of adding a
 * second city. Only a genuinely new place is inserted, and then under the
 * canonical spelling.
 *
 * Returns the *stored* name, never the caller's. Handing back the raw input
 * would let a caller display "Bangalore" against Bengaluru's id — and since
 * institutes store city as free text, that spelling would be written straight
 * back into the data the alias map exists to keep consistent.
 */
async function ensureNamed(
  db: Admin,
  table: "location_states" | "location_cities",
  scope: Record<string, string>,
  rawName: string,
  canonicalise: (value: string) => string,
): Promise<NamedRow | null> {
  const canonical = canonicalise(rawName);

  const existing = await db.from(table).select("id, name").match(scope);
  if (existing.error) {
    logError(`locations:${table}:read`, existing.error);
    return null;
  }

  const match = findExisting(existing.data ?? [], canonical, canonicalise);
  if (match) return { id: match.id, name: match.name };

  const inserted = await db
    .from(table)
    .insert({ ...scope, name: canonical })
    .select("id, name")
    .single();
  if (!inserted.error) return inserted.data;

  // Someone inserted the same name between our read and write.
  if (inserted.error.code === UNIQUE_VIOLATION) {
    const retry = await db
      .from(table)
      .select("id, name")
      .match({ ...scope, name: canonical })
      .maybeSingle();
    return retry.data ?? null;
  }

  logError(`locations:${table}`, inserted.error);
  return null;
}

export async function ensureState(db: Admin, name: string) {
  return ensureNamed(db, "location_states", {}, name, canonicalStateName);
}

export async function ensureCity(db: Admin, stateId: string, name: string) {
  return ensureNamed(
    db,
    "location_cities",
    { state_id: stateId },
    name,
    canonicalCityName,
  );
}

/**
 * Adds any missing areas for a city and returns the full current list, so the
 * caller can hand the browser something to select from immediately.
 */
export async function ensureAreas(
  db: Admin,
  cityId: string,
  names: string[],
): Promise<AreaNode[]> {
  const current = await db
    .from("location_areas")
    .select("id, name")
    .eq("city_id", cityId)
    .order("name");

  if (current.error) {
    logError("locations:areas:read", current.error);
    return [];
  }

  // Case- and spacing-insensitive, so "MG Road" and "mg  road" stay one area —
  // the same reasoning as cities, one level down.
  const seen = new Set(
    (current.data ?? []).map((a) => normalizeName(canonicalAreaName(a.name))),
  );

  const toInsert: { city_id: string; name: string }[] = [];
  for (const raw of names) {
    const name = canonicalAreaName(raw);
    if (!name) continue;
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push({ city_id: cityId, name });
  }

  if (toInsert.length === 0) return current.data ?? [];

  const { error } = await db
    .from("location_areas")
    .upsert(toInsert, { onConflict: "city_id,name", ignoreDuplicates: true });
  if (error) logError("locations:areas", error);

  const refreshed = await db
    .from("location_areas")
    .select("id, name")
    .eq("city_id", cityId)
    .order("name");

  if (refreshed.error) {
    logError("locations:areas:reread", refreshed.error);
    return current.data ?? [];
  }
  return refreshed.data ?? [];
}
