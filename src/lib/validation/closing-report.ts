import { z } from "zod";

/**
 * The closing report's vocabulary and its conditional rules.
 *
 * Every list here is mirrored by a CHECK constraint in migration 0005. The
 * constraint is the backstop; this is what the rep sees and what decides which
 * questions are even asked.
 *
 * The whole design is conditional. A rep who ran a career session and a rep who
 * had a ten-minute conversation with a receptionist both filed "a visit", and
 * asking the second one for a participation level would train everybody to type
 * nonsense into required fields. So the report asks for what happened, and then
 * insists only on the parts that follow from it.
 */

/** Only these three get a closing report. The rest stay quick logs. */
export const RICH_ACTIVITIES = ["meeting", "session", "campus_visit"] as const;

export function needsClosingReport(activity: string): boolean {
  return (RICH_ACTIVITIES as readonly string[]).includes(activity);
}

export const ACTIVITIES_CONDUCTED = [
  "Introduction meeting",
  "Management meeting",
  "Career guidance session",
  "Seminar or workshop",
  "Faculty Interaction",
  "Campus visit",
  "Olympiad registration",
  "Application collection",
  "Admission counselling",
  "Follow-up discussion",
] as const;

/** The two that mean students were actually taught, and so need session detail. */
export const SESSION_ACTIVITIES = [
  "Career guidance session",
  "Seminar or workshop",
] as const;

export const MANAGEMENT_ACTIVITY = "Management meeting";
export const APPLICATION_ACTIVITY = "Application collection";
export const ADMISSION_ACTIVITY = "Admission counselling";

export const CONTACT_TYPES = [
  "Principal",
  "Vice Principal",
  "Career Counsellor",
  "Management",
  "Coordinator",
  "Faculty",
  "Admission Counsellor",
  "Owner",
  "Other",
] as const;

export const STUDENT_RESPONSES = [
  "Very positive",
  "Positive",
  "Mixed",
  "Low interest",
  "No students present",
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

export const VISIT_OUTCOMES = [
  "Successful",
  "Partially successful",
  "Follow-up required",
  "Postponed",
  "Not interested",
] as const;

export const SESSION_CLASSES = ["9", "10", "11", "12", "Mixed"] as const;
export const SESSION_STREAMS = ["science", "commerce", "humanities"] as const;
export const PARTICIPATION_LEVELS = ["Low", "Moderate", "High", "Very High"] as const;

/** B — student interaction. */
export const INTEREST_PROGRAMS = [
  "Engineering",
  "Computer Science",
  "AI/ML",
  "Management",
  "Design",
  "Commerce",
  "Law",
  "Other",
] as const;

export const STUDENT_INTENTS = [
  "Just Information",
  "Exploring Options",
  "Interested",
  "Strongly Interested",
  "Ready for Campus Visit",
] as const;

/** C — management interest level, distinct from the response checkboxes. */
export const MANAGEMENT_INTERESTS = ["Low", "Medium", "High", "Very High"] as const;

/** D — the primary outcome category, distinct from visit_outcome. */
export const PRIMARY_OUTCOMES = [
  "Meeting completed",
  "Career session completed",
  "Campus visit discussed",
  "Campus visit confirmed",
  "Application drive planned",
  "Follow-up meeting required",
  "Information requested",
  "Admission discussion completed",
  "Partnership discussion initiated",
  "Other",
] as const;

export const hasSession = (activities: string[]) =>
  activities.some((a) => (SESSION_ACTIVITIES as readonly string[]).includes(a));
export const hasManagement = (activities: string[]) =>
  activities.includes(MANAGEMENT_ACTIVITY);
export const hasApplications = (activities: string[]) =>
  activities.includes(APPLICATION_ACTIVITY);
export const hasAdmissions = (activities: string[]) =>
  activities.includes(ADMISSION_ACTIVITY);

/* ------------------------------------------------------------------ */
/* People met                                                          */
/* ------------------------------------------------------------------ */

export const personSchema = z.object({
  name: z.string().trim().min(1, "Who did you meet?").max(120, "That name is too long."),
  contact_type: z.enum(CONTACT_TYPES, { message: "Choose what they do." }),
  designation: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  contact_number: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^[0-9]{10}$/.test(v), {
      message: "A mobile number is 10 digits.",
    }),
  is_decision_maker: z.boolean(),
});

export type PersonInput = z.infer<typeof personSchema>;

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

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

const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || (values as readonly string[]).includes(v), {
      message: "Choose one of the listed options.",
    });

const manyOf = <T extends readonly string[]>(values: T) =>
  z
    .array(z.string())
    .default([])
    .refine((list) => list.every((v) => (values as readonly string[]).includes(v)), {
      message: "That is not one of the listed options.",
    });

export const closingReportSchema = z
  .object({
    visit_id: z.uuid(),
    people: z.array(personSchema),
    activities_conducted: manyOf(ACTIVITIES_CONDUCTED),

    // Session detail
    session_topic: text(300),
    session_class: oneOf(SESSION_CLASSES),
    session_streams: manyOf(SESSION_STREAMS),
    students_attended: count,
    session_duration_mins: count,
    other_faculty_present: text(300),
    other_faculty_count: count,
    session_participation: oneOf(PARTICIPATION_LEVELS),
    student_questions: text(2000),
    // B) Student interaction. students_reached sits beside students_attended
    //    above and is distinct from it.
    students_reached: count,

    // Response / student interaction
    student_response: oneOf(STUDENT_RESPONSES),
    student_interest: count,
    most_interested_programs: manyOf(INTEREST_PROGRAMS),
    student_intent: oneOf(STUDENT_INTENTS),
    management_response: manyOf(MANAGEMENT_RESPONSES),
    management_feedback: text(2000),
    // C) Management interest level.
    management_interest: oneOf(MANAGEMENT_INTERESTS),

    // Outcome
    discussion_summary: text(4000),
    visit_outcome: oneOf(VISIT_OUTCOMES),
    // D) Primary outcome category.
    primary_outcome: oneOf(PRIMARY_OUTCOMES),
    applications_collected: count,
    admissions_generated: count,

    follow_up_needed: z.boolean(),
    follow_up_action: text(500),
    follow_up_date: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date."),

    employee_remarks: text(2000),
  })
  .superRefine((value, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    // Always required — the four things that make a report a report.
    if (value.activities_conducted.length === 0) {
      fail("activities_conducted", "Tick at least one thing you did.");
    }
    if (value.people.length === 0) {
      fail("people", "Add at least one person you met.");
    }
    if (!value.discussion_summary) {
      fail("discussion_summary", "Summarise what was discussed.");
    }
    if (!value.visit_outcome) {
      fail("visit_outcome", "How did the visit end?");
    }
    // D) The primary outcome is a headline classification, wanted on every
    //    filed report, so it is always required.
    if (!value.primary_outcome) {
      fail("primary_outcome", "What was the primary outcome?");
    }

    // Required only because of what the rep said happened.
    if (hasSession(value.activities_conducted)) {
      if (!value.session_topic) fail("session_topic", "What was the session about?");
      if (value.students_attended === null) {
        fail("students_attended", "How many students attended?");
      }
      if (!value.session_class) fail("session_class", "Which class?");
      if (!value.session_participation) {
        fail("session_participation", "How engaged were they?");
      }
    }

    if (hasManagement(value.activities_conducted)) {
      if (value.management_response.length === 0) {
        fail("management_response", "How did management respond?");
      }
      if (!value.management_feedback) {
        fail("management_feedback", "What did they say?");
      }
      // C) When there was a management meeting, an interest level is expected.
      if (!value.management_interest) {
        fail("management_interest", "How interested is management?");
      }
    }

    if (hasApplications(value.activities_conducted) && value.applications_collected === null) {
      fail("applications_collected", "How many application forms did you collect?");
    }
    if (hasAdmissions(value.activities_conducted) && value.admissions_generated === null) {
      fail("admissions_generated", "How many admissions came from this?");
    }

    if (value.follow_up_needed) {
      if (!value.follow_up_action) fail("follow_up_action", "What needs doing next?");
      if (!value.follow_up_date) fail("follow_up_date", "When?");
    }

    if (value.student_interest !== null && (value.student_interest < 1 || value.student_interest > 5)) {
      fail("student_interest", "Rate interest from 1 to 5.");
    }
  });

export type ClosingReportInput = z.infer<typeof closingReportSchema>;

/**
 * Shared so the browser and the server read the form identically.
 *
 * The people are carried as one JSON field. A dynamic list of rows has no
 * natural FormData shape, and parsing `people[3][name]` by hand is exactly the
 * sort of code that quietly loses a row.
 */
export function closingReportFormDataToInput(formData: FormData) {
  const str = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  const many = (key: string) =>
    formData.getAll(key).filter((v): v is string => typeof v === "string");

  let people: unknown = [];
  try {
    people = JSON.parse(str("people") || "[]");
  } catch {
    people = [];
  }

  return {
    visit_id: str("visit_id"),
    people,
    activities_conducted: many("activities_conducted"),
    session_topic: str("session_topic"),
    session_class: str("session_class"),
    session_streams: many("session_streams"),
    students_attended: str("students_attended"),
    session_duration_mins: str("session_duration_mins"),
    other_faculty_present: str("other_faculty_present"),
    other_faculty_count: str("other_faculty_count"),
    session_participation: str("session_participation"),
    student_questions: str("student_questions"),
    students_reached: str("students_reached"),
    student_response: str("student_response"),
    student_interest: str("student_interest"),
    most_interested_programs: many("most_interested_programs"),
    student_intent: str("student_intent"),
    management_response: many("management_response"),
    management_feedback: str("management_feedback"),
    management_interest: str("management_interest"),
    discussion_summary: str("discussion_summary"),
    visit_outcome: str("visit_outcome"),
    primary_outcome: str("primary_outcome"),
    applications_collected: str("applications_collected"),
    admissions_generated: str("admissions_generated"),
    follow_up_needed: str("follow_up_needed") === "yes",
    follow_up_action: str("follow_up_action"),
    follow_up_date: str("follow_up_date"),
    employee_remarks: str("employee_remarks"),
  };
}

/* ------------------------------------------------------------------ */
/* Admin assignment                                                    */
/* ------------------------------------------------------------------ */

export const assignVisitSchema = z.object({
  member: z.uuid("Choose a rep."),
  institute_id: z.uuid("Choose an institute."),
  purpose: z.string().trim().min(1, "Choose a purpose.").max(120),
  date: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date."),
});
