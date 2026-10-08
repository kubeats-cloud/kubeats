import { PHASE_A_DAILY_PLAN } from "@/lib/features";
import type { AlertKind } from "@/lib/alert-kinds";

/**
 * The bell's vocabulary: which conditions it surfaces, when each becomes true,
 * and where each line goes.
 *
 * ⚠ CLIENT-SAFE, AND THAT IS WHY IT IS NOT IN `notifications.ts`. That module
 * imports `@/lib/supabase/server`, which pulls in `next/headers` and
 * `server-only`; the bell itself is a Client Component and renders this copy.
 * `alert-kinds.ts` was split from `alerts.ts` for exactly this reason and its
 * header describes the build error — this is the same split, one layer up.
 *
 * ⚠ THE KINDS ARE `AlertKind`, NOT A SECOND LIST. The bell answers the same
 * five questions migration 0040 asks, so it reuses that vocabulary rather than
 * declaring a parallel one that could drift. What differs is WHEN the answer is
 * computed, not what is being asked — see `notifications.ts`.
 */

/**
 * The Asia/Kolkata hour each kind becomes visible, matching the pg_cron
 * schedule in migration 0040 exactly.
 *
 * ⚠ THESE NUMBERS ARE A COPY, AND THE COPY IS DELIBERATE. 0040's schedule is
 * the authority for the permanent record; these gate a LIVE re-derivation
 * between its runs, and the two must agree or the bell will claim a follow-up
 * was missed an hour before the database would record it. They are stated here
 * rather than read from the database because pg_cron's schedule is not
 * queryable through PostgREST — so the guard is a test that fails if 0040's
 * times move, not a join. See `tests/unit/notifications.test.ts`.
 *
 * `follow_ups_due` is 0 rather than 9: the 09:00 job writes the RECORD, but a
 * follow-up due today is owed from the moment the day starts, and a bell that
 * stayed empty until 09:00 would be wrong for the rep who opens the app at 08:00
 * with three calls to make.
 */
export const VISIBLE_FROM_IST_HOUR: Record<AlertKind, number> = {
  follow_ups_due: 0,
  follow_ups_pending: 16,
  follow_ups_missed: 19,
  day_plan_not_set: 10,
  weekly_plan_not_set: 19,
};

/**
 * The ISO day of the week a kind may appear on, where one is restricted.
 * Monday is 1 and Sunday is 7, matching ISO and `date_trunc('week', ...)`.
 *
 * ⚠ ONLY `weekly_plan_not_set` IS RESTRICTED, AND IT HAS TO BE. 0040 schedules
 * it `'30 13 * * 0'` — Sunday 19:00 IST, once a week — and the predicate asks
 * about NEXT week (`date_trunc('week', today) + 7`). An hour gate alone was
 * harmless while this kind was dark; live, it would put a line on the bell
 * every evening from Monday about a Monday six days away, and a rep who has not
 * yet set next week's targets would carry a permanent badge all week. That is
 * the one failure mode that makes a notification surface worth ignoring.
 *
 * So the bell matches the job: one nudge, on the evening it is actually
 * actionable. `tests/unit/notifications.test.ts` reads the cron line out of
 * 0040 and fails if that day ever moves.
 */
export const VISIBLE_ON_ISO_DOW: Partial<Record<AlertKind, number>> = {
  weekly_plan_not_set: 7,
};

/**
 * The kinds that are Phase A surfaces, and are therefore dark while
 * `PHASE_A_DAILY_PLAN` is false.
 *
 * ⚠ ONLY THE DAILY PLAN. `weekly_plan_not_set` was briefly in this set and is
 * deliberately out of it: unlike `day_plan_not_set`, the thing it nudges about
 * is not a Phase A surface at all. The weekly commitment came back whole
 * (CLAUDE.md, "A rep commits to a week, and to nothing else") and `/targets` is
 * live and on the rep's nav bar today, so gating its reminder meant a live
 * screen losing its nudge for as long as the daily-plan redo takes.
 *
 * What keeps it quiet is now the CLOCK, not the flag — see
 * `VISIBLE_ON_ISO_DOW` above. Those are different mechanisms with different
 * meanings, and conflating them is what put it here in the first place.
 */
export const PHASE_A_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "day_plan_not_set",
]);

/** Whether a kind may be surfaced at all in this build. */
export function kindIsEnabled(kind: AlertKind): boolean {
  return PHASE_A_DAILY_PLAN || !PHASE_A_KINDS.has(kind);
}

/**
 * Where a bell line takes the reader.
 *
 * ⚠ FOLLOW-UPS GO TO `/pending`, NOT TO THE DASHBOARD, and that is a
 * correction rather than a choice. `describeAlert()`'s copy for
 * `follow_ups_due` still says "They are on your dashboard under Follow-up
 * calls" — which was true when E1 shipped and is not true now: that block is
 * behind PHASE_A_DAILY_PLAN. Pending's "Due today" block is deliberately NOT
 * gated (CLAUDE.md: it is the only place a rep can CLOSE a follow-up they
 * already owe), so it is the only surface that can actually be acted on while
 * the flag is false.
 */
export function hrefFor(kind: AlertKind): string {
  switch (kind) {
    case "follow_ups_due":
    case "follow_ups_pending":
      return "/pending";
    case "follow_ups_missed":
      return "/missed";
    case "day_plan_not_set":
      return "/";
    case "weekly_plan_not_set":
      return "/targets";
  }
}

/**
 * One line in the bell.
 *
 * `member` is null for the reader's OWN item and carries a name for a team
 * lead's per-rep line. A lead has no own items — they log no visits and own no
 * institutes — so for them it is always set; the null case is a rep's.
 */
export interface NotificationItem {
  /** Stable within a render, for React keys. `${kind}:${memberId ?? "self"}`. */
  id: string;
  kind: AlertKind;
  /** How many follow-ups this line counts. Null for the two plan kinds. */
  count: number | null;
  /** The Monday `weekly_plan_not_set` warns about. Null for the rest. */
  weekStart: string | null;
  /** Whose item this is, when the reader is a team lead. Null for one's own. */
  memberName: string | null;
  href: string;
}

/**
 * The ISO day of the week for a Kolkata `YYYY-MM-DD`. Monday 1 … Sunday 7.
 *
 * UTC arithmetic on the date string, which is the split the rest of this file
 * uses: the DAY comes from todayISO()/app_today(), the ARITHMETIC is UTC so the
 * runtime's zone cannot drag it across a boundary.
 */
export function isoDayOfWeek(today: string): number {
  return new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay() || 7;
}

/**
 * Whether a kind may appear at this moment of the Indian week.
 *
 * ⚠ ALL THREE GATES IN ONE PLACE — the flag, the hour and the day — so a caller
 * cannot apply one and forget another. Forgetting the hour would put the 19:00
 * missed line on a rep's bell at breakfast; forgetting the day would put the
 * weekly nudge there every evening from Monday. Both have a test.
 *
 * Here rather than in `notifications.ts` so it is reachable from a test without
 * dragging in `@/lib/supabase/server` and `next/headers` behind it — the same
 * reason the copy lives in `alert-kinds.ts`.
 */
export function visibleNow(
  kind: AlertKind,
  hour: number,
  today: string,
): boolean {
  if (!kindIsEnabled(kind)) return false;
  if (hour < VISIBLE_FROM_IST_HOUR[kind]) return false;

  const onlyOn = VISIBLE_ON_ISO_DOW[kind];
  return onlyOn === undefined || isoDayOfWeek(today) === onlyOn;
}

/**
 * The Monday of the week AFTER the given Kolkata day, as `YYYY-MM-DD`.
 *
 * UTC arithmetic on a YYYY-MM-DD string, which is the split `weeks.ts` and
 * `/missed` both use: the DAY comes from todayISO()/app_today(), the ARITHMETIC
 * is UTC so the runtime's zone cannot drag it across a boundary.
 *
 * getUTCDay() is 0 for Sunday; ISO weeks start Monday, so Sunday is day 7. This
 * mirrors 0040's `date_trunc('week', ...) + 7`, which is also ISO - the two must
 * pick the same Monday or the bell would nudge about a different week from the
 * one the database recorded.
 */
export function nextMonday(today: string): string {
  const ms = Date.parse(`${today}T00:00:00Z`);
  const dow = new Date(ms).getUTCDay() || 7;
  return new Date(ms + (8 - dow) * 86_400_000).toISOString().slice(0, 10);
}
