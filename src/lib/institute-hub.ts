import { todayISO } from "@/lib/dates";
import type { VisitSummary } from "@/lib/institutes";

/**
 * The institute hub's derived facts.
 *
 * PURE, AND DERIVED FROM ROWS THE PAGE ALREADY HAS. `/institutes/[id]` already
 * fetches the whole visit history — `getInstituteVisits()` even joins the
 * member names — so everything here is arithmetic over an array that is
 * already in memory. Nothing in this file queries anything, and adding a query
 * to it would be the wrong instinct: a count that disagrees with the list
 * printed under it is worse than no count.
 *
 * ⚠ EVERY VISIT-DERIVED FIGURE IS AS SCOPED AS THE CALLER IS.
 * `getInstituteVisits()` is scoped by RLS (`member = auth.uid() or is_admin()`),
 * so an ADMIN gets the whole team's visits and a REP gets only their own. The
 * numbers below are therefore complete for an admin and partial for a rep —
 * which is fine as long as the screen says whose they are, and is how a rep
 * ends up believing a school nobody has touched has been visited three times
 * if it does not. The page labels them by role for exactly this reason.
 */

const DAY_MS = 86_400_000;

/** Parses YYYY-MM-DD as UTC midnight — the same shape weeks.ts uses. */
function parseISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whole days between two YYYY-MM-DD dates, or null if either is unreadable.
 *
 * UTC midnight on both sides, so the subtraction cannot be bitten by a daylight
 * shift — the same reason `weeks.ts` does its arithmetic in UTC while borrowing
 * dates.ts only for the spelling.
 */
export function daysBetweenISO(from: string, to: string): number | null {
  const a = parseISO(from);
  const b = parseISO(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/* ------------------------------------------------------------------ */
/* The counts header                                                   */
/* ------------------------------------------------------------------ */

export interface InstituteCounts {
  /** Visits VISIBLE TO THE CALLER — see the scoping warning above. */
  visits: number;
  /** The most recent visit date, or null when there are none. */
  lastVisit: string | null;
  /**
   * Days the institute has been at its current status.
   *
   * Null when `status_updated_at` is null, which is a real state rather than a
   * gap: an institute registered and never visited has no status, and one whose
   * status was set before history was kept has no timestamp for it either.
   *
   * NOT scoped, unlike the two above — `institutes.status_updated_at` is a
   * column on the institute row, so it is the same number for everyone who can
   * see the institute at all.
   */
  daysAtStatus: number | null;
}

/**
 * The three numbers at the top of the institute hub.
 *
 * `status_updated_at` is a timestamp and "today" is a calendar day in
 * Asia/Kolkata, so the two are reconciled by asking `todayISO()` what day the
 * timestamp fell on — the app's single definition of a day, injectable exactly
 * so this kind of conversion does not need a second one. Reading the day off
 * the runtime's own clock is what made the app and `app_today()` disagree
 * before (see dates.ts), and this is the same trap one table over.
 */
export function instituteCounts(
  visits: readonly VisitSummary[],
  statusUpdatedAt: string | null,
  now: Date = new Date(),
): InstituteCounts {
  // The history arrives newest first, but a count that depends on the caller's
  // sort order is a count waiting to be wrong.
  let lastVisit: string | null = null;
  for (const visit of visits) {
    if (!lastVisit || visit.date > lastVisit) lastVisit = visit.date;
  }

  const daysAtStatus = statusUpdatedAt
    ? daysBetweenISO(todayISO(new Date(statusUpdatedAt)), todayISO(now))
    : null;

  return { visits: visits.length, lastVisit, daysAtStatus };
}

/* ------------------------------------------------------------------ */
/* Who has worked it                                                   */
/* ------------------------------------------------------------------ */

export interface WorkedIt {
  memberId: string;
  name: string;
  visits: number;
  /** Their most recent visit to this institute. */
  lastVisit: string;
}

/**
 * Which reps have visited this institute, and how often.
 *
 * ONE ROW PER REP, busiest first, ties broken by the most recent visit so the
 * order is stable rather than dependent on insertion. Names come from the rows
 * themselves — `getInstituteVisits()` resolves them in TypeScript rather than
 * through a PostgREST embed — so this costs no query at all.
 *
 * ADMIN-ONLY ON THE PAGE, and that is a data decision rather than a permissions
 * one. RLS gives a rep only their own visits, so for them this panel would
 * always be exactly one row — themselves — under a heading that reads like a
 * list of everyone who has been. That is not partial information, it is
 * misleading information, and the fix is not to show it rather than to caption
 * it. An admin's copy is the whole team's and answers the question properly.
 *
 * A visit whose member name failed to resolve still gets a row: the id is what
 * the tally is keyed on, so an unnamed rep shows as "Unnamed rep" rather than
 * silently merging with another.
 */
export function workedItBy(visits: readonly VisitSummary[]): WorkedIt[] {
  const tally = new Map<string, WorkedIt>();

  for (const visit of visits) {
    const found = tally.get(visit.member);
    if (found) {
      found.visits += 1;
      if (visit.date > found.lastVisit) found.lastVisit = visit.date;
    } else {
      tally.set(visit.member, {
        memberId: visit.member,
        name: visit.memberName ?? "Unnamed rep",
        visits: 1,
        lastVisit: visit.date,
      });
    }
  }

  return [...tally.values()].sort(
    (a, b) => b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit),
  );
}
