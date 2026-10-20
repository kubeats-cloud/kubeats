import type { InstituteActivityRow } from "@/lib/institute-activity-counts";

/**
 * Free-text filter for the Rep Institute tab's consolidated table.
 *
 * Local only — the rows are the ones `getInstituteActivityModel` already
 * loaded for the page's date range, so typing does not refetch. This is the
 * one piece of `InstitutesBrowser`'s old filtering this correction pass kept:
 * matching by name/city/area is cheap over a rep's own (short) list. The
 * status/owner/state/area/type dropdowns it also had are not reproduced here
 * — see docs/correction_audit.md for why.
 */
export function institutesMatchingQuery(
  rows: readonly InstituteActivityRow[],
  query: string,
): InstituteActivityRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...rows];
  return rows.filter((row) => {
    const haystack = `${row.name} ${row.city ?? ""} ${row.area ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}
