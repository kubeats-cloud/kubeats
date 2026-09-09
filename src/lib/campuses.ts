import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import type { Campus } from "@/lib/campus-display";

// Re-exported so a SERVER caller still has one import for the whole idea. The
// definitions live in campus-display.ts because two client components need
// them and this module is server-only.
export { campusLabel, type Campus } from "@/lib/campus-display";

/**
 * The university's own campuses — the places reps work FROM.
 *
 * NOT the same thing as `public.institutes`, which is the pipeline of prospect
 * schools they work ON. The two are easy to conflate because both are
 * "institutions"; the distinction is load-bearing, and migration 0020a's header
 * spells out what went wrong if they were merged.
 *
 * A rep belongs to exactly one campus and sees only its data. An admin belongs
 * to none and sees every campus — which is why `campus_id` is nullable on
 * `profiles` and why `my_campus()` returns null for them.
 *
 * The list itself is readable by everyone signed in, deliberately: a rep needs
 * their own campus's NAME to see it on screen, and five rows of the employer's
 * own premises carry no institute, visit or member data.
 */


/**
 * The campuses an admin may assign somebody to.
 *
 * Inactive ones are excluded rather than deleted — the demo campus exists so
 * the demonstration rows have a home that is not one of the five, and nobody
 * should be posted to it by accident.
 */
export async function listCampuses(
  includeInactive = false,
): Promise<Campus[]> {
  const supabase = await createClient();
  let query = supabase
    .from("campuses")
    .select("id, name, city, short_name, active")
    .order("city")
    .order("name");
  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) {
    logError("campuses:list", error);
    return [];
  }
  return data ?? [];
}

/** One campus by id, for a badge or a heading. Null when it is not there. */
export async function getCampus(id: string | null): Promise<Campus | null> {
  if (!id) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campuses")
    .select("id, name, city, short_name, active")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logError("campuses:get", error);
    return null;
  }
  return data ?? null;
}

