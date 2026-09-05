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
    /**
     * Rule 12 — a visit is not evidence without its photograph, so this is the
     * one part of "proof" that blocks. The location beside it still does not:
     * a rep in a basement staff room with no GPS lock must not be stuck, but a
     * rep who did not take a picture has not finished the visit.
     */
    photo_path: z
      .string()
      .trim()
      .min(1, "A photo is required to log this visit.")
      .max(400),
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
  // Both messages are written to stand on their own under the field they
  // belong to, because that is where a rep reads them. "Select an institute."
  // beside a control already labelled Institute says nothing the rep did not
  // already know; naming what kind of institute does.
  institute_id: z.uuid("Pick a registered institute for this planned visit."),
  purpose: z
    .string()
    .trim()
    .min(1, "Choose what this visit is for.")
    .max(120, "That purpose is too long."),
});

/**
 * The one-line summary shown above the "Add to today's plan" button.
 *
 * Shared so the client's own check and the server action say the same words
 * for the same mistake — a rep who submits with JavaScript still warming up
 * should not get a different sentence from the one they would have got a
 * second later.
 *
 * With a single problem it repeats that problem rather than saying "check the
 * highlighted fields": on a form this short, sending someone hunting for a
 * highlight when there is exactly one thing to fix is worse than saying it.
 */
export function dailyPlanSummary(fieldErrors: Record<string, string>): string {
  const messages = Object.values(fieldErrors);
  if (messages.length === 1) return messages[0];
  return "Pick an institute and a purpose before adding this to today's plan.";
}

/** Ids arriving from the browser are still input, and still get checked. */
export const planIdSchema = z.uuid("That entry could not be identified.");

export function dailyPlanFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return { institute_id: text("institute_id"), purpose: text("purpose") };
}

/**
 * What to call a field when telling someone it is wrong.
 *
 * Zod reports the path it walked — "people.0.name", "activities_conducted" —
 * which is the shape of the data, not the name of the thing on screen. Showing
 * that to a rep at a school gate asks them to read a schema. This maps the few
 * dozen paths these two forms can produce back to the words printed beside the
 * field, and falls back to a de-underscored title case for anything new, so a
 * field added later is untidy rather than broken.
 */
const FIELD_LABELS: Record<string, string> = {
  // Person, within "Who did you meet?"
  name: "name",
  contact_type: "what they do",
  designation: "designation",
  contact_number: "mobile",
  is_decision_maker: "decision maker",

  // Log a visit
  activity: "Activity",
  institute_id: "Institute",
  daily_plan_id: "Today’s plan",
  lifecycle_status: "Set or Done",
  expected_date: "Expected date",
  photo_path: "Photo",
  notes: "Notes",
  status_set_to: "Institute status",
  latitude: "Location",
  longitude: "Location",

  // Closing report
  activities_conducted: "What you did",
  session_topic: "Session topic",
  session_class: "Class",
  session_streams: "Streams",
  students_attended: "Students attended",
  session_duration_mins: "Session length",
  other_faculty_present: "Other faculty",
  other_faculty_count: "Faculty count",
  session_participation: "Participation",
  student_questions: "Student questions",
  students_reached: "Students reached",
  student_response: "Student response",
  student_interest: "Interest level",
  most_interested_programs: "Most-interested programs",
  student_intent: "Student intent",
  management_response: "Management response",
  management_feedback: "What management said",
  management_interest: "Management interest",
  discussion_summary: "What was discussed",
  visit_outcome: "How it ended",
  primary_outcome: "Primary outcome",
  applications_collected: "Applications collected",
  admissions_generated: "Admissions",
  follow_up_needed: "Follow-up",
  follow_up_action: "Follow-up action",
  follow_up_date: "Follow-up date",
  follow_up_time: "Follow-up time",
  employee_remarks: "Your remarks",
};

function titleCase(key: string): string {
  const words = key.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(key: string): string {
  // "people.0.name" is one person's field, and a rep counts from one.
  const person = /^people\.(\d+)\.(.+)$/.exec(key);
  if (person) {
    const which = Number(person[1]) + 1;
    const part = FIELD_LABELS[person[2]] ?? person[2].replace(/_/g, " ");
    return `Person ${which} — ${part}`;
  }
  return FIELD_LABELS[key] ?? titleCase(key);
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
