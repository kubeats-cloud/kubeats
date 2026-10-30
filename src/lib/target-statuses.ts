import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/** One target status, with which campus (if any) it is scoped to (0066). */
export interface TargetStatusRow {
  name: string;
  campusId: string | null;
}

/**
 * Admin #8 / Rep #2 — the target-status vocabulary, read.
 *
 * `target_statuses_select` (migration 0047, rewritten by 0066 to add campus
 * scoping) decides which rows come back for each caller — an admin, a team
 * lead supervising a campus-A rep, or a rep on campus A all get a
 * campus-appropriate list with no filter of this function's own, which is
 * what "available to the appropriate Reps" and "displayed ... wherever
 * target statuses are used" both ask for. Deliberately uncached, the same
 * stance `listStatusCatalogue()` takes for institute_statuses: a status an
 * admin adds (or re-scopes) has to be usable on the next request.
 *
 * ONE READ FOR EVERYONE, campus_id included. Unlike institute_statuses'
 * split between `listStatusCatalogue()` (names only, for a picker) and
 * `listStatusRows()` (admin, with usage counts), there is no cheaper shape
 * worth keeping here — a target status carries nothing but a name and a
 * campus, so the campus_id costs nothing to carry even where a caller (the
 * rep's own read-only badges) does not render it.
 */
export async function listTargetStatusRows(): Promise<
  { ok: true; statuses: TargetStatusRow[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("target_statuses")
    .select("name, campus_id")
    .order("name", { ascending: true });

  if (error) {
    logError("target-statuses:list", error);
    return { ok: false };
  }

  return {
    ok: true,
    statuses: (data ?? []).map((row) => ({
      name: row.name as string,
      campusId: (row.campus_id as string | null) ?? null,
    })),
  };
}
