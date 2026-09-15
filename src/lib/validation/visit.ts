import { z } from "zod";
import { INSTITUTE_STATUSES, isOpenStatus } from "@/lib/validation/institute";

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
 * Rule 5, as stage 3 restates it.
 *
 * THE OLD SHAPE IS GONE. It had two halves: a follow-up was REQUIRED for the
 * two statuses waiting on someone else's answer, and FORBIDDEN for the two
 * "scheduled" ones because those carry their own expected date. The second
 * half was `FOLLOW_UP_HIDDEN_FOR` and the `visits_follow_up_hidden_when_scheduled`
 * CHECK, and both are gone — migration 0018 drops the constraint.
 *
 * The new rule is one sentence: **an OPEN status needs a date and a time to
 * chase on; a CLOSED one does not.** "Next session set" IS "Session scheduled",
 * which the old rule forbade a follow-up on, so the two could not both stand.
 *
 * It asks `isOpenStatus()` rather than listing statuses, so this cannot drift
 * from `INSTITUTE_STATUS_CATALOGUE`. The database asks the same question the
 * same way: `enforce_follow_up_when_open()` calls
 * `public.institute_status_is_open()`, which reads the lookup table 0010
 * created. Neither side keeps its own copy of the list.
 *
 * A CLOSED status may still CARRY a follow-up — "they said no, ask again next
 * intake" is a real note to leave, and 0010 kept it permitted on purpose.
 */
export function followUpRequired(status: string | null): boolean {
  return isOpenStatus(status);
}

/**
 * The time a follow-up starts out at, so setting one is a tap rather than a
 * decision.
 *
 * The client's spec asked only for a follow-up DATE; the database asks for a
 * date AND a time (`enforce_follow_up_when_open`, FO016) and has since 0018.
 * Both are kept, because a time is what makes a follow-up land in a diary
 * rather than in a day — but it is pre-filled when the rep picks the date, so
 * the fiddly half answers itself and can still be changed.
 *
 * Mid-morning on purpose: a school is open, the first period is over, and
 * nobody is at lunch. It is a starting point, not a rule, and nothing anywhere
 * enforces it.
 */
export const DEFAULT_FOLLOW_UP_TIME = "11:00";

/**
 * The two statuses 0010 singled out, kept only so their message can say WHY.
 *
 * They are now a strict subset of the open set above, so this decides nothing —
 * but `visits_follow_up_required_when_awaiting` is still installed, and a rep
 * who trips it deserves the sentence that explains it rather than the generic
 * one.
 */
export const FOLLOW_UP_REQUIRED_FOR = [
  "Pending for management approval",
  "Invited principal for event",
] as const;

/**
 * Rule 3's dates: a "Set" session or campus visit is a promise about a future
 * day, so it must name one.
 */
export function expectedDateRequired(
  activity: string,
  lifecycle: string | null,
): boolean {
  return hasLifecycle(activity) && lifecycle === "Set";
}

/**
 * What to CALL that date, which depends on what was set.
 *
 * It read "When is it expected?" for both activities — true, and vague enough
 * that a rep setting a campus visit and a rep setting a session were answering
 * a question that named neither. The client's spec asks for the date to be
 * labelled for the thing it belongs to, so it is.
 *
 * "Tentative" is deliberate and is not padding: `expected_date` is a plan, not
 * an appointment. Nothing anywhere enforces that the visit happens on it — the
 * loop is closed by VISITING AGAIN, whenever that turns out to be — so a label
 * promising a firm date would misdescribe the column.
 *
 * The default is unreachable through the form, because expectedDateRequired()
 * only ever fires for the two lifecycle activities. It is kept so adding a
 * third lifecycle activity yields a vague label rather than a blank one.
 */
export function expectedDateLabel(activity: string): string {
  switch (activity) {
    case "session":
      return "Tentative session date";
    case "campus_visit":
      return "Tentative campus visit date";
    default:
      return "When is it expected?";
  }
}

/* ------------------------------------------------------------------ */
/* Purpose -> activity                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a planned purpose means in the visits log.
 *
 * The Dashboard plans a visit as institute + purpose, from the admin-managed
 * `public.purposes` list. Stage 3 pre-fills Log Visit from that plan row, so
 * something has to turn "Fix a session" into (session, Set).
 *
 * A LOOKUP ON THE LABEL, deliberately, and it is the weak point worth naming:
 * `purposes` has no stable key, only an editable label, so renaming a purpose
 * in Settings silently drops it out of this map. That is survivable rather
 * than dangerous — an unmapped purpose falls through to `null` and the rep
 * picks the activity by hand, which is exactly what "Other" does — but it is
 * why the fallback is a real path and not an assertion.
 */
export const PURPOSE_ACTIVITY: Record<
  string,
  { activity: ActivityKey; lifecycle: "Set" | "Done" | null }
> = {
  "Fix a session": { activity: "session", lifecycle: "Set" },
  "Complete a session": { activity: "session", lifecycle: "Done" },
  "Fix a campus visit": { activity: "campus_visit", lifecycle: "Set" },
  "Complete a campus visit": { activity: "campus_visit", lifecycle: "Done" },
  // "Other" is deliberately absent: the rep picks.
};

/** What a purpose pre-fills, or null when the rep has to choose. */
export function activityForPurpose(
  purpose: string | null | undefined,
): { activity: ActivityKey; lifecycle: "Set" | "Done" | null } | null {
  if (!purpose) return null;
  return PURPOSE_ACTIVITY[purpose.trim()] ?? null;
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
     * How good those coordinates are, in metres. Optional like the coordinates
     * themselves, and never a reason to refuse a visit — it exists so a
     * network fix can be told apart from a satellite one after the fact, which
     * it could not be before.
     *
     * It is also the only key here that tolerates being absent entirely. During
     * a deploy a rep's cached page posts a form with no accuracy field at all,
     * and a required key would turn that into "could not be read" on a visit
     * that is otherwise perfect.
     */
    accuracy: z
      .string()
      .trim()
      .optional()
      .transform((x) => (x === undefined || x === "" ? null : x))
      .nullable()
      .refine((x) => x === null || (Number.isFinite(Number(x)) && Number(x) >= 0), {
        message: "That accuracy could not be read.",
      })
      .transform((x) => (x === null ? null : Number(x))),
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
        // Same wording as the control, from the same function. The label said
        // "Tentative session date" while this said "When is it expected?" and
        // the error summary called the field "Expected date" - three names for
        // one box, which is how a rep ends up hunting for a field that is
        // already in front of them.
        message: `Pick a ${expectedDateLabel(value.activity).toLowerCase()}.`,
      });
    }

    // The presence guarantee, now for EVERY activity (stage 3).
    //
    // This used to apply to meetings alone, mirroring the trigger 0014
    // installed. 0018 widens that trigger to every activity — a visit is only
    // ever logged from a check-in now — so the schema widens with it. Without
    // this the rep would reach the database and be refused there with FO009.
    if (!value.daily_plan_id) {
      ctx.addIssue({
        code: "custom",
        path: ["daily_plan_id"],
        message:
          "Check in at the institute before logging the visit. Start from the Dashboard.",
      });
    }

    // Rule 5 — an open status needs a date AND a time to chase on.
    //
    // Mirrors enforce_follow_up_when_open() in 0018, which asks the same
    // question of the same lookup table. The old "forbidden when scheduled"
    // half is gone: 0018 drops the constraint that stated it.
    if (followUpRequired(value.status_set_to)) {
      if (!value.follow_up_date) {
        ctx.addIssue({
          code: "custom",
          path: ["follow_up_date"],
          message: `"${value.status_set_to}" leaves this open, so a follow-up date is needed.`,
        });
      }
      if (!value.follow_up_time) {
        ctx.addIssue({
          code: "custom",
          path: ["follow_up_time"],
          message: "And a time, so it lands in a diary rather than a day.",
        });
      }
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
    accuracy: text("accuracy"),
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
  // Activity-neutral, because this map is keyed by field name and cannot know
  // which activity is selected. It still belongs to the same "Tentative ...
  // date" family as the control and the message above.
  expected_date: "Tentative date",
  photo_path: "Photo",
  notes: "Notes",
  status_set_to: "Institute status",
  latitude: "Location",
  longitude: "Location",

  // Closing report
  // met_name / met_phone are the two the live short form actually posts. They
  // were missing, so the error summary title-cased the column name and told a
  // rep to check "Met name" - a field printed on screen as "Name".
  met_name: "Name",
  met_phone: "Mobile",
  activities_conducted: "What you did",
  session_topic: "Session topic",
  session_class: "Class",
  session_streams: "Streams",
  // Two counts since 0022. The COLUMN names are 0009's; these are what a rep
  // reads, and they must match the labels in feedback-fields.tsx exactly or an
  // error summary points at a box that is captioned something else.
  students_attended: "Students present",
  session_duration_mins: "Session length",
  other_faculty_present: "Other faculty",
  other_faculty_count: "Faculty count",
  session_participation: "Participation",
  student_questions: "Student questions",
  students_reached: "Students who participated",
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
    return `Person ${which}: ${part}`;
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
