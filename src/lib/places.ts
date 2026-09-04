/**
 * Turning coordinates into an approximate area name.
 *
 * The photo stamp already carries latitude, longitude and a timestamp. Those
 * are the record. This adds a line a person can read without a map — "Bopal,
 * Ahmedabad, Gujarat" — and it is strictly decoration: everything here is
 * allowed to fail, and the caller carries on without it.
 *
 * Shared by the route handler and its tests so the cache key is computed in
 * exactly one place. The `place_cache` table's CHECK constraint (0007) is
 * written against `cellFor`'s output.
 */

/**
 * Four decimal places, about 11 metres. Finer than any name we are caching and
 * coarse enough that a rep standing still does not miss the cache every time
 * the GPS twitches.
 */
export const CELL_PRECISION = 4;

export function cellFor(latitude: number, longitude: number): string {
  return `${latitude.toFixed(CELL_PRECISION)},${longitude.toFixed(CELL_PRECISION)}`;
}

/** What Nominatim gives back, as much of it as we use. */
export interface NominatimAddress {
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  village?: string;
  town?: string;
  city_district?: string;
  city?: string;
  county?: string;
  state_district?: string;
  state?: string;
  country?: string;
}

/**
 * Three parts at most: the closest named thing, the settlement, the state.
 *
 * Nominatim's shape varies by country and by how well mapped a place is, so
 * each part takes the first key that is present rather than assuming one.
 * Duplicates are dropped — in a city district the suburb and the city are often
 * the same word, and "Bopal, Bopal, Gujarat" reads like a bug.
 */
export function formatPlace(address: NominatimAddress | null | undefined): string | null {
  if (!address) return null;

  const locality =
    address.neighbourhood ?? address.suburb ?? address.quarter ?? address.village;
  const settlement =
    address.town ?? address.city ?? address.city_district ?? address.county;
  const region = address.state ?? address.state_district;

  const parts: string[] = [];
  for (const part of [locality, settlement, region]) {
    const trimmed = part?.trim();
    if (!trimmed) continue;
    if (parts.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    parts.push(trimmed);
  }

  if (parts.length === 0) return null;
  // Long enough to be useful, short enough to fit the stamp on a narrow photo.
  return parts.join(", ").slice(0, 80);
}
