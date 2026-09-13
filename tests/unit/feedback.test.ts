import { describe, expect, it } from "vitest";
import {
  EMPTY_FEEDBACK,
  MANAGEMENT_RESPONSES,
  STUDENT_RESPONSES,
  VISIT_OUTCOMES,
  applyFeedbackPatch,
  feedbackFieldsSchema,
  needsCampusCount,
  needsSessionDetail,
  type FeedbackState,
} from "@/lib/validation/feedback";

/**
 * The short closing report: the state the form holds, and the rules it applies.
 *
 * The state half exists as testable code at all because of a bug found by
 * driving the live form — see the composition suite below.
 */

const filled = (over: Partial<Record<string, string>> = {}) => ({
  closes_visit_id: "",
  notes: "A note",
  interested: "yes",
  visit_outcome: "Successful",
  management_response: "Supportive",
  student_response: "Very positive",
  next_meeting_set: "no",
  follow_up_date: "",
  follow_up_time: "",
  met_name: "A Person",
  met_phone: "9876543210",
  students_attended: "",
  students_reached: "",
  session_topic: "",
  session_taken_by: "",
  ...over,
});

describe("applyFeedbackPatch — two changes in one tick both survive", () => {
  it("composes, which is the property the old code lost", () => {
    // THE REGRESSION. FeedbackFields used to hand back `{ ...value, [key]: v }`
    // — the whole state, merged against the `value` PROP. Two changes before a
    // re-render therefore merged against the same stale object and the second
    // overwrote the first. Tapping "Yes" on one question and "No" on the next
    // in the same tick lost the "Yes".
    //
    // Patches compose, so applying them in sequence keeps both. That is what
    // the parent now does inside a functional update.
    const first = applyFeedbackPatch(EMPTY_FEEDBACK, { interested: "yes" });
    const second = applyFeedbackPatch(first, { nextMeetingSet: "no" });

    expect(second.interested, "the first answer must survive").toBe("yes");
    expect(second.nextMeetingSet).toBe("no");
  });

  it("shows what the old merge did, so the difference is on the record", () => {
    // The old component computed `{ ...value, [key]: v }` itself, where `value`
    // was the PROP it last rendered with. Two changes before a re-render both
    // started from that same object. Reproduced here against a fixed `stale`
    // to show the loss concretely rather than describing it.
    const stale = EMPTY_FEEDBACK;
    const oldFirst = { ...stale, interested: "yes" };
    const oldSecond = { ...stale, nextMeetingSet: "no" }; // still merging `stale`
    expect(oldSecond.interested, "the old way dropped the first answer").toBe("");
    expect(oldFirst.interested).toBe("yes"); // it existed, then was overwritten

    // The new way threads the result through, so nothing is dropped.
    const now = applyFeedbackPatch(
      applyFeedbackPatch(stale, { interested: "yes" }),
      { nextMeetingSet: "no" },
    );
    expect(now.interested).toBe("yes");
    expect(now.nextMeetingSet).toBe("no");
  });

  it("survives a whole form filled one field at a time", () => {
    const answers: [keyof FeedbackState, string][] = [
      ["interested", "yes"],
      ["visitOutcome", "Successful"],
      ["managementResponse", "Supportive"],
      ["studentResponse", "Very positive"],
      ["nextMeetingSet", "yes"],
      ["followUpDate", "2026-09-30"],
      ["followUpTime", "10:30"],
      ["metName", "A Person"],
      ["metPhone", "9876543210"],
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
    applyFeedbackPatch(before, { interested: "yes" });
    expect(before).toEqual(EMPTY_FEEDBACK);
  });

  it("starts every field empty, so nothing is answered by default", () => {
    // "" is a real state: it means the rep has not touched the control, and the
    // schema rejects it rather than reading silence as "no".
    for (const [key, value] of Object.entries(EMPTY_FEEDBACK)) {
      expect(value, key).toBe("");
    }
  });
});

describe("the short form's rules", () => {
  it("accepts a filled report", () => {
    expect(feedbackFieldsSchema.safeParse(filled()).success).toBe(true);
  });

  it("refuses an unanswered yes/no rather than reading it as no", () => {
    expect(feedbackFieldsSchema.safeParse(filled({ interested: "" })).success).toBe(
      false,
    );
    expect(
      feedbackFieldsSchema.safeParse(filled({ next_meeting_set: "" })).success,
    ).toBe(false);
  });

  it("demands a date AND a time when a next meeting is set", () => {
    expect(
      feedbackFieldsSchema.safeParse(filled({ next_meeting_set: "yes" })).success,
    ).toBe(false);
    expect(
      feedbackFieldsSchema.safeParse(
        filled({ next_meeting_set: "yes", follow_up_date: "2026-09-30" }),
      ).success,
      "a date with no time is still refused",
    ).toBe(false);
    expect(
      feedbackFieldsSchema.safeParse(
        filled({
          next_meeting_set: "yes",
          follow_up_date: "2026-09-30",
          follow_up_time: "10:30",
        }),
      ).success,
    ).toBe(true);
  });

  it("asks for nothing extra when no next meeting is set", () => {
    expect(
      feedbackFieldsSchema.safeParse(filled({ next_meeting_set: "no" })).success,
    ).toBe(true);
  });

  it("insists on a name for the person met", () => {
    // The client's spec: name required, phone optional. This used to be the
    // weaker "a phone with no name is a number nobody can place", which let a
    // report be filed naming nobody at all.
    expect(
      feedbackFieldsSchema.safeParse(filled({ met_name: "" })).success,
    ).toBe(false);
    expect(
      feedbackFieldsSchema.safeParse(filled({ met_name: "   " })).success,
      "whitespace is not a name",
    ).toBe(false);
  });

  it("takes a name with no mobile behind it", () => {
    // The other half of the same rule, and the half that changed. A rep does
    // not always come away with a number; they always come away with a name.
    const result = feedbackFieldsSchema.safeParse(filled({ met_phone: "" }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.met_phone).toBeNull();
      expect(result.data.met_name).toBe("A Person");
    }
  });

  it("still refuses a mobile that is not ten digits", () => {
    // Optional means "may be absent", not "may be wrong". A half-typed number
    // is a number that will not dial, and visits_met_phone_valid (0018) would
    // refuse it anyway.
    expect(
      feedbackFieldsSchema.safeParse(filled({ met_phone: "98765" })).success,
    ).toBe(false);
  });

  it("refuses a vocabulary the database would refuse too", () => {
    // Each of these mirrors a CHECK added in 0005. A value the app lets through
    // but the database rejects is a rep staring at a save that will not work.
    expect(
      feedbackFieldsSchema.safeParse(filled({ visit_outcome: "Invented" })).success,
    ).toBe(false);
    expect(
      feedbackFieldsSchema.safeParse(filled({ management_response: "Invented" }))
        .success,
    ).toBe(false);
    expect(
      feedbackFieldsSchema.safeParse(filled({ student_response: "Invented" })).success,
    ).toBe(false);
  });

  it("takes two student counts, and insists on neither", () => {
    // The client's spec wants PRESENT and PARTICIPATED separately. Neither is
    // required: a rep who did not count heads must still be able to file, which
    // is how students_attended has always behaved in this form.
    expect(
      feedbackFieldsSchema.safeParse(filled({ students_attended: "", students_reached: "" }))
        .success,
      "both blank is a filable report",
    ).toBe(true);

    const result = feedbackFieldsSchema.safeParse(
      filled({ students_attended: "40", students_reached: "12" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // PRESENT lands in students_attended, PARTICIPATED in students_reached —
      // the mapping migration 0022 writes onto the columns. Swap these two and
      // every filed report means the opposite of what it says.
      expect(result.data.students_attended, "present").toBe(40);
      expect(result.data.students_reached, "participated").toBe(12);
    }
  });

  it("refuses more participants than people in the room", () => {
    // Two similar boxes invite the two numbers the wrong way round, and that is
    // the one thing the pair can say that cannot be true.
    expect(
      feedbackFieldsSchema.safeParse(
        filled({ students_attended: "12", students_reached: "40" }),
      ).success,
    ).toBe(false);

    // Equal is fine — everybody who was there joined in.
    expect(
      feedbackFieldsSchema.safeParse(
        filled({ students_attended: "40", students_reached: "40" }),
      ).success,
    ).toBe(true);

    // ...and the rule only fires when BOTH are filled, or it would make one
    // required through the back door.
    expect(
      feedbackFieldsSchema.safeParse(
        filled({ students_attended: "", students_reached: "40" }),
      ).success,
      "participated alone is still a valid report",
    ).toBe(true);
    expect(
      feedbackFieldsSchema.safeParse(
        filled({ students_attended: "40", students_reached: "" }),
      ).success,
    ).toBe(true);
  });

  it("asks the session questions for a session, and the count alone for a campus visit", () => {
    // Driven by the STATUS the rep already chose, not by a second checklist.
    expect(needsSessionDetail("Session done")).toBe(true);
    expect(needsCampusCount("Session done")).toBe(false);
    expect(needsCampusCount("Campus visit done")).toBe(true);
    expect(needsSessionDetail("Campus visit done")).toBe(false);
    expect(needsSessionDetail(null)).toBe(false);
    expect(needsCampusCount(null)).toBe(false);
  });

  it("keeps the three vocabularies the closing report settled on", () => {
    expect(VISIT_OUTCOMES).toContain("Successful");
    expect(MANAGEMENT_RESPONSES).toContain("Supportive");
    expect(STUDENT_RESPONSES).toContain("Very positive");
  });
});
