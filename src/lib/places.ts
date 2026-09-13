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
 * function. `formatPlace` reads Nominatim's keys and `formatOlaPlace` walks
 * Ola's tagged component list; they disagree about what the fields are even
 * SHAPED like, let alone called, so the shape of the answer has to be decided
 * in one place or the stamp starts looking different depending on which service
 * happened to reply. Whatever a caller downstream already copes with, it keeps
 * coping with — including a row cached under a provider that has since been
 * swapped out, which is why the cache stores the label and not its source.
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
 * One component of an Ola Maps address.
 *
 * Ola's Places API is deliberately Google-Maps-shaped: instead of a flat object
 * with named keys, an address arrives as a LIST of components, each tagged with
 * one or more `types`. So the part we want is found by asking what a component
 * IS, not by reading a key we hope exists.
 */
export interface OlaAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

/** As much of one Ola reverse-geocode result as we use. */
export interface OlaResult {
  address_components?: OlaAddressComponent[];
  /** The full postal address. Deliberately unused; see formatOlaPlace. */
  formatted_address?: string;
}

/**
 * The first component carrying any of `types`, in the order asked for.
 *
 * Order matters and is the caller's: "neighbourhood, else sub-locality" is a
 * different answer from "sub-locality, else neighbourhood", and the preference
 * belongs with the part being built rather than in here.
 */
function componentFor(
  components: readonly OlaAddressComponent[],
  types: readonly string[],
): string | null {
  for (const type of types) {
    const match = components.find((component) => component.types?.includes(type));
    const name = match?.long_name?.trim() ?? match?.short_name?.trim();
    if (name) return name;
  }
  return null;
}

/**
 * The same three parts, from Ola's component list.
 *
 * THE ONLY PLACE OLA'S FIELD NAMES ARE READ. If the live response differs from
 * the documented shape, this function is the entire fix; the chain, the cache,
 * the timeout split and every screen downstream stay exactly as they are. That
 * isolation is the point, and it is the lesson from the provider before this
 * one — where the thing that actually differed from the docs was found in
 * production, not in review.
 *
 * WHY NOT `formatted_address`. Same reason as ever: Ola returns a full postal
 * address, which is better data and the wrong shape for this job. The stamp has
 * about eighty characters under the coordinates, and a courier's answer does
 * not fit. What the stamp wants is where this is, in three words.
 *
 * The type names are Google's vocabulary, which Ola mirrors:
 *   neighborhood / sublocality        the closest named thing
 *   locality                          the settlement
 *   administrative_area_level_2       the district, when there is no locality
 *   administrative_area_level_1       the state
 * `postal_code` and `country` are deliberately ignored: a PIN code is not a
 * place name, and every visit is in the same country.
 */
export function formatOlaPlace(result: OlaResult | null | undefined): string | null {
  const components = result?.address_components;
  if (!Array.isArray(components) || components.length === 0) return null;

  return joinPlaceParts([
    componentFor(components, [
      "neighborhood",
      "sublocality_level_1",
      "sublocality",
      "route",
    ]),
    componentFor(components, ["locality", "administrative_area_level_2"]),
    componentFor(components, ["administrative_area_level_1"]),
  ]);
}
