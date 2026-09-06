import { createClient } from "@/lib/supabase/server";
import { cellFor } from "@/lib/places";
import { logError } from "@/lib/errors";

/**
 * Reading area names back out of the shared cache, for screens that show a
 * position somebody else captured.
 *
 * READ ONLY, and that is the point. `/api/place` is the only thing that may ask
 * OpenStreetMap; this just looks at what that already learned. An admin opening
 * a report with fifty rows on it must not turn into fifty requests to a free
 * service that asks us politely not to do exactly that.
 *
 * So a miss here is ordinary, not an error: it means nobody has ever looked up
 * that square. The caller says "Area unavailable" and shows the coordinates,
 * which were always the actual record. It never falls back to the institute —
 * see location-display.ts for why that matters more than it looks.
 *
 * This is the recovery path migration 0007 describes at its foot, and the
 * reason the area name is deliberately not a column on `visits`: it is already
 * burned into that visit's photograph, and `place_cache` can be joined on the
 * rounded coordinates whenever a screen wants to say it in words. A column
 * would be a third copy of one fact.
 */

export interface Point {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}

/**
 * Area names for many positions at once, keyed by `cellFor(lat, lng)`.
 *
 * One query for the whole page rather than one per row. A cell that was never
 * looked up is simply absent from the map; a cell that was looked up and found
 * nothing is present with a null, which is a different fact and is kept
 * distinct on purpose.
 */
export async function areasFor(points: Point[]): Promise<Map<string, string | null>> {
  const cells = new Set<string>();
  for (const point of points) {
    const { latitude, longitude } = point;
    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }
    cells.add(cellFor(latitude, longitude));
  }

  const found = new Map<string, string | null>();
  if (cells.size === 0) return found;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("place_cache")
    .select("cell, label")
    .in("cell", [...cells]);

  if (error) {
    // Decoration failing must not take a page down with it. The coordinates
    // still render; the area line says it is unavailable.
    logError("place-cache:read", error);
    return found;
  }

  for (const row of data ?? []) {
    found.set(row.cell as string, (row.label as string | null) ?? null);
  }
  return found;
}

/** The area name for one position, or null when nobody has looked it up. */
export async function areaFor(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Promise<string | null> {
  const found = await areasFor([{ latitude, longitude }]);
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  return found.get(cellFor(latitude, longitude)) ?? null;
}
