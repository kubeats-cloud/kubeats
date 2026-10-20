import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/**
 * Admin #8 / Rep #2 — the target-status vocabulary, read.
 *
 * `target_statuses_select` (migration 0045) is `using (true)` for every
 * signed-in role, so this applies no filter of its own: an admin, a team
 * lead and a rep all get the same list back, which is what "available to
 * the appropriate Reps" and "displayed ... wherever target statuses are
 * used" both ask for. Deliberately uncached, the same stance
 * `listStatusCatalogue()` takes for institute_statuses: a status an admin
 * adds has to be usable on the next request.
 */
export async function listTargetStatuses(): Promise<
  { ok: true; statuses: string[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("target_statuses")
    .select("name")
    .order("name", { ascending: true });

  if (error) {
    logError("target-statuses:list", error);
    return { ok: false };
  }

  return { ok: true, statuses: (data ?? []).map((row) => row.name as string) };
}
