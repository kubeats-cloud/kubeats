import { describe, expect, it } from "vitest";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import {
  eventDateLabel,
  eventDateRequired,
  followUpRequired,
  notesRequired,
} from "@/lib/validation/visit";
import { makeReportSchema } from "@/lib/validation/feedback";

/**
 * The client's final per-status specification, asserted status by status.
 *
 * The spec is a table, so this is a table: for each of the nine, which fields
 * the form shows and which of them are compulsory. Written out in full rather
 * than looped, because the value of this file is that a reader can compare it
 * to the client's own document line by line — a clever loop would be shorter
 * and would not do that.
 *
 * Ordering is not asserted here. It lives in one linear run of JSX in
 * log-visit-form.tsx and feedback-fields.tsx, where the only thing that could
 * reorder it is someone moving the markup.
 */

interface Expected {
  followUp: boolean;
  eventDate: false | string;
  students: boolean;
  sessionDetail: boolean;
  notes: boolean;
}

const SPEC: Record<string, Expected> = {
  "First meeting done": {
    followUp: true,
    eventDate: false,
    students: false,
    sessionDetail: false,
    notes: true,
  },
  "Session scheduled": {
    followUp: true,
    eventDate: "Expected Session Date",
    students: false,
    sessionDetail: false,
    notes: true,
  },
  "Campus visit scheduled": {
    followUp: true,
    eventDate: "Expected Campus Visit Date",
    students: false,
    sessionDetail: false,
    notes: true,
  },
  "Pending for management approval": {
    followUp: true,
    eventDate: false,
    students: false,
    sessionDetail: false,
    notes: true,
  },
  "Invited principal for event": {
    followUp: true,
    eventDate: false,
    students: false,
    sessionDetail: false,
    notes: true,
  },
  "Session done": {
    followUp: false,
    eventDate: "Session Date",
    students: true,
    sessionDetail: true,
    notes: true,
  },
  "Campus visit done": {
    followUp: false,
    eventDate: "Campus Visit Date",
    students: true,
    sessionDetail: false,
    notes: true,
  },
  "RSVP received": {
    followUp: false,
    eventDate: false,
    students: false,
    sessionDetail: false,
    notes: false,
  },
  "Will not come": {
    followUp: false,
    eventDate: false,
    students: false,
    sessionDetail: false,
    notes: false,
  },
};

describe("the per-status field set", () => {
  for (const [status, want] of Object.entries(SPEC)) {
    it(`${status}: shows exactly what the spec asks for`, () => {
      const row = SEED_STATUS_CATALOGUE.find((r) => r.status === status);
      expect(row, `${status} is not in the seeded catalogue`).toBeDefined();

      expect(followUpRequired(SEED_STATUS_CATALOGUE, status)).toBe(
        want.followUp,
      );
      expect(eventDateRequired(SEED_STATUS_CATALOGUE, status)).toBe(
        Boolean(want.eventDate),
      );
      if (want.eventDate) {
        expect(eventDateLabel(SEED_STATUS_CATALOGUE, status)).toBe(
          want.eventDate,
        );
      }
      expect(row?.asksHeadCount ?? false).toBe(want.students);
      expect(row?.asksSessionDetail ?? false).toBe(want.sessionDetail);
      expect(notesRequired(SEED_STATUS_CATALOGUE, status)).toBe(want.notes);
    });
  }

  /*
   * THE CLIENT'S FIRST COMPLAINT, pinned.
   *
   * The follow-up used to render on all nine and merely change its wording when
   * the status was closed, so a rep filing "RSVP received" was still asked when
   * they were going back. Visibility is the rule now, and these four are the
   * ones that must never show it.
   */
  it("never asks a closed status for a follow-up", () => {
    for (const status of [
      "Session done",
      "Campus visit done",
      "RSVP received",
      "Will not come",
    ]) {
      expect(followUpRequired(SEED_STATUS_CATALOGUE, status), status).toBe(
        false,
      );
    }
  });
});

describe("what the report refuses, per status", () => {
  // `shape` also carries closes_visit_id (Q2's "does this close an earlier
  // plan?"), which is not part of the client's per-status table but is part of
  // the object being parsed.
  const filled = (over: Record<string, string> = {}) => ({
    notes: "",
    students_attended: "",
    session_topic: "",
    session_taken_by: "",
    closes_visit_id: "",
    ...over,
  });

  it("refuses an empty Session done report and names all four fields", () => {
    const result = makeReportSchema(
      SEED_STATUS_CATALOGUE,
      "Session done",
    ).safeParse(filled());
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues
        .map((i) => String(i.path[0]))
        .toSorted();
      expect(paths).toEqual([
        "notes",
        "session_taken_by",
        "session_topic",
        "students_attended",
      ]);
    }
  });

  it("accepts a Session done report with all four", () => {
    const result = makeReportSchema(
      SEED_STATUS_CATALOGUE,
      "Session done",
    ).safeParse(
      filled({
        notes: "Went well.",
        students_attended: "42",
        session_topic: "Design careers",
        session_taken_by: "Sumit",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("asks a Campus visit done for the count but not the session detail", () => {
    const result = makeReportSchema(
      SEED_STATUS_CATALOGUE,
      "Campus visit done",
    ).safeParse(filled({ notes: "Twelve came." }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => String(i.path[0]));
      expect(paths).toEqual(["students_attended"]);
    }
  });

  /*
   * THE TWO INSTANT CLOSES. The client corrected their own PDF on this: the
   * status is the whole answer, so nothing at all is compulsory.
   */
  it("lets the instant closes through with nothing filled in", () => {
    for (const status of ["RSVP received", "Will not come"]) {
      const result = makeReportSchema(SEED_STATUS_CATALOGUE, status).safeParse(
        filled(),
      );
      expect(result.success, status).toBe(true);
    }
  });

  it("requires notes on the five open statuses", () => {
    for (const status of [
      "First meeting done",
      "Session scheduled",
      "Campus visit scheduled",
      "Pending for management approval",
      "Invited principal for event",
    ]) {
      expect(
        makeReportSchema(SEED_STATUS_CATALOGUE, status).safeParse(filled())
          .success,
        status,
      ).toBe(false);
      expect(
        makeReportSchema(SEED_STATUS_CATALOGUE, status).safeParse(
          filled({ notes: "Spoke to the principal." }),
        ).success,
        status,
      ).toBe(true);
    }
  });

  /*
   * THE LIVE-DATA GUARANTEE.
   *
   * Every field stays nullable in `shape`, and the new requirements are a
   * refinement applied at submit time only. A status the catalogue does not
   * recognise — which is what a pre-0027 visit with a null status looks like —
   * refines nothing, so an old report can still be filed and re-read.
   */
  it("refines nothing for an unknown or absent status", () => {
    expect(
      makeReportSchema(SEED_STATUS_CATALOGUE, null).safeParse(filled()).success,
    ).toBe(true);
    expect(
      makeReportSchema(SEED_STATUS_CATALOGUE, "Retired long ago").safeParse(
        filled(),
      ).success,
    ).toBe(true);
  });
});
