import { z } from "zod";

/**
 * The short feedback form — what replaced the closing report.
 *
 * The old one asked thirty-odd questions, five of them always required and six
 * more conditional on what the rep said they had done. It was accurate and
 * nobody could finish it at a school gate. This asks seven things, two of them
 * conditional on the status already chosen, and is meant to be done standing up
 * in under a minute.
 *
 * WHAT HAPPENED TO THE OTHER FIELDS. They are still there. Every retired column
 * — activities_conducted, student_response, student_interest, students_reached,
 * most_interested_programs, student_intent, management_response,
 * discussion_summary, visit_outcome, primary_outcome, applications_collected,
 * admissions_generated, session_class, session_streams, session_duration_mins,
 * session_participation, student_questions, other_faculty_*, follow_up_action,
 * employee_remarks — keeps its column and its vocabulary CHECK. Nothing is
 * collected into them and nothing asks for them, so a report filed before this
 * still renders in full and one filed after simply shows fewer rows.
 * `report-view.tsx` skips an empty value already, so that needed no code and no
 * migration. Restoring a field is restoring its control, not writing SQL.
 *
 * THE ONLY OLD RULE THAT HAD TO GO was a database one, and it would have broken
 * this form on its first submission: `visits_follow_up_hidden_when_scheduled`
 * FORBADE a follow-up on exactly the two statuses that now REQUIRE one.
 * Migration 0018 drops it. Every other retired CHECK is vocabulary-only —
 * "null, or one of this list" — so a field simply going unasked cannot trip it.
 */

/**
 * Management's interest level. The one vocabulary the short form kept.
 *
 * It LIVES here rather than in closing-report.ts, and the direction is
 * load-bearing rather than tidy. This module is imported by client components;
 * closing-report.ts still holds `closingReportSchema`, a thirty-field zod
 * schema nothing submits any more. Importing the constant from there pulled
 * that whole schema into the browser bundle — about 44 KiB gzipped for a list
 * of four strings. closing-report.ts now imports it from here instead, which
 * costs a server-only module nothing.
 */
export const MANAGEMENT_INTERESTS = ["Low", "Medium", "High", "Very High"] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "That is longer than we can store.")
    .transform((v) => (v === "" ? null : v))
    .nullable();

const count = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{1,6}$/.test(v), "Whole numbers only.")
  .transform((v) => (v === null ? null : Number(v)));

/**
 * A yes/no that has to be answered, not merely defaulted.
 *
 * "" is a real state here — it means the rep has not touched the control — and
 * it is rejected rather than read as "no". Reading silence as no is how a form
 * this short would start producing data nobody typed.
 */
const yesNo = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "yes" || v === "no", { message })
    .transform((v) => v === "yes");

/**
 * The fields themselves, without the two ids.
 *
 * Split out because the Log Visit screen validates this form BEFORE the visit
 * exists — it logs and files in one submit, so there is no visit_id to check
 * against until log_visit() has run. The standalone feedback screen, which
 * recovers a visit whose filing did not land, has both ids and uses the wider
 * schema below. One shape, one set of rules, two entry points.
 */
const shape = {
    /** Which earlier "Set" this visit closes, when the rep says it does. */
    closes_visit_id: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine(
        (v) =>
          v === null ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
        "That earlier visit could not be identified.",
      ),

    /** The one free-text box. Deliberately the only one. */
    notes: text(2000),

    interested: yesNo("Say whether the institute is interested."),
    management_interest: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine(
        (v) => v === null || (MANAGEMENT_INTERESTS as readonly string[]).includes(v),
        { message: "Choose one of the listed levels." },
      ),

    /** Drives the follow-up rule below, and nothing else. */
    next_meeting_set: yesNo("Say whether a next session or meeting is set."),
    follow_up_date: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date."),
    follow_up_time: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || /^\d{2}:\d{2}$/.test(v), "Pick a time."),

    /** Who to ring. One person, name and number. */
    met_name: text(120),
    met_phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || /^[0-9]{10}$/.test(v), {
        message: "A mobile number is 10 digits.",
      }),

    /**
     * Conditional on the status, not on a checklist.
     *
     * The old form worked out what to ask from `activities_conducted`, a
     * ten-box multi-select the rep filled in themselves. This reads the status
     * they have already chosen, so the same fact is stated once.
     */
    students_attended: count,
    session_topic: text(300),
    session_taken_by: text(120),
};

type Shape = z.infer<z.ZodObject<typeof shape>>;

const refine = (value: Shape, ctx: z.RefinementCtx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    // The whole point of the yes/no: it decides whether the diary fields are
    // required. Mirrored by enforce_follow_up_when_open() in the database,
    // which asks the status rather than this flag — the two agree because the
    // form only offers "yes" alongside a status that leaves the institute open.
    if (value.next_meeting_set) {
      if (!value.follow_up_date) fail("follow_up_date", "When are you seeing them next?");
      if (!value.follow_up_time) fail("follow_up_time", "And at what time?");
    }

    // A phone with no name is a number nobody can place.
    if (value.met_phone && !value.met_name) {
      fail("met_name", "Whose number is this?");
    }
};

/** Used by Log Visit, which files before a visit id exists. */
export const feedbackFieldsSchema = z.object(shape).superRefine(refine);

/** Used by the standalone feedback screen, which has both ids. */
export const feedbackSchema = z
  .object({
    ...shape,
    visit_id: z.uuid(),
    daily_plan_id: z.uuid(),
  })
  .superRefine(refine);

export type FeedbackFieldsInput = z.infer<typeof feedbackFieldsSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;

/**
 * What the status implies the form must also ask.
 *
 * Kept as a predicate pair rather than inlined, so the form and the schema
 * cannot disagree about which visit owes a head count.
 */
export function needsSessionDetail(status: string | null): boolean {
  return status === "Session done";
}

export function needsCampusCount(status: string | null): boolean {
  return status === "Campus visit done";
}

/** Shared so the browser and the server action read the form identically. */
export function feedbackFormDataToInput(formData: FormData) {
  const str = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    visit_id: str("visit_id"),
    daily_plan_id: str("daily_plan_id"),
    closes_visit_id: str("closes_visit_id"),
    notes: str("notes"),
    interested: str("interested"),
    management_interest: str("management_interest"),
    next_meeting_set: str("next_meeting_set"),
    follow_up_date: str("follow_up_date"),
    follow_up_time: str("follow_up_time"),
    met_name: str("met_name"),
    met_phone: str("met_phone"),
    students_attended: str("students_attended"),
    session_topic: str("session_topic"),
    session_taken_by: str("session_taken_by"),
  };
}
