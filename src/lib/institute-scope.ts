import "server-only";

import { logError } from "@/lib/errors";

/**
 * What to show when an institute's name did not come back, and why it matters.
 *
 * THE SHAPE OF THE PROBLEM. PostgREST resolves an embedded relation — the
 * `institutes(name)` in a select string — under the CALLER'S row-level
 * security. A row the caller may not read comes back as **null**, not as an
 * error. So once institutes are campus-scoped, a join against one outside the
 * caller's campus silently yields nothing and the app prints "Unknown
 * institute", which reads exactly like a deleted row.
 *
 * A null join cannot LEAK anything — it withholds. The risk runs the other way:
 * it makes a scoping inconsistency invisible — a policy that is not doing what
 * it is meant to, or an institute moved between campuses with visits still
 * pointing at it. That is worth a log line and a different word on screen, not
 * a shrug.
 *
 * MIGRATION 0028 ADDS A SECOND, ORDINARY CAUSE, and it is why the batched
 * lookup no longer goes through here at all. An institute reassigned from rep A
 * to rep B leaves A's past visits with A — `visits` is member-scoped and those
 * rows do not move — but A can no longer read the institute, so every name on
 * A's own history would miss. That is not an inconsistency and there is nothing
 * to investigate; it is the feature working. Logging it would turn one
 * reassignment into a warning on every render of every historical row, and an
 * error log that cries wolf is worse than no log.
 *
 * So `instituteNames()` now asks `institute_names_i_visited()` instead, which
 * answers for exactly those rows. What still reaches this file is the EMBEDDED
 * joins, where a miss really is unexpected — and the label has to cover both
 * causes, since neither the embed nor this function can tell them apart.
 *
 * So: one label, used everywhere, and one place that says so in the log.
 */

/**
 * The label. Deliberately not "Unknown institute", which suggests the row is
 * gone; this says the row exists and is not yours to see.
 *
 * NOT "Not in your campus" any more. After 0028 that is often the wrong reason
 * — the commoner one is an institute reassigned to another rep, which may well
 * still be in this rep's campus. "No longer yours" is true of both, and of the
 * transferred-rep case where it is both at once.
 */
export const INSTITUTE_OUT_OF_SCOPE = "No longer yours";

/**
 * Resolve one institute name, saying so when it could not be resolved.
 *
 * `context` names the caller so a log line points at a query rather than at
 * this file.
 */
export function instituteNameOr(
  name: string | null | undefined,
  context: string,
  instituteId?: string,
): string {
  if (name) return name;
  // Loud rather than silent. Every caller here is reading rows the caller owns,
  // so a missing name is a scoping inconsistency and not an ordinary absence.
  logError(
    `scope:${context}`,
    `institute name unresolved${instituteId ? ` for ${instituteId}` : ""} — ` +
      "the row is not the caller's, is outside their campus, or has been deleted",
  );
  return INSTITUTE_OUT_OF_SCOPE;
}

/**
 * The same, for the batched `instituteNames()` lookups that build a Map.
 *
 * Those fetch names with a separate `.in(ids)` query rather than an embedded
 * join, so an out-of-campus id simply does not come back and the Map lookup
 * misses. Same symptom, same handling.
 */
export function instituteNameFrom(
  names: Map<string, string>,
  instituteId: string,
  context: string,
): string {
  return instituteNameOr(names.get(instituteId), context, instituteId);
}
