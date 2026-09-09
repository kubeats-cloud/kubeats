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
 * it makes a scoping inconsistency invisible. A rep can only hold visits at
 * institutes in their own campus, so if a name is missing on a row they own,
 * something is genuinely wrong — an institute moved between campuses with
 * visits still pointing at it, a rep reassigned, or a policy that is not doing
 * what it is meant to. That is worth a log line and a different word on screen,
 * not a shrug.
 *
 * So: one label, used everywhere, and one place that says so in the log.
 */

/**
 * The label. Deliberately not "Unknown institute", which suggests the row is
 * gone; this says the row exists and is not yours to see.
 */
export const INSTITUTE_OUT_OF_SCOPE = "Not in your campus";

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
      "the row is outside the caller's campus or has been deleted",
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
