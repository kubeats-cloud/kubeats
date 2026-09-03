/**
 * Reconciling India Post's place names with ours.
 *
 * The PIN lookup returns whatever the postal database holds, which is often the
 * older name — "Bangalore" where our seed says "Bengaluru". Left alone that
 * creates a second city under the same state, splits institutes across two
 * spellings, and quietly breaks the City filter and any per-city reporting.
 *
 * Two defences, applied before anything is created:
 *   1. an alias map, old name -> the name we use
 *   2. case- and whitespace-insensitive matching against what already exists
 *
 * To extend: add a lowercase key to the relevant map. Keys are matched after
 * normalisation, so casing and spacing in the key do not matter.
 */

/** Lowercase, trimmed, internal whitespace collapsed. */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Old or alternative name -> the name this app uses. */
export const CITY_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bombay: "Mumbai",
  madras: "Chennai",
  calcutta: "Kolkata",
  cochin: "Kochi",
  gurgaon: "Gurugram",
  trivandrum: "Thiruvananthapuram",
  pondicherry: "Puducherry",
  baroda: "Vadodara",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  belgaum: "Belagavi",
  vizag: "Visakhapatnam",
  vizagapatnam: "Visakhapatnam",
  visakhapatnamm: "Visakhapatnam",
};

/**
 * States have the same problem, so the same treatment. Not in the brief, but a
 * PIN in Odisha returning "Orissa" would duplicate a state — a worse version of
 * the city bug, since every city under it would be orphaned from the seeded one.
 */
export const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  pondicherry: "Puducherry",
  "nct of delhi": "Delhi",
  "national capital territory of delhi": "Delhi",
  "jammu & kashmir": "Jammu and Kashmir",
  "andaman & nicobar islands": "Andaman and Nicobar Islands",
  "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman & diu": "Dadra and Nagar Haveli and Daman and Diu",
};

function applyAliases(raw: string, aliases: Record<string, string>): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return aliases[normalizeName(cleaned)] ?? cleaned;
}

export function canonicalCityName(raw: string): string {
  return applyAliases(raw, CITY_ALIASES);
}

export function canonicalStateName(raw: string): string {
  return applyAliases(raw, STATE_ALIASES);
}

/**
 * Areas get no alias map — there is no sensible fixed list of localities — but
 * they do get the same tidying, so "MG Road" and "mg  road" are one area.
 */
export function canonicalAreaName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Finds an existing row whose name matches after aliasing and normalisation.
 * Returning the row rather than a boolean means callers reuse the id and the
 * stored spelling, instead of adding a near-duplicate.
 */
export function findExisting<T extends { name: string }>(
  rows: T[],
  candidate: string,
  canonicalise: (value: string) => string,
): T | undefined {
  const key = normalizeName(canonicalise(candidate));
  return rows.find((row) => normalizeName(canonicalise(row.name)) === key);
}
