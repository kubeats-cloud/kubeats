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
