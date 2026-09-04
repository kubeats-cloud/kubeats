import { z } from "zod";
import { INSTITUTE_STATUSES } from "@/lib/validation/institute";

/**
 * The visit workflow's rules, in one place, shared by the browser and the
 * server action. The database triggers and CHECK constraints from
 * 0001_init.sql are the backstop; everything here exists so a rep is told what
 * is wrong before they hit one.
 */

export const ACTIVITIES = [
  { key: "meeting", label: "Meeting", lifecycle: false },
  { key: "session", label: "Session", lifecycle: true },
  { key: "campus_visit", label: "Campus Visit", lifecycle: true },
  { key: "olympiad", label: "Olympiad Registration", lifecycle: false },
  { key: "application", label: "Application Form", lifecycle: false },
  { key: "admission", label: "Admission", lifecycle: false },
] as const;

export type ActivityKey = (typeof ACTIVITIES)[number]["key"];

export const ACTIVITY_KEYS = ACTIVITIES.map((a) => a.key) as [
  ActivityKey,
  ...ActivityKey[],
];

/** Rule 3: only these two carry a Set -> Done lifecycle. */
export const LIFECYCLE_ACTIVITIES: readonly ActivityKey[] = ACTIVITIES.filter(
  (a) => a.lifecycle,
).map((a) => a.key);

export function hasLifecycle(activity: string): boolean {
  return (LIFECYCLE_ACTIVITIES as readonly string[]).includes(activity);
}

export function activityLabelFor(activity: string): string {
  return ACTIVITIES.find((a) => a.key === activity)?.label ?? activity;
}

/**
 * Rule 5, as three predicates so the form and the schema cannot drift.
 *
 * The two "scheduled" statuses already carry their own expected date, so
 * asking for a follow-up as well would be asking the same question twice —
 * and the visits_follow_up_hidden_when_scheduled CHECK rejects it outright.
 */
export const FOLLOW_UP_HIDDEN_FOR = [
  "Session scheduled",
  "Campus visit scheduled",
] as const;

export const FOLLOW_UP_REQUIRED_FOR = "Pending for management approval";

export function followUpHidden(status: string | null): boolean {
  return status !== null && (FOLLOW_UP_HIDDEN_FOR as readonly string[]).includes(status);
}

export function followUpRequired(status: string | null): boolean {
  return status === FOLLOW_UP_REQUIRED_FOR;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || DATE.test(v), { message: "Choose a valid date." });

const optionalTime = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || TIME.test(v), { message: "Choose a valid time." });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();


const optionalCoord = (limit: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isFinite(v) && Math.abs(v) <= limit), {
      message: "Invalid coordinate.",
    });

export const visitSchema = z
  .object({
    activity: z.enum(ACTIVITY_KEYS),
    institute_id: z.uuid("Select an institute."),
    /** Only meetings carry one; it is the plan row the gate matches (rule 2). */
    daily_plan_id: z.uuid().nullable(),
    lifecycle_status: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || v === "Set" || v === "Done", {
        message: "Choose Set or Done.",
      }),
    expected_date: optionalDate,
    latitude: optionalCoord(90),
    longitude: optionalCoord(180),
    photo_path: optionalText(400),
    notes: optionalText(2000),
    status_set_to: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine(
        (v) => v === null || (INSTITUTE_STATUSES as readonly string[]).includes(v),
        { message: "Choose one of the listed statuses." },
      ),
    follow_up_date: optionalDate,
    follow_up_time: optionalTime,
  })
  .superRefine((value, ctx) => {
    const lifecycle = hasLifecycle(value.activity);

    // Rule 3 — mirrors visits_lifecycle_matches_activity.
    if (lifecycle && value.lifecycle_status === null) {
      ctx.addIssue({
        code: "custom",
        path: ["lifecycle_status"],
        message: "Choose whether this is Set or Done.",
      });
    }
    if (!lifecycle && value.lifecycle_status !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["lifecycle_status"],
        message: "This activity does not have a Set or Done state.",
      });
    }
    if (lifecycle && value.lifecycle_status === "Set" && !value.expected_date) {
      ctx.addIssue({
        code: "custom",
        path: ["expected_date"],
        message: "When is it expected?",
      });
    }

    // Rule 2 — the gate. A meeting must be tied to a plan row for today.
    if (value.activity === "meeting" && !value.daily_plan_id) {
      ctx.addIssue({
        code: "custom",
        path: ["daily_plan_id"],
        message:
          "A meeting can only be logged for an institute on today's plan. Add it on the Dashboard first.",
      });
    }

    // Rule 5 — mirrors the two follow-up CHECK constraints.
    if (followUpRequired(value.status_set_to) && !value.follow_up_date) {
      ctx.addIssue({
        code: "custom",
        path: ["follow_up_date"],
        message: 'A follow-up date is required for "Pending for management approval".',
      });
    }
    if (
      followUpHidden(value.status_set_to) &&
      (value.follow_up_date || value.follow_up_time)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["follow_up_date"],
        message: "That status already carries its own expected date.",
      });
    }
  });

export type VisitInput = z.infer<typeof visitSchema>;

/** Shared so the browser and the server action read the form identically. */
export function visitFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    activity: text("activity"),
    institute_id: text("institute_id"),
    daily_plan_id: text("daily_plan_id") || null,
    lifecycle_status: text("lifecycle_status"),
    expected_date: text("expected_date"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    photo_path: text("photo_path"),
    notes: text("notes"),
    status_set_to: text("status_set_to"),
    follow_up_date: text("follow_up_date"),
    follow_up_time: text("follow_up_time"),
  };
}

/* ------------------------------------------------------------------ */
/* Daily plan                                                          */
/* ------------------------------------------------------------------ */

export const dailyPlanSchema = z.object({
  institute_id: z.uuid("Select an institute."),
  purpose: z.string().trim().min(1, "Select a purpose.").max(120),
});

/** Ids arriving from the browser are still input, and still get checked. */
export const planIdSchema = z.uuid("That entry could not be identified.");

export function dailyPlanFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return { institute_id: text("institute_id"), purpose: text("purpose") };
}

/** Collapses zod issues into one message per field, for inline display. */
export function visitFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
