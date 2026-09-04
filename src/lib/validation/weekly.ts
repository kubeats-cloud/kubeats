import { z } from "zod";
import { mondayOf } from "@/lib/weeks";

/**
 * The eight weekly metrics, and — the part that actually matters — where each
 * one's ACHIEVED figure is counted from.
 *
 * Rule 7: Meetings are counted from the daily plan, not from the visits log.
 * A meeting only counts once the plan entry it belongs to is marked held, which
 * is what the meeting gate guarantees. The other seven are counted from visits.
 * Keeping the source in the same table as the label means the Weekly screen and
 * the Dashboard can never disagree about what a number means.
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

const weekStart = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && mondayOf(v) === v, {
    message: "That is not the start of a week.",
  });

export const weeklyTargetsSchema = z.object({
  week_start: weekStart,
  meetings: count,
  sessions_set: count,
  sessions_done: count,
  campus_visits_set: count,
  campus_visits_done: count,
  olympiad: count,
  application: count,
  admission: count,
});

export type WeeklyTargetsInput = z.infer<typeof weeklyTargetsSchema>;

export const reopenSchema = z.object({
  member: z.uuid("That member could not be identified."),
  week_start: weekStart,
});

/** Shared so the browser and the server action read the form identically. */
export function weeklyFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    week_start: text("week_start"),
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
