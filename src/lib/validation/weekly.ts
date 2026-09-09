import { z } from "zod";
import { TARGET_PERIODS, periodStartOf } from "@/lib/periods";

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
 * plus its line in `targetsSchema` and the DISTINCT count in targets.ts.
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
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type ProgressTone = "met" | "progressing" | "behind" | "none";

/**
 * The semantic palette, decided in one place.
 *
 * Thresholds are the prototype's: at or past target is green, half way or more
 * is amber, anything less is red. A target of zero is "none", not "met" —
 * committing to nothing and achieving nothing is not an achievement, and
 * painting the row green would be flattery.
 */
const PROGRESSING_AT = 50;

export function toneFor(achieved: number, target: number): ProgressTone {
  if (target <= 0) return achieved > 0 ? "met" : "none";
  const pct = (achieved / target) * 100;
  if (pct >= 100) return "met";
  if (pct >= PROGRESSING_AT) return "progressing";
  return "behind";
}

export function percentOf(achieved: number, target: number): number {
  if (target <= 0) return achieved > 0 ? 100 : 0;
  return Math.min(100, Math.round((achieved / target) * 100));
}

/** How much of a commitment is still outstanding. Never negative. */
export function remaining(achieved: number, target: number): number {
  return Math.max(0, target - achieved);
}

/**
 * The plain-language state of one metric, which is a different question from
 * toneFor().
 *
 * toneFor() answers "how is this going" on a four-point colour scale, where
 * being halfway is meaningfully better than being nowhere. This answers "has
 * it been started, and is it finished" — three states, no judgement about pace.
 * They are kept apart because collapsing them would mean a row 60% of the way
 * through either loses its amber or gains a "Completed" it has not earned.
 *
 * A target of zero with nothing achieved is "Not Started" rather than
 * "Completed": committing to nothing is not an achievement.
 */
export type ProgressStatus = "not-started" | "in-progress" | "completed";

export const STATUS_LABELS: Record<ProgressStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  completed: "Completed",
};

export const STATUS_BADGE: Record<
  ProgressStatus,
  "success" | "warning" | "neutral"
> = {
  "not-started": "neutral",
  "in-progress": "warning",
  completed: "success",
};

export function progressStatus(achieved: number, target: number): ProgressStatus {
  if (target > 0 && achieved >= target) return "completed";
  if (achieved > 0) return "in-progress";
  return "not-started";
}

export const TONE_BAR: Record<ProgressTone, string> = {
  met: "bg-success",
  progressing: "bg-warning",
  behind: "bg-danger",
  none: "bg-neutral",
};

export const TONE_BADGE: Record<
  ProgressTone,
  "success" | "warning" | "danger" | "neutral"
> = {
  met: "success",
  progressing: "warning",
  behind: "danger",
  none: "neutral",
};

/**
 * One number for a whole week, as the prototype computes it: the unweighted
 * mean of each committed metric's ratio, every ratio capped at 1.
 *
 * Two deliberate consequences. Each metric counts equally, so committing to 30
 * meetings and 2 admissions does not let the meetings drown out the admissions.
 * And the cap means overshooting one metric cannot paper over another that was
 * missed. A rep who committed to nothing gets null, shown as a dash — not 0%,
 * which would read as failure.
 */
export function completionPercent(
  achieved: MetricCounts,
  targets: MetricCounts,
): number | null {
  const committed = METRIC_KEYS.filter((key) => targets[key] > 0);
  if (committed.length === 0) return null;

  const total = committed.reduce(
    (sum, key) => sum + Math.min(1, achieved[key] / targets[key]),
    0,
  );
  return Math.round((total / committed.length) * 100);
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/**
 * A commitment is a small whole number. Empty means zero — a rep who clears a
 * box means "none", not "invalid" — but anything else must be digits, so a
 * pasted "12a" is refused rather than silently becoming 12.
 */
const count = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .transform((v) => (v === "" ? "0" : v))
  .refine((v) => /^\d{1,3}$/.test(v), "Whole numbers from 0 to 999.")
  .transform(Number);

/**
 * A period_start has to sit on the grid its period implies, which is the same
 * rule the targets_period_start_aligned CHECK enforces (migration 0013). Both
 * sides say it so a rep gets a sentence rather than a constraint rejection.
 */
const periodStart = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
  message: "That is not a date.",
});

export const targetsSchema = z
  .object({
    period: z.enum(TARGET_PERIODS, { message: "Choose a period." }),
    period_start: periodStart,
    meetings: count,
    sessions_set: count,
    sessions_done: count,
    campus_visits_set: count,
    campus_visits_done: count,
    olympiad: count,
    application: count,
    admission: count,
  })
  .superRefine((value, ctx) => {
    if (periodStartOf(value.period, value.period_start) !== value.period_start) {
      ctx.addIssue({
        code: "custom",
        path: ["period_start"],
        // Monthly's branch went with the monthly option itself. It is not
        // unreachable code left behind: `period` is z.enum(TARGET_PERIODS), so
        // "monthly" is no longer a value this can hold, and TypeScript rejects
        // the comparison outright.
        message:
          value.period === "weekly"
            ? "That is not the start of a week."
            : "That is not a valid date.",
      });
    }
  });

export type TargetsInput = z.infer<typeof targetsSchema>;

export const reopenSchema = z.object({
  member: z.uuid("That member could not be identified."),
  period: z.enum(TARGET_PERIODS, { message: "Choose a period." }),
  period_start: periodStart,
});

/** Shared so the browser and the server action read the form identically. */
export function targetsFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    period: text("period"),
    period_start: text("period_start"),
    ...(Object.fromEntries(METRIC_KEYS.map((key) => [key, text(key)])) as Record<
      MetricKey,
      string
    >),
  };
}

/** Collapses zod issues into one message per field, for inline display. */
export function weeklyFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
