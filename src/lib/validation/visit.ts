import { z } from "zod";
import {
  SEED_STATUS_CATALOGUE,
  isOpenStatus,
  selectableStatuses,
  statusRow,
  type StatusCatalogue,
} from "@/lib/validation/institute";

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
export function followUpRequired(
  catalogue: StatusCatalogue,
  status: string | null,
): boolean {
  return isOpenStatus(catalogue, status);
}

/*
 * DEFAULT_FOLLOW_UP_TIME stood here — the 11:00 a follow-up time started out
 * at, so that answering it was a tap rather than a decision.
 *
 * It is gone with the field it pre-filled. The client's spec asked for a
 * follow-up DATE; the database wanted a date AND a time from 0018, and
 * pre-filling was the way to keep both without making a rep answer twice.
 * Migration 0023 drops the time from the rule outright, so there is nothing
 * left to pre-fill: `follow_up_time` is dormant on public.visits, kept with
 * every value it already holds and collected by nothing.
 */

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
export function eventDateRequired(
  catalogue: StatusCatalogue,
  status: string | null,
): boolean {
  return statusRow(catalogue, status)?.asksExpectedDate ?? false;
}

/**
 * Does this status require a written report?
 *
 * SEVEN OF THE NINE DO. The two that do not are the instant closes — "RSVP
 * received" and "Will not come" — where the status IS the whole answer and
 * demanding a sentence would be demanding a restatement of the dropdown.
 *
 * DERIVED, NOT LISTED. Naming those two here would be a hard-coded status list
 * in TypeScript, which is the mistake `PURPOSE_ACTIVITY` made and which
 * migration 0026 spent a whole table removing: rename one in Settings and the
 * rule silently stops applying to it. So the question is asked of the row
 * instead — a status needs notes unless it is CLOSED and asks for nothing else.
 * That is exactly those two today, and it extends the way an admin would
 * expect: a new closed status that collects nothing is another instant close.
 */
export function notesRequired(
  catalogue: StatusCatalogue,
  status: string | null,
): boolean {
  const row = statusRow(catalogue, status);
  if (!row) return false;
  if (row.category !== "closed") return true;
  return row.asksExpectedDate || row.asksSessionDetail || row.asksHeadCount;
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
export function eventDateLabel(
  catalogue: StatusCatalogue,
  status: string | null,
): string {
  const row = statusRow(catalogue, status);
  const name = row?.status ?? "";

  // WHAT the date is about comes from the status's own words, because no flag
  // distinguishes a session from a campus visit: "Session scheduled" and
  // "Campus visit scheduled" carry an identical set of asks. Reading the name
  // keeps the two apart without a second hard-coded list.
  const kind = /campus/i.test(name)
    ? "Campus Visit"
    : /session/i.test(name)
      ? "Session"
      : "Event";

  // WHETHER it has happened yet comes from the category, which is the same
  // open/closed split everything else on this form reads. An open status is a
  // plan ("Expected Session Date"); a closed one is a record ("Session Date").
  const expected = row?.category === "open" ? "Expected " : "";

  return `${expected}${kind} Date`;
}

/* ------------------------------------------------------------------ */
/* Purpose -> activity                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a planned purpose means in the visits log.
 *
 * `PURPOSE_ACTIVITY` stood here — a hard-coded map from four purpose LABELS to
 * (activity, lifecycle), with its own comment naming the weakness: "purposes
 * has no stable key, only an editable label, so renaming a purpose in Settings
 * silently drops it out of this map". That was survivable while the rep still
 * picked the Activity by hand and an unmapped purpose merely fell through.
 *
 * STAGE 3 REMOVED THE SELECTOR, so there is no falling through any more. The
 * mapping therefore moved onto the row: `purposes.activity` (migration 0024)
 * and `purposes.lifecycle` (0025), read from the database and carried on the
 * plan entry. A rename cannot break it, and an admin adding a purpose decides
 * its activity at the moment they add it.
 *
 * The type below is what that lookup produces. It is deliberately the same
 * shape the old constant held, because every caller wanted exactly this pair.
 */
export interface PlannedActivity {
  activity: ActivityKey;
  lifecycle: "Set" | "Done" | null;
}

/**
 * Is this pair one the `visits` table would accept?
 *
 * Mirrors `visits_lifecycle_matches_activity` (0001) and its restatement on
 * `purposes` (`purposes_lifecycle_matches_activity`, 0025). Three copies of one
 * rule — but the other two are CHECK constraints, which cannot call a function,
 * and 0025's assertion block compares this shape against every purpose row.
 *
 * Used to decide whether a plan's mapping is USABLE before the rep is walked
 * into a visit that cannot be saved. A purpose whose activity is null (0024 not
 * applied) or whose lifecycle contradicts its activity fails here.
 */
export function plannedActivityIsValid(
  planned: { activity: string | null; lifecycle: string | null } | null,
): planned is PlannedActivity {
  if (!planned || planned.activity === null) return false;
  if (!(ACTIVITY_KEYS as readonly string[]).includes(planned.activity)) return false;
  return hasLifecycle(planned.activity)
    ? planned.lifecycle === "Set" || planned.lifecycle === "Done"
    : planned.lifecycle === null;
}

/**
 * How a derived activity reads to the rep on Log Visit.
 *
 * They no longer choose it, so the screen's job is to show what the purpose
 * they planned has decided — "Session · to be held later" rather than a
 * dropdown they might change. Set and Done are spelled out because "Set" alone
 * means nothing to somebody who has not read the schema.
 */
export function plannedActivityLabel(planned: PlannedActivity): string {
  const activity = activityLabelFor(planned.activity);
  if (planned.lifecycle === "Set") return `${activity} · to be held later`;
  if (planned.lifecycle === "Done") return `${activity} · held today`;
  return activity;
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

/**
 * The visit form's rules — built against a catalogue rather than a constant.
 *
 * A FACTORY as of stage 4a, and it has to be. The status vocabulary lives in
 * `public.institute_statuses` now (migration 0026 made both columns foreign
 * keys to it), so an admin can add one — and a schema holding a hard-coded list
 * would refuse the very status the database just accepted. Two of the rules
 * here read the catalogue: which statuses are allowed at all, and whether the
 * chosen one leaves the institute open and therefore owes a follow-up date.
 *
 * Built once per request on the server from the loaded catalogue, and once in
 * the browser from the same list handed down as props, so both ends judge the
 * same submission by the same rules. That is the arrangement `feedback.ts`
 * already uses for its two schemas.
 */
export function makeVisitSchema(catalogue: StatusCatalogue) {
  return baseVisitSchema(catalogue);
}

/**
 * The seeded nine, for callers that genuinely have no catalogue to hand.
 *
 * Tests, and nothing else. A server action MUST use `makeVisitSchema()` with
 * the loaded catalogue — using this one would quietly refuse any status an
 * admin has added, which is the whole failure stage 4a exists to prevent.
 */
export const visitSchema = baseVisitSchema(SEED_STATUS_CATALOGUE);

function baseVisitSchema(catalogue: StatusCatalogue) {
  return z
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
    /**
     * COMPULSORY as of stage 4b, where it used to be optional with a "No
     * change" option beside it.
     *
     * Not a tidy-up. Stage 5 rebuilds Pending around institutes whose CURRENT
     * status is open, and a visit that set no status contributes nothing to
     * that: it is not a follow-up owed and it is not a closed loop — it is
     * simply absent, for ever, with nothing anywhere to say it went missing.
     *
     * `enforce_status_required()` (FO024, migration 0027) is the backstop and
     * is INSERT-only, so every visit logged under "No change" stays legal and
     * readable. This is what stops a rep reaching it.
     */
    status_set_to: z
      .string()
      .trim()
      .min(1, "Say where this visit leaves the institute.")
      .refine((v) => selectableStatuses(catalogue).includes(v), {
        message: "Choose one of the listed statuses.",
      }),
    follow_up_date: optionalDate,
    /**
     * DORMANT, and deliberately still accepted.
     *
     * No control posts this any more and `enforce_follow_up_when_open()` no
     * longer asks for it (migration 0023). It stays in the schema for the
     * length of a deploy: a Log Visit page cached from before this shipped
     * still has a time picker on it, and a rep who fills that page in should
     * have what they typed stored rather than silently dropped. Same reasoning
     * as `accuracy` above, pointing the other way — that one tolerates a field
     * being ABSENT from an old form, this one tolerates a field being PRESENT.
     *
     * After the deploy window it is always null, and the column keeps the
     * values 0018-to-0023 recorded.
     */
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
    /*
     * THE DATE IS THE STATUS'S QUESTION NOW, not the purpose's.
     *
     * This read `lifecycle === "Set"`, which keyed the date to what the rep
     * PLANNED rather than to what they are recording. Two consequences, and
     * both were wrong: "Session done" and "Campus visit done" were never asked
     * for a date at all, even though those are the two statuses that know when
     * the thing actually happened; and a rep who planned a Set purpose was
     * asked for one whatever status they ended on.
     *
     * `asks_expected_date` has been on `institute_statuses` since 0026 and is
     * already correct for all four date-bearing statuses — it was simply never
     * read by this form. Nothing in the database changes; log_visit() has
     * stored the value for any session or campus visit since 0026 (D3) removed
     * its own `= 'Set'` test for exactly this reason.
     */
    if (eventDateRequired(catalogue, value.status_set_to) && !value.expected_date) {
      ctx.addIssue({
        code: "custom",
        path: ["expected_date"],
        // One name for one box: the control, this message and the error summary
        // all read the label from the same function.
        message: `Pick a ${eventDateLabel(catalogue, value.status_set_to)}.`,
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

    // Rule 5 — an open status needs a DATE to chase on. Not a time.
    //
    // Mirrors enforce_follow_up_when_open() as migration 0023 rewrites it,
    // which asks the same question of the same lookup table. Two halves of the
    // old rule have now been dropped, in opposite directions and for opposite
    // reasons: 0018 dropped "a follow-up is FORBIDDEN on the two scheduled
    // statuses", and 0023 drops "and a time as well as a date".
    //
    // `follow_up_time` is still ACCEPTED below — see the field — but nothing
    // renders it and nothing requires it.
    if (followUpRequired(catalogue, value.status_set_to) && !value.follow_up_date) {
      ctx.addIssue({
        code: "custom",
        path: ["follow_up_date"],
        message: `"${value.status_set_to}" leaves this open, so a follow-up date is needed.`,
      });
    }
  });
}

export type VisitInput = z.infer<ReturnType<typeof makeVisitSchema>>;

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
  /**
   * What the rep actually means, when the purpose demands it.
   *
   * Only "Other" does today (`purposes.requires_note`, migration 0025). Stored
   * in `daily_plans.purpose_note` and deliberately NOT folded into the label:
   * writing "Other: dropped off brochures" into `purpose` would stop the value
   * matching any purposes row, which is precisely the lookup the activity is
   * now derived from.
   */
  purpose_note: z
    .string()
    .trim()
    .max(300, "That is longer than we can store.")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  /**
   * Whether the chosen purpose demands that note.
   *
   * Carried as a flag rather than inferred from the label, because inferring it
   * would put a second copy of "which purpose is Other" in the app — and the
   * answer lives on the row, where an admin can change it.
   */
  requires_note: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.requires_note && !value.purpose_note) {
    ctx.addIssue({
      code: "custom",
      path: ["purpose_note"],
      message: "Say what this visit is for.",
    });
  }
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

/**
 * Starting a follow-up from Pending.
 *
 * The same three answers a plan entry needs, with the institute already decided
 * by the row that was tapped. Deliberately a separate schema from
 * dailyPlanSchema rather than a reuse: the messages differ, because a rep here
 * has not chosen an institute and telling them to pick one would be nonsense.
 */
export const followUpSchema = z
  .object({
    institute_id: z.uuid("That institute could not be identified."),
    purpose: z
      .string()
      .trim()
      .min(1, "Choose what this follow-up is for.")
      .max(120, "That purpose is too long."),
    purpose_note: z
      .string()
      .trim()
      .max(300, "That is longer than we can store.")
      .transform((v) => (v === "" ? null : v))
      .nullable(),
    requires_note: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.requires_note && !value.purpose_note) {
      ctx.addIssue({
        code: "custom",
        path: ["purpose_note"],
        message: "Say what this visit is for.",
      });
    }
  });

/** Ids arriving from the browser are still input, and still get checked. */
export const planIdSchema = z.uuid("That entry could not be identified.");

export function dailyPlanFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    institute_id: text("institute_id"),
    purpose: text("purpose"),
    purpose_note: text("purpose_note"),
    requires_note: text("requires_note") === "yes",
  };
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
