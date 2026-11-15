/**
 * A campus as a screen needs it, with no server in the way.
 *
 * Deliberately separate from `campuses.ts`, which is `server-only` because it
 * opens a Supabase client. Two client components — the add-rep form and the
 * material upload form — need the shape and the label, and importing them from
 * the server module pulls `next/headers` into the browser bundle, which the
 * build refuses outright rather than shipping.
 *
 * So: the type and the one pure function live here; the queries stay there.
 * `campuses.ts` re-exports these, so a server caller still has one import.
 */

export interface Campus {
  id: string;
  name: string;
  city: string;
  short_name: string | null;
  active: boolean;
}

/**
 * How a campus reads in a picker.
 *
 * Four of the five name their own city ("… Bangalore Campus"), so appending it
 * would stutter. The one that does not gets it appended, which is the whole
 * reason this is a function rather than `campus.name`.
 */
export function campusLabel(campus: Campus): string {
  return campus.name.includes(campus.city)
    ? campus.name
    : `${campus.name} · ${campus.city}`;
}

/**
 * The campus a URL is allowed to filter by, or nothing at all.
 *
 * A DISPLAY FILTER AND NOT A PERMISSION CHECK — RLS already decided which rows
 * exist. This answers the narrower question the control has to answer: is the
 * value in the URL one this reader can see and clear? An admin gets any listed
 * campus back; a team lead or rep has a one-entry list, so a link carrying a
 * different campus resolves to "all" for them rather than to a filter they
 * cannot see, cannot clear, and would read as an empty table.
 *
 * Pure and in this module so both the server pages and the client control use
 * one rule. The list itself is `permittedCampuses()` in campuses.ts.
 */
export function resolveCampusFilter(
  campuses: Campus[],
  requested: string | undefined,
): string | undefined {
  if (!requested) return undefined;
  return campuses.some((campus) => campus.id === requested)
    ? requested
    : undefined;
}
