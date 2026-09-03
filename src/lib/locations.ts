import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/errors";

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
type Admin = ReturnType<typeof createAdminClient>;

const UNIQUE_VIOLATION = "23505";

async function ensureRow(
  db: Admin,
  table: "location_states" | "location_cities",
  match: Record<string, string>,
): Promise<string | null> {
  const existing = await db
    .from(table)
    .select("id")
    .match(match)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;

  const inserted = await db.from(table).insert(match).select("id").single();
  if (!inserted.error) return inserted.data.id;

  if (inserted.error.code === UNIQUE_VIOLATION) {
    const retry = await db.from(table).select("id").match(match).maybeSingle();
    return retry.data?.id ?? null;
  }

  logError(`locations:${table}`, inserted.error);
  return null;
}

export async function ensureState(db: Admin, name: string) {
  return ensureRow(db, "location_states", { name });
}

export async function ensureCity(db: Admin, stateId: string, name: string) {
  return ensureRow(db, "location_cities", { state_id: stateId, name });
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
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];

  if (unique.length > 0) {
    const { error } = await db
      .from("location_areas")
      .upsert(
        unique.map((name) => ({ city_id: cityId, name })),
        { onConflict: "city_id,name", ignoreDuplicates: true },
      );
    if (error) logError("locations:areas", error);
  }

  const { data, error } = await db
    .from("location_areas")
    .select("id, name")
    .eq("city_id", cityId)
    .order("name");

  if (error) {
    logError("locations:areas:read", error);
    return [];
  }
  return data ?? [];
}
