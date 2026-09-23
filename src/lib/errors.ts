/**
 * Turning failures into something a rep standing in a school corridor can act
 * on.
 *
 * Nothing here ever passes a raw error through to the UI. Database messages,
 * SQL fragments and stack traces stay in the server log; the user gets a plain
 * sentence. Anything we cannot recognise becomes the generic fallback rather
 * than leaking its text.
 */

export const GENERIC_ERROR =
  "Something went wrong. Please try again in a moment.";

/**
 * What a database that is behind its app looks like to whoever hit it.
 *
 * Deliberately NOT "please try again": retrying is the one thing that cannot
 * help, and saying so is what stops an afternoon being spent on the client
 * instead of on the migration. See the two codes that map to it below.
 */
export const DATABASE_BEHIND =
  "This part of the app is newer than the database it is talking to. " +
  "A database update has not been applied yet — please tell your admin. " +
  "Retrying will not help.";

/**
 * Postgres and PostgREST codes we can say something specific and useful about.
 * Everything else falls through to GENERIC_ERROR on purpose.
 */
const CODE_MESSAGES: Record<string, string> = {
  // Postgres
  "23505": "That already exists.",
  "23503": "Something this depends on is missing, or it is still in use.",
  "23514": "That is not allowed. Please check the details and try again.",
  "42501": "You do not have permission to do that.",
  /*
   * THE APP IS NEWER THAN ITS DATABASE, and this is the one failure that has to
   * name itself.
   *
   * 42703 is "column does not exist" on a READ; PGRST204 is "could not find the
   * column in the schema cache" on a WRITE. Neither can be caused by anything a
   * user typed. Both mean exactly one thing: a build has shipped that expects a
   * migration nobody has applied yet.
   *
   * Left to the generic fallback they read as "we could not add that purpose",
   * which is indistinguishable from a network blip and sent a real pre-go-live
   * re-test hunting a React bug instead. Several migrations in this repo are
   * DEPLOY-COUPLED on purpose (CLAUDE.md marks 0027 in particular), so this is a
   * state the project deliberately allows itself to reach for a few minutes —
   * and a few minutes is exactly when somebody needs to be told which half is
   * behind rather than being shown a shrug.
   *
   * It names the admin rather than the fix because a rep cannot apply a
   * migration, and it leaks nothing: the column name stays in the server log
   * where logError puts it.
   */
  "42703": DATABASE_BEHIND,
  /*
   * FO027 — a member deletion that was refused (migration 0032).
   *
   * The code covers four cases the RPC checks for itself: deleting yourself,
   * deleting the last admin, a member who has already gone, and an owned
   * institute carrying another member's work. `deleteMember()` checks all four
   * in TypeScript BEFORE it calls the function, so in practice an admin reads a
   * sentence written here in the app — one that can name the institutes in the
   * way, which is the only part they can act on.
   *
   * This entry is what the fourth case falls back to when the RPC raises
   * anyway: two admins acting at once, or a visit logged in the gap between the
   * pre-check and the call. Generic, and deliberately so — the database's own
   * wording is never what reaches a screen.
   */
  FO027: "That member could not be deleted. Nothing was changed.",
  /*
   * FO028 — a created_by that was refused (migration 0034).
   *
   * Covers three cases: a non-admin writing the column, a self-parent, and a
   * created_by pointing at a rep. `setMemberCreator()` checks the last two
   * itself and phrases them better, so this is the fallback for a race or a
   * hand-made request — and, like FO027, it is deliberately generic, because
   * the database's own wording is never what reaches a screen.
   */
  FO028: "That could not be recorded. Nothing was changed.",
  /*
   * FO029 — a campus correction that was refused (migration 0035).
   *
   * Five cases: no member, no campus, the target is an admin (who has no
   * campus by FO021), the campus is inactive, and — the one an admin will
   * actually meet — the rep is part-way through a visit.
   *
   * `updateMember()` maps that last one on its own with a sentence naming the
   * remedy, because "wait until they have finished" is something the admin can
   * act on and "nothing was changed" is not. This entry is what the other four
   * fall back to.
   */
  FO029: "That campus could not be changed. Nothing was changed.",
  // PostgREST
  PGRST116: "We could not find that.",
  PGRST204: DATABASE_BEHIND,
  PGRST205: "The app is not fully set up yet. Please contact your admin.",
  PGRST301: "Your session has expired. Please sign in again.",
};

/** Network and timeout failures deserve their own wording — they are retryable. */
const OFFLINE_HINT =
  "We could not reach the server. Check your connection and try again.";

function codeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function looksOffline(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    name.includes("Fetch") ||
    codeOf(error) === "ECONNREFUSED"
  );
}

/**
 * The one function the UI should call. `fallback` lets a caller phrase the
 * generic case in context, e.g. "We could not load your institutes."
 */
export function toFriendlyMessage(error: unknown, fallback = GENERIC_ERROR): string {
  const code = codeOf(error);
  if (code && code in CODE_MESSAGES) return CODE_MESSAGES[code];
  if (looksOffline(error)) return OFFLINE_HINT;
  return fallback;
}

/**
 * Server-side logging. Records enough to debug — code, message, context — and
 * nothing that would identify a person beyond the ids we already store.
 */
export function logError(context: string, error: unknown): void {
  const code = codeOf(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  console.error(`[${context}]`, code ? `${code}: ${message}` : message);
}

/**
 * One fetch on a page that gathers several, made unable to take the page down.
 *
 * WHAT THIS IS FOR. The two screens a person lands on after signing in — the
 * Dashboard and Settings — each gather six or seven things in one
 * `Promise.all`. Every one of those helpers already degrades politely when the
 * database answers with an ERROR: a seeded catalogue, an empty list, an
 * `{ ok: false }`. None of them survives a REJECTION, and `Promise.all` rejects
 * as a whole the moment any single promise does. So one dropped connection
 * while fetching, say, the campus list would throw away the plan, the
 * institutes, the purposes and the week's figures along with it, and show the
 * error boundary instead of the screen.
 *
 * Wrapping each one turns that into a panel's worth of loss rather than a
 * screen's. The caller supplies the same fallback the helper would have
 * returned by itself, so a rejection and a database error now look identical
 * to everything downstream — which is what makes this safe to add without
 * touching how any page reads its data.
 *
 * IT CHANGES NOTHING WHEN NOTHING GOES WRONG. On the happy path this is one
 * `await` and a returned value.
 *
 * NOT FOR WRITES. A failed write must reach the person who made it, as a
 * sentence they can act on; quietly substituting a fallback would tell them
 * their work was saved when it was not. This is for reads that decorate a
 * page, and `context` is what makes the log line say which one went missing.
 */
export async function settled<T>(
  work: Promise<T>,
  fallback: T,
  context: string,
): Promise<T> {
  try {
    return await work;
  } catch (error) {
    logError(context, error);
    return fallback;
  }
}
