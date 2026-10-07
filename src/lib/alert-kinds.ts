/**
 * The alert vocabulary and its wording — the half of E1 with no database in it.
 *
 * ⚠ WHY THIS IS A SEPARATE FILE FROM `alerts.ts`. That module imports
 * `@/lib/supabase/server`, which pulls in `next/headers` and `server-only`; the
 * Dashboard banner is a Client Component and renders this copy. Importing even
 * a pure function across that line fails the build with "'server-only' cannot
 * be imported from a Client Component module" — the error names the symptom,
 * not the import that caused it, which is what makes the split worth stating.
 *
 * `visit-form-state.ts` and `institute-form-state.ts` exist for exactly this
 * reason and were both carved out after the same build failure.
 *
 * So: types, the kind list and the copy live here, where both sides may read
 * them. Anything that touches Postgres lives in `alerts.ts` and is imported
 * only by Server Components.
 */

/** The five kinds, in the order 0040's CHECK lists them. */
export const ALERT_KINDS = [
  "day_plan_not_set",
  "follow_ups_due",
  "follow_ups_pending",
  "follow_ups_missed",
  "weekly_plan_not_set",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertEvent {
  id: string;
  kind: AlertKind;
  forDate: string;
  /** How many follow-ups the three follow-up kinds counted. Null for the rest. */
  count: number | null;
  /** The Monday `weekly_plan_not_set` is warning about. Null for the rest. */
  weekStart: string | null;
  seenAt: string | null;
}

/**
 * What each alert says, in the rep's own terms.
 *
 * THE WORDING LIVES IN ONE PLACE because two surfaces render the same row — the
 * Dashboard banner and, in time, anything that sends one — and a kind that read
 * differently in two places would look like two different events. The count is
 * interpolated rather than appended so the sentence stays grammatical at 1.
 *
 * `tone` is the semantic palette from CLAUDE.md, not a colour: amber for
 * something in hand, red for something missed. Nothing here is ever green — an
 * alert exists because something is owed, and only the 19:00 row is a failure.
 */
export function describeAlert(alert: AlertEvent): {
  title: string;
  detail: string;
  tone: "warning" | "danger";
} {
  const n = alert.count ?? 0;
  const items = n === 1 ? "follow-up" : "follow-ups";
  /*
   * THE VERB AGREES TOO, and it did not until a live render showed
   * "1 follow-up were missed" on a rep's dashboard. Pluralising the noun and
   * leaving the verb is the easy half of this and reads as broken English on
   * the one line a rep sees every morning — so both are derived from the same
   * count, and the test covers every kind at n = 1 rather than only the first.
   */
  const were = n === 1 ? "was" : "were";

  switch (alert.kind) {
    case "day_plan_not_set":
      return {
        title: "Today's plan is empty",
        detail:
          "Add the institutes you are visiting today so you can check in at them.",
        tone: "warning",
      };
    case "follow_ups_due":
      return {
        title: `${n} ${items} due today`,
        detail: "They are on your dashboard under Follow-up calls.",
        tone: "warning",
      };
    case "follow_ups_pending":
      return {
        title: `${n} ${items} still open`,
        detail: "There is still time today — they are on your dashboard.",
        tone: "warning",
      };
    case "follow_ups_missed":
      return {
        title: `${n} ${items} ${were} missed`,
        detail:
          "The day ended with these still open. They stay on your list until you close them.",
        tone: "danger",
      };
    case "weekly_plan_not_set":
      return {
        title: "Next week is not committed yet",
        detail: alert.weekStart
          ? `Set your targets for the week beginning ${alert.weekStart}.`
          : "Set your targets for next week on the Targets screen.",
        tone: "warning",
      };
  }
}
