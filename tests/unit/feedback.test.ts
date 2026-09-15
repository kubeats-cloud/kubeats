import { describe, expect, it } from "vitest";
import {
  EMPTY_FEEDBACK,
  MANAGEMENT_RESPONSES,
  STUDENT_RESPONSES,
  VISIT_OUTCOMES,
  applyFeedbackPatch,
  feedbackFieldsSchema,
  feedbackSchema,
  type FeedbackState,
} from "@/lib/validation/feedback";
import {
  SEED_STATUS_CATALOGUE,
  statusRow,
} from "@/lib/validation/institute";

/**
 * The short closing report: the state the form holds, and the rules it applies.
 *
 * The state half exists as testable code at all because of a bug found by
 * driving the live form — see the composition suite below.
 */

const filled = (over: Partial<Record<string, string>> = {}) => ({
  closes_visit_id: "",
  notes: "A note",
  students_attended: "",
  session_topic: "",
  session_taken_by: "",
  ...over,
});

describe("applyFeedbackPatch — two changes in one tick both survive", () => {
  it("composes, which is the property the old code lost", () => {
    // THE REGRESSION. FeedbackFields used to hand back `{ ...value, [key]: v }`
    // — the whole state, merged against the `value` PROP. Two changes before a
    // re-render therefore merged against the same stale object and the second
    // overwrote the first.
    //
    // Patches compose, so applying them in sequence keeps both. That is what
    // the parent now does inside a functional update.
    const first = applyFeedbackPatch(EMPTY_FEEDBACK, { sessionTopic: "Careers" });
    const second = applyFeedbackPatch(first, { sessionTakenBy: "Dr Rao" });

    expect(second.sessionTopic, "the first answer must survive").toBe("Careers");
    expect(second.sessionTakenBy).toBe("Dr Rao");
  });

  it("shows what the old merge did, so the difference is on the record", () => {
    // The old component computed `{ ...value, [key]: v }` itself, where `value`
    // was the PROP it last rendered with. Two changes before a re-render both
    // started from that same object. Reproduced here against a fixed `stale`
    // to show the loss concretely rather than describing it.
    const stale = EMPTY_FEEDBACK;
    const oldFirst = { ...stale, sessionTopic: "Careers" };
    const oldSecond = { ...stale, sessionTakenBy: "Dr Rao" }; // still merging `stale`
    expect(oldSecond.sessionTopic, "the old way dropped the first answer").toBe("");
    expect(oldFirst.sessionTopic).toBe("Careers"); // it existed, then was overwritten

    // The new way threads the result through, so nothing is dropped.
    const now = applyFeedbackPatch(
      applyFeedbackPatch(stale, { sessionTopic: "Careers" }),
      { sessionTakenBy: "Dr Rao" },
    );
    expect(now.sessionTopic).toBe("Careers");
    expect(now.sessionTakenBy).toBe("Dr Rao");
  });

  it("survives a whole form filled one field at a time", () => {
    const answers: [keyof FeedbackState, string][] = [
      ["studentsAttended", "40"],
      ["sessionTopic", "Careers after 12th"],
      ["sessionTakenBy", "Dr Rao"],
    ];
    const end = answers.reduce(
      (state, [key, value]) => applyFeedbackPatch(state, { [key]: value }),
      EMPTY_FEEDBACK,
    );
    for (const [key, value] of answers) expect(end[key], key).toBe(value);
  });

  it("never mutates the state it was given", () => {
    // A functional update hands back the PREVIOUS state; mutating it would make
    // React's own bail-out checks see no change.
    const before = { ...EMPTY_FEEDBACK };
    applyFeedbackPatch(before, { sessionTopic: "Careers" });
    expect(before).toEqual(EMPTY_FEEDBACK);
  });

  it("starts every field empty, so nothing is answered by default", () => {
    for (const [key, value] of Object.entries(EMPTY_FEEDBACK)) {
      expect(value, key).toBe("");
    }
  });
});

/**
 * C19 — the rule that keeps this form honest.
 *
 * `close_visit()` is the only thing this form submits to, and it does NOT write
 * `follow_up_date` or `follow_up_time`. While they sat in this schema the
 * standalone recovery form asked for them and threw the answer away, in
 * silence. They now live in `visitSchema` alone, where the rule already was and
 * where `log_visit()` actually stores them.
 *
 * Asserted as a whole-shape check rather than two absences, because the
 * property worth keeping is the general one: every key here is a column
 * close_visit writes. Adding a field this form cannot save should fail loudly.
 */
describe("the report asks only for what close_visit() can save", () => {
  const WRITES = [
    "closes_visit_id",
    "notes",
    "students_attended",
    "session_topic",
    "session_taken_by",
  ].toSorted();

  it("the log-time schema carries exactly those fields", () => {
    expect(Object.keys(feedbackFieldsSchema.shape).toSorted()).toEqual(WRITES);
  });

  it("the recovery schema carries those plus the two ids, and nothing else", () => {
    expect(Object.keys(feedbackSchema.shape).toSorted()).toEqual(
      [...WRITES, "visit_id", "daily_plan_id"].toSorted(),
    );
  });

  it("does not ask for a follow-up, because it could never store one", () => {
    // The specific half of the rule above, spelled out so a failure names the
    // actual bug rather than a key-list diff.
    expect(Object.keys(feedbackFieldsSchema.shape)).not.toContain("follow_up_date");
    expect(Object.keys(feedbackFieldsSchema.shape)).not.toContain("follow_up_time");
    expect(Object.keys(feedbackSchema.shape)).not.toContain("follow_up_date");
    expect(Object.keys(feedbackSchema.shape)).not.toContain("follow_up_time");
  });

  it("does not ask the five questions Phase 2 withdrew", () => {
    // Their columns are dormant, not dropped — report-view.tsx still renders a
    // report that has them. What must not come back is this form collecting
    // them, because nothing on screen shows them any more.
    for (const gone of [
      "interested",
      "visit_outcome",
      "management_response",
      "student_response",
      "students_reached",
      "next_meeting_set",
    ]) {
      expect(Object.keys(feedbackFieldsSchema.shape), gone).not.toContain(gone);
    }
  });
});

describe("the short form's rules", () => {
  it("accepts a filled report", () => {
    expect(feedbackFieldsSchema.safeParse(filled()).success).toBe(true);
  });

  it("no longer asks who was met, and refuses to be told", () => {
    // Change #17. The decision-maker is captured at institute registration, so
    // the per-visit pair was asking for a fact the registry already holds.
    //
    // Asserted as ABSENCE FROM THE SCHEMA rather than as "an empty name is
    // accepted", because the columns are dormant and not dropped: a schema that
    // merely stopped REQUIRING a name would still pass one through to
    // close_visit, and the whole point is that nothing new is written to them.
    expect(feedbackFieldsSchema.shape).not.toHaveProperty("met_name");
    expect(feedbackFieldsSchema.shape).not.toHaveProperty("met_phone");
    expect(feedbackSchema.shape).not.toHaveProperty("met_name");
    expect(feedbackSchema.shape).not.toHaveProperty("met_phone");

    // And a form that posts them anyway — a page cached from before this
    // change — parses fine and simply drops them, rather than failing a rep who
    // has already walked to the school.
    const stale = feedbackFieldsSchema.safeParse(
      filled({ met_name: "A Person", met_phone: "9876543210" }),
    );
    expect(stale.success).toBe(true);
    if (stale.success) {
      expect(stale.data).not.toHaveProperty("met_name");
      expect(stale.data).not.toHaveProperty("met_phone");
    }
  });

  it("takes ONE student count, and does not insist on it", () => {
    // Two counts shipped with 0022 and the client's spec asks one question
    // about students, not two. students_reached is dormant again; the column
    // and its data are untouched.
    //
    // Not required, and never has been: a rep at a school gate who did not
    // count heads must still be able to file.
    expect(
      feedbackFieldsSchema.safeParse(filled({ students_attended: "" })).success,
      "blank is a filable report",
    ).toBe(true);

    const result = feedbackFieldsSchema.safeParse(filled({ students_attended: "40" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.students_attended).toBe(40);
  });

  it("refuses a count that is not a whole number", () => {
    expect(
      feedbackFieldsSchema.safeParse(filled({ students_attended: "forty" })).success,
    ).toBe(false);
  });

  it("asks the session questions for a session, and the count alone for a campus visit", () => {
    // Driven by the STATUS the rep already chose, and as of stage 4a by DATA
    // rather than by a literal: needsSessionDetail()/needsCampusCount() compared
    // the status to "Session done" and "Campus visit done", which stopped being
    // possible once an admin could add one. Migration 0026 moved the answer onto
    // public.institute_statuses, and the seed below is what the app falls back
    // to and what the database is checked against.
    const asks = (status: string | null) => {
      const row = statusRow(SEED_STATUS_CATALOGUE, status);
      return {
        sessionDetail: row?.asksSessionDetail ?? false,
        headCount: row?.asksHeadCount ?? false,
      };
    };

    expect(asks("Session done")).toEqual({ sessionDetail: true, headCount: true });
    expect(asks("Campus visit done")).toEqual({
      sessionDetail: false,
      headCount: true,
    });
    // A status with nothing extra behind it, and no status at all.
    expect(asks("First meeting done")).toEqual({
      sessionDetail: false,
      headCount: false,
    });
    expect(asks(null)).toEqual({ sessionDetail: false, headCount: false });
  });

  it("asks nothing extra for a status the catalogue has never heard of", () => {
    // The fallback that matters after 0026: an admin can retire a status while
    // a page is still holding it. Unknown must mean "no extra questions", never
    // a crash and never a half-rendered section.
    const row = statusRow(SEED_STATUS_CATALOGUE, "Invented by a stale client");
    expect(row).toBeNull();
  });

  it("keeps the vocabularies of the questions it stopped asking", () => {
    // Withdrawn from the form, not from the app. Each still matches a CHECK
    // installed by 0005, report-view.tsx still renders reports that carry them,
    // and bringing a dropdown back is these lists plus a control — never a
    // migration.
    expect(VISIT_OUTCOMES).toContain("Successful");
    expect(MANAGEMENT_RESPONSES).toContain("Supportive");
    expect(STUDENT_RESPONSES).toContain("Very positive");
  });
});
