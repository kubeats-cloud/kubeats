/**
 * The eight metrics, and — the part that actually matters — where each one's
 * ACHIEVED figure is counted from.
 *
 * Rule 7: Meetings are counted from the daily plan, not from the visits log.
 * A meeting only counts once the plan entry it belongs to is marked held, which
 * is what the meeting gate guarantees. The other seven are counted from visits.
 * Keeping the source in the same table as the label means the Weekly screen and
 * the Dashboard can never disagree about what a number means.
 *
 * There were briefly nine. Migration 0013 added `institutes_covered` — a count
 * of DISTINCT institutes rather than of rows — and the client has since asked
 * for it off the Targets screen. It is gone from here, so the app neither asks
 * a rep to commit to it nor writes it, but **the column still exists** on
 * public.targets, carrying the numbers reps already committed. That is
 * deliberate: dropping it is the one part of this change that could not be
 * undone, and 0013 itself set the precedent by renaming weekly_targets aside
 * rather than dropping it. Re-adding the metric is this entry restored:
 *
 *   { key: "institutes_covered", label: "Institutes Covered",
 *     source: "distinct-institutes" }
 *
 * plus the DISTINCT count in week-summary.ts. (It used to need a line in
 * `targetsSchema` too; there is no such schema any more — see the foot of this
 * file.)
 */
export const METRICS = [
  { key: "meetings", label: "Meetings", source: "plan" },
  {
    key: "sessions_set",
    label: "Sessions Set",
    source: "visits",
    activity: "session",
    lifecycle: "Set",
  },
  {
    key: "sessions_done",
    label: "Sessions Done",
    source: "visits",
    activity: "session",
    lifecycle: "Done",
  },
  {
    key: "campus_visits_set",
    label: "Campus Visits Set",
    source: "visits",
    activity: "campus_visit",
    lifecycle: "Set",
  },
  {
    key: "campus_visits_done",
    label: "Campus Visits Done",
    source: "visits",
    activity: "campus_visit",
    lifecycle: "Done",
  },
  {
    key: "olympiad",
    label: "Olympiad Registrations",
    source: "visits",
    activity: "olympiad",
    lifecycle: null,
  },
  {
    key: "application",
    label: "Application Forms",
    source: "visits",
    activity: "application",
    lifecycle: null,
  },
  {
    key: "admission",
    label: "Admissions",
    source: "visits",
    activity: "admission",
    lifecycle: null,
  },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];

export const METRIC_KEYS = METRICS.map((m) => m.key) as [
  MetricKey,
  ...MetricKey[],
];

export type MetricCounts = Record<MetricKey, number>;

export const ZERO_COUNTS: MetricCounts = Object.fromEntries(
  METRIC_KEYS.map((key) => [key, 0]),
) as MetricCounts;

export function metricLabel(key: string): string {
  return METRICS.find((m) => m.key === key)?.label ?? key;
}

/* ------------------------------------------------------------------ */
/* Counting what happened                                              */
/* ------------------------------------------------------------------ */

export interface TallyableVisit {
  activity: string;
  lifecycle_status: string | null;
}

/**
 * Rule 7's visits half: tallies rows against the seven visit-sourced metrics.
 *
 * A row matches when the activity agrees and, for the two activities that have
 * a lifecycle, the Set/Done status agrees too. A session that has since been
 * closed therefore moves from "set" to "done" — the same row, told from a later
 * point in time — which is what stops the two columns double-counting it.
 *
 * `meetings` is never touched here. It is counted from daily_plans by the
 * caller, and a bug that quietly filled it in from the visits log would be
 * invisible in the UI. Kept pure so that rule can be tested without a database.
 */
export function tallyVisitMetrics(visits: TallyableVisit[]): MetricCounts {
  const counts = { ...ZERO_COUNTS };
  for (const visit of visits) {
    for (const metric of METRICS) {
      if (metric.source !== "visits") continue;
      if (metric.activity !== visit.activity) continue;
      if (metric.lifecycle !== null && metric.lifecycle !== visit.lifecycle_status) {
        continue;
      }
      counts[metric.key] += 1;
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* What used to live below this line                                   */
/* ------------------------------------------------------------------ */

/**
 * Everything about COMMITMENT has gone: toneFor, percentOf, remaining,
 * progressStatus, STATUS_LABELS, STATUS_BADGE, TONE_BAR, TONE_BADGE,
 * completionPercent, targetsSchema, reopenSchema, targetsFormDataToInput and
 * weeklyFieldErrors.
 *
 * They all answered one question — "how does what happened compare with what
 * was promised" — and stage 2 of the redesign removed the promise. Nothing
 * sets a target now, so every one of them had exactly one possible answer:
 * a null percentage, a "none" tone, a "Not Started" badge.
 *
 * WHAT IS LEFT IS THE HALF THAT WAS NEVER ABOUT TARGETS. METRICS still names
 * the eight things worth counting and, crucially, still records WHERE each
 * one is counted from — Rule 7's `source: "plan"` for Meetings and
 * `source: "visits"` for the other seven. tallyVisitMetrics() is unchanged and
 * still refuses to count Meetings, so the caller has to go to daily_plans for
 * them. That is the rule the read-only week summary now rests on, and it is
 * the same rule the Targets screen rested on before it.
 *
 * public.targets is untouched in the database. Reviving commitment means
 * restoring this file's lower half and the two screens that read it — not a
 * migration. See docs/flow-redesign-plan.md, changes 3 and 4.
 */
