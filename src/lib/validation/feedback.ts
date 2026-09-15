import { z } from "zod";

/**
 * The short closing report — what a rep fills in at the end of a visit.
 *
 * Phase 2 stage 1 cut it further. It asked seven things; it now asks four, plus
 * two that depend on the status already chosen, and is meant to be done
 * standing up in well under a minute.
 *
 * WHAT WAS WITHDRAWN, AND WHERE IT WENT.
 *
 *   "Is the institute interested?"      institute_interested   dormant
 *   "How did the visit end?"            visit_outcome          dormant
 *   "How did management respond?"       management_response    dormant
 *   "How did the students respond?"     student_response       dormant
 *   "Students who participated"         students_reached       dormant
 *   "Is a next session or meeting set?" (no column — see below)
 *
 * NONE OF THAT NEEDED A MIGRATION, and that is the whole point of how
 * `close_visit()` is written: every report field is a DEFAULTED parameter, so a
 * field leaving the form is the app passing null. The column keeps its data and
 * its vocabulary CHECK, `report-view.tsx` still renders every report filed
 * under an older shape, and bringing one back is restoring a control. 0019's
 * header says the same thing from the other direction — "a field coming back is
 * a form change, and a migration only because close_visit() has to carry it".
 * Going this way there is nothing for it to carry.
 *
 * `students_reached` is dormant for the SECOND time (0009 built it, 0022 woke
 * it, this retires it again). One count is what the client's spec asks for, and
 * `students_attended` is the one every filed report already carries.
 * `report-view.tsx` labels the old rows by era, so nothing filed before this
 * starts meaning something different.
 *
 * THE FOLLOW-UP IS NOT HERE ANY MORE, AND THAT IS A BUG FIX.
 *
 * `follow_up_date` and `follow_up_time` used to sit in this schema as well as
 * in `visitSchema`, gated by an "Is a next session or meeting set?" yes/no.
 * Two things were wrong with that:
 *
 *   1. The yes/no was a second answer to a question the STATUS already
 *      answered, and the two could disagree. Choosing an open status and
 *      answering "No" hid the date fields while `visitSchema` still required
 *      them — the error summary named a field that was not on the screen, and
 *      there was no way forward but guessing.
 *   2. On the RECOVERY path this schema is submitted to `close_visit()`, which
 *      does not write `follow_up_date` or `follow_up_time` at all. Anything the
 *      rep typed there was silently discarded. No data was lost — the values
 *      were written by `log_visit()` at log time — but the field was a lie.
 *
 * So the follow-up lives in `visitSchema` alone, where the rule already was:
 * an OPEN status requires a date and a time, mirroring
 * `enforce_follow_up_when_open()` (FO016). The Log Visit screen renders it
 * beside the status that decides it; the recovery form does not ask, because it
 * cannot save it.
 */

/**
 * The three vocabularies the closing report used to collect.
 *
 * Kept, and kept HERE rather than in closing-report.ts, though nothing submits
 * them any more: `closingReportSchema` still imports them back, and every one
 * of them matches a CHECK constraint added in 0005 that is still installed. A
 * dropdown coming back is these lists plus a control.
 *
 * They no longer reach the browser bundle, because the controls that read them
 * are gone.
 */
export const VISIT_OUTCOMES = [
  "Successful",
  "Partially successful",
  "Follow-up required",
  "Postponed",
  "Not interested",
] as const;

export const MANAGEMENT_RESPONSES = [
  "Supportive",
  "Interested",
  "Wants a proposal",
  "Needs internal approval",
  "Budget concerns",
  "Not interested",
  "Not available",
] as const;

export const STUDENT_RESPONSES = [
  "Very positive",
  "Positive",
  "Mixed",
  "Low interest",
  "No students present",
] as const;

/**
 * Management's interest LEVEL — withdrawn before stage 3 shipped, and still
 * withdrawn. The column stays dormant on public.visits and this list stays here
 * because report-view.tsx still renders a report that has one.
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
 * The fields themselves, without the two ids.
 *
 * Split out because the Log Visit screen validates this form BEFORE the visit
 * exists — it logs and files in one submit, so there is no visit_id to check
 * against until log_visit() has run. The standalone feedback screen, which
 * recovers a visit whose filing did not land, has both ids and uses the wider
 * schema below. One shape, one set of rules, two entry points.
 *
 * Every field here is one `close_visit()` actually writes. That is the rule the
 * follow-up broke and the reason it left.
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

  /** "How did it go?" — the one free-text box, and now the whole of it. */
  notes: text(2000),

  /**
   * Who was met. One person: a name, and a number if the rep got one.
   *
   * THE NAME IS REQUIRED AND THE NUMBER IS NOT, which is the client's spec and
   * is the reverse of how this pair used to behave. A visit with no name
   * against it is not a record anybody can act on — "we met someone at St
   * Xavier's" — and there is always a name. A mobile genuinely is not always
   * there. Hence: always ask who, never insist how to ring them.
   *
   * NOTHING IN THE DATABASE ENFORCES THE FIRST HALF. `visits_met_name_length`
   * and `visits_met_phone_valid` (0018) are both "null, or valid", and both
   * still are: reports filed before this rule have a null met_name and still
   * render. A NOT NULL would have refused to build against them.
   */
  met_name: z
    .string()
    .trim()
    .min(1, "Who did you meet?")
    .max(120, "That is longer than we can store."),
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
   * ONE COUNT, not two. `students_attended` is everybody who was there — in the
   * room for a session, or on the campus for a visit. It is the number this
   * form has always asked for and the one every filed report already carries.
   * The second count 0022 added is withdrawn; see the note at the top.
   *
   * NOT REQUIRED, and never has been: a rep at a school gate who did not count
   * heads must still be able to file.
   */
  students_attended: count,
  session_topic: text(300),
  session_taken_by: text(120),
};

/** Used by Log Visit, which files before a visit id exists. */
export const feedbackFieldsSchema = z.object(shape);

/**
 * Used by the standalone feedback screen, which has both ids.
 *
 * There is no `superRefine` on either any more. Both rules that lived there —
 * the follow-up gate and "participated may not exceed present" — went with the
 * fields they governed.
 */
export const feedbackSchema = z.object({
  ...shape,
  visit_id: z.uuid(),
  /**
   * Null when the check-in this visit came from is already closed — swept
   * overnight, or cleared by an admin. The report is still owed and is still
   * filed; there is simply no check-out left to stamp, and asking for one would
   * be refused by daily_plans_checkout_missing_valid.
   */
  daily_plan_id: z.uuid().nullable(),
});

export type FeedbackFieldsInput = z.infer<typeof feedbackFieldsSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;

/**
 * What the status implies the form must also ask.
 *
 * Kept as a predicate pair rather than inlined, so the form and the schema
 * cannot disagree about which visit owes a head count. Stage 4a of Phase 2
 * replaces the literals with the `asks_session_detail` / `asks_head_count`
 * columns on `public.institute_statuses`, at which point a status an admin adds
 * can ask for these too. Until then they are the two the vocabulary has.
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
    daily_plan_id: str("daily_plan_id") || null,
    closes_visit_id: str("closes_visit_id"),
    notes: str("notes"),
    met_name: str("met_name"),
    met_phone: str("met_phone"),
    students_attended: str("students_attended"),
    session_topic: str("session_topic"),
    session_taken_by: str("session_taken_by"),
  };
}

/* ------------------------------------------------------------------ */
/* The form's own state                                                */
/* ------------------------------------------------------------------ */

/**
 * What the short form holds while it is being filled in.
 *
 * It lives HERE rather than in the component so this file — which the unit
 * tests already import, and which pulls in no React — owns both the shape and
 * the one operation performed on it.
 *
 * The follow-up is deliberately absent. It belongs to the visit, not to the
 * report, so `log-visit-form.tsx` holds it in its own state alongside the
 * status that decides whether it is required.
 */
export interface FeedbackState {
  metName: string;
  metPhone: string;
  studentsAttended: string;
  sessionTopic: string;
  sessionTakenBy: string;
  closesVisitId: string;
}

export const EMPTY_FEEDBACK: FeedbackState = {
  metName: "",
  metPhone: "",
  studentsAttended: "",
  sessionTopic: "",
  sessionTakenBy: "",
  closesVisitId: "",
};

/** One field's worth of change. */
export type FeedbackPatch = Partial<FeedbackState>;

/**
 * Apply one field's change to the state.
 *
 * Trivial on its own, and the point is WHERE it is called rather than what it
 * does: inside a functional update, so `prev` is the latest state rather than
 * whatever the component last rendered with.
 *
 * The bug this replaces was found by driving the live form: two taps in the
 * same tick both merged against the same stale prop, and the first answer
 * vanished. A rep tapping seconds apart would never have seen it, which is why
 * it survived every other check — the property worth pinning is that patches
 * COMPOSE, and that is what the test asserts.
 */
export function applyFeedbackPatch(
  prev: FeedbackState,
  patch: FeedbackPatch,
): FeedbackState {
  return { ...prev, ...patch };
}
