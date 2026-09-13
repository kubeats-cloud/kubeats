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

/** The longest label the stamp can carry on a narrow photo. */
export const MAX_LABEL_LENGTH = 80;

/**
 * Locality, settlement, region → one label. THE ONLY PLACE A LABEL IS BUILT.
 *
 * Both providers end here, and that is the whole point of it being its own
 * function. `formatPlace` reads Nominatim's keys and `formatMapplsPlace` reads
 * Mappls's; they disagree about what the fields are called and agree about
 * nothing else, so the shape of the answer has to be decided in one place or
 * the stamp starts looking different depending on which service happened to
 * reply. Whatever a caller downstream already copes with, it keeps coping with.
 *
 * Duplicates are dropped — in a city district the suburb and the city are often
 * the same word, and "Bopal, Bopal, Gujarat" reads like a bug.
 */
export function joinPlaceParts(
  parts: readonly (string | null | undefined)[],
): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part?.trim();
    if (!trimmed) continue;
    if (kept.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    kept.push(trimmed);
  }

  if (kept.length === 0) return null;
  return kept.join(", ").slice(0, MAX_LABEL_LENGTH);
}

/**
 * Three parts at most: the closest named thing, the settlement, the state.
 *
 * Nominatim's shape varies by country and by how well mapped a place is, so
 * each part takes the first key that is present rather than assuming one.
 */
export function formatPlace(address: NominatimAddress | null | undefined): string | null {
  if (!address) return null;

  return joinPlaceParts([
    address.neighbourhood ?? address.suburb ?? address.quarter ?? address.village,
    address.town ?? address.city ?? address.city_district ?? address.county,
    address.state ?? address.state_district,
  ]);
}

/**
 * What Mappls gives back, as much of it as we use.
 *
 * EVERY FIELD IS OPTIONAL AND IS TREATED AS SUCH, more carefully than the
 * Nominatim shape above. That one has been exercised against the live service
 * for months; this one is written from Mappls's documented response and cannot
 * be verified here without a paid account, so it reads defensively and any
 * field it does not recognise simply does not contribute. The worst case is a
 * label that is shorter than it could have been, never a throw — and never a
 * visit that cannot be saved, which is the rule everything in this file serves.
 */
export interface MapplsAddress {
  /** The closest named thing: a colony, a block, a named street. */
  street?: string;
  subSubLocality?: string;
  subLocality?: string;
  locality?: string;
  poi?: string;
  /** The settlement. `village` appears on rural answers, `city` on urban. */
  village?: string;
  city?: string;
  subDistrict?: string;
  district?: string;
  /** The region. */
  state?: string;
  pincode?: string;
  formatted_address?: string;
}

/**
 * The same three parts, from Mappls's names for them.
 *
 * WHY THIS AND NOT `formatted_address`. Mappls returns a full postal address,
 * which is genuinely better data and the wrong thing for this job: the stamp
 * has room for roughly eighty characters under the coordinates, and "123,
 * Shivalik Plaza, Nr. IIM, Bopal Road, Bopal, Ahmedabad, Gujarat 380058" is a
 * courier's answer to a question nobody asked. What the stamp wants is where
 * this is, in three words. So the parts are picked and joined exactly as the
 * Nominatim ones are, and a reader cannot tell which service answered — which
 * is the point, because the same visit may be named by either one.
 */
export function formatMapplsPlace(
  address: MapplsAddress | null | undefined,
): string | null {
  if (!address) return null;

  return joinPlaceParts([
    address.subLocality ?? address.subSubLocality ?? address.locality ?? address.street,
    address.city ?? address.village ?? address.district ?? address.subDistrict,
    address.state,
  ]);
}
