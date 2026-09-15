import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  SEED_STATUSES,
  SEED_STATUS_CATALOGUE,
  STATUS_CATEGORIES,
  institutePickerLabel,
  reopeningInstitute,
  isClosedStatus,
  isOpenStatus,
  statusCategory,
  statusesInCategory,
} from "@/lib/validation/institute";
import { followUpRequired, visitSchema } from "@/lib/validation/visit";

/**
 * Rule 4's vocabulary and the open/closed category that features C and D will
 * build on.
 *
 * EXPECTED is written out by hand rather than derived from the catalogue on
 * purpose. A test that maps over the source it is testing only proves the
 * source is self-consistent; this one fails if a category is quietly flipped,
 * which is the mistake actually worth catching. The database's copy is checked
 * against this same table by the institute_status_category suite in
 * tests/integration/rules.test.ts.
 */
const EXPECTED: Record<string, "open" | "closed"> = {
  "First meeting done": "open",
  "Session scheduled": "open",
  "Session done": "closed",
  "Campus visit scheduled": "open",
  "Campus visit done": "closed",
  "Pending for management approval": "open",
  "Invited principal for event": "open",
  "RSVP received": "closed",
  "Will not come": "closed",
};

/**
 * Rule 5 for all nine, written out the same way and for the same reason.
 *
 * "required" is not the same as "open": four of the five open statuses do not
 * demand a follow-up. What the two required ones share is that they wait on
 * someone else's answer with nothing scheduled to bring them back.
 */
/**
 * Rule 5 as stage 3 restates it: an OPEN status needs a follow-up, a CLOSED one
 * does not.
 *
 * The old table had a third state, "hidden" — the two "scheduled" statuses
 * FORBADE a follow-up, because they carried their own expected date. Stage 3
 * reversed exactly that: "next session set" IS "Session scheduled", and it is
 * now the case that most demands a date and a time. Migration 0018 drops the
 * constraint that said otherwise.
 *
 * Still written out by hand rather than derived from the catalogue. A test that
 * maps over the source it is testing only proves the source is self-consistent;
 * this one fails if a category is quietly flipped, which is the mistake worth
 * catching.
 */
const EXPECTED_FOLLOW_UP: Record<string, "required" | "optional"> = {
  "First meeting done": "required",
  "Session scheduled": "required",
  "Session done": "optional",
  "Campus visit scheduled": "required",
  "Campus visit done": "optional",
  "Pending for management approval": "required",
  "Invited principal for event": "required",
  "RSVP received": "optional",
  "Will not come": "optional",
};

const baseVisit = {
  activity: "olympiad",
  institute_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  // Stage 3: EVERY activity is logged from a check-in now, so the schema
  // wants the plan row that arrival belongs to — not just meetings.
  daily_plan_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3399",
  lifecycle_status: "",
  expected_date: "",
  latitude: "",
  longitude: "",
  photo_path: "9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d/proof.jpg",
  notes: "",
  // Compulsory since stage 4b (FO024, migration 0027), so the base fixture
  // carries one. A CLOSED status deliberately: an open one would also demand a
  // follow-up date, and these cases are about everything else.
  status_set_to: "RSVP received",
  follow_up_date: "",
  follow_up_time: "",
};

describe("the institute status catalogue", () => {
  it("carries exactly the nine statuses, in display order", () => {
    expect(SEED_STATUSES).toEqual(Object.keys(EXPECTED));
  });

  it("gives every status the category the spec asks for", () => {
    for (const [status, category] of Object.entries(EXPECTED)) {
      expect(statusCategory(SEED_STATUS_CATALOGUE, status), status).toBe(category);
    }
  });

  it("lists no status twice", () => {
    expect(new Set(SEED_STATUSES).size).toBe(SEED_STATUSES.length);
  });

  it("has a category for every entry and no third category", () => {
    for (const entry of SEED_STATUS_CATALOGUE) {
      expect(STATUS_CATEGORIES, entry.status).toContain(entry.category);
    }
  });

  it("partitions the catalogue — every status in exactly one category", () => {
    const grouped = STATUS_CATEGORIES.flatMap((category) => [
      ...statusesInCategory(SEED_STATUS_CATALOGUE, category),
    ]);
    expect(grouped.toSorted()).toEqual([...SEED_STATUSES].toSorted());
    expect(new Set(grouped).size).toBe(SEED_STATUSES.length);
  });

  it("keeps each category in catalogue order", () => {
    expect(statusesInCategory(SEED_STATUS_CATALOGUE, "open")).toEqual(
      SEED_STATUSES.filter((s) => EXPECTED[s] === "open"),
    );
    expect(statusesInCategory(SEED_STATUS_CATALOGUE, "closed")).toEqual(
      SEED_STATUSES.filter((s) => EXPECTED[s] === "closed"),
    );
  });

  it("labels both categories for the dropdown", () => {
    for (const category of STATUS_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe("statusCategory", () => {
  it("says nothing about no status at all", () => {
    // Null is "no status yet", which is neither open nor closed. D's re-add
    // flow leans on that distinction, so it is asserted rather than assumed.
    expect(statusCategory(SEED_STATUS_CATALOGUE, null)).toBeNull();
    expect(isOpenStatus(SEED_STATUS_CATALOGUE, null)).toBe(false);
    expect(isClosedStatus(SEED_STATUS_CATALOGUE, null)).toBe(false);
  });

  it("says nothing about a status it does not know", () => {
    expect(statusCategory(SEED_STATUS_CATALOGUE, "Invented by a stale client")).toBeNull();
    expect(isOpenStatus(SEED_STATUS_CATALOGUE, "Invented by a stale client")).toBe(false);
    expect(isClosedStatus(SEED_STATUS_CATALOGUE, "Invented by a stale client")).toBe(false);
  });

  it("is case- and whitespace-sensitive, like the CHECK constraint", () => {
    expect(statusCategory(SEED_STATUS_CATALOGUE, "rsvp received")).toBeNull();
    expect(statusCategory(SEED_STATUS_CATALOGUE, " RSVP received")).toBeNull();
  });
});

describe("Rule 5, with the three new statuses folded in", () => {
  it("gives every one of the nine the follow-up rule the spec asks for", () => {
    for (const status of SEED_STATUSES) {
      expect(followUpRequired(SEED_STATUS_CATALOGUE, status), `${status} required`).toBe(
        EXPECTED_FOLLOW_UP[status] === "required",
      );
    }
  });

  it("requires a follow-up for exactly the OPEN statuses, and no others", () => {
    // The rule and the category are the same question now, which is the whole
    // point of asking isOpenStatus(SEED_STATUS_CATALOGUE, ) rather than keeping a second list.
    for (const status of SEED_STATUSES) {
      expect(followUpRequired(SEED_STATUS_CATALOGUE, status), status).toBe(isOpenStatus(SEED_STATUS_CATALOGUE, status));
    }
    expect(followUpRequired(SEED_STATUS_CATALOGUE, null)).toBe(false);
  });

  it("no longer FORBIDS a follow-up on the two scheduled statuses", () => {
    // The reversal, asserted directly. These two used to be "hidden" — a
    // follow-up on them was refused by visits_follow_up_hidden_when_scheduled,
    // which 0018 drops. They are now the statuses that most need one.
    expect(followUpRequired(SEED_STATUS_CATALOGUE, "Session scheduled")).toBe(true);
    expect(followUpRequired(SEED_STATUS_CATALOGUE, "Campus visit scheduled")).toBe(true);
  });

  it("requires a chase date for an invitation, as it does for approval", () => {
    expect(followUpRequired(SEED_STATUS_CATALOGUE, "Invited principal for event")).toBe(true);
    expect(followUpRequired(SEED_STATUS_CATALOGUE, "Pending for management approval")).toBe(true);
  });

  it("never requires a follow-up on a closed status", () => {
    // A closed status may still CARRY one — "they said no, ask again next
    // intake" is a real note, and 0010 kept it permitted on purpose — but it
    // is never demanded.
    for (const status of SEED_STATUSES) {
      if (!isOpenStatus(SEED_STATUS_CATALOGUE, status)) {
        expect(followUpRequired(SEED_STATUS_CATALOGUE, status), status).toBe(false);
      }
    }
  });

  it("leaves the two closed statuses optional", () => {
    // Permitted, never demanded — 0010 kept a follow-up legal on a closed
    // status so "they said no, ask again next intake" can still be recorded.
    for (const status of ["RSVP received", "Will not come"]) {
      expect(followUpRequired(SEED_STATUS_CATALOGUE, status), status).toBe(false);
    }
  });

  it("asks nothing of a visit that changes no status", () => {
    expect(followUpRequired(SEED_STATUS_CATALOGUE, null)).toBe(false);
  });
});

describe("visitSchema accepts the widened vocabulary", () => {
  it("takes every one of the nine statuses", () => {
    for (const status of SEED_STATUSES) {
      const result = visitSchema.safeParse({
        ...baseVisit,
        status_set_to: status,
        // The open statuses demand a date; supplying one here keeps this test
        // about the vocabulary rather than about Rule 5. No time — 0023 took
        // that half of the rule away.
        follow_up_date: followUpRequired(SEED_STATUS_CATALOGUE, status) ? "2026-09-30" : "",
      });
      expect(result.success, `${status}: ${result.error?.message}`).toBe(true);
    }
  });

  it("refuses an invitation with no follow-up date", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Invited principal for event",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "follow_up_date");
      expect(issue?.message).toBe(
        '"Invited principal for event" leaves this open, so a follow-up date is needed.',
      );
    }
  });

  it("takes an invitation once it carries one", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Invited principal for event",
      follow_up_date: "2026-09-20",
    });
    expect(result.success).toBe(true);
  });

  it("still names the right status when approval is the one missing a date", () => {
    // The message is built from the status now rather than hardcoded, so this
    // guards against it naming the wrong one.
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Pending for management approval",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "follow_up_date");
      expect(issue?.message).toBe(
        '"Pending for management approval" leaves this open, so a follow-up date is needed.',
      );
    }
  });

  it("lets a closed status save with no follow-up at all", () => {
    for (const status of ["RSVP received", "Will not come"]) {
      const result = visitSchema.safeParse({ ...baseVisit, status_set_to: status });
      expect(result.success, status).toBe(true);
    }
  });

  it("lets a closed status carry a follow-up anyway", () => {
    // "They said no, ask again next intake" is a real note to leave.
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Will not come",
      follow_up_date: "2027-01-15",
    });
    expect(result.success).toBe(true);
  });

  it("still refuses a status outside the nine", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Principal said maybe",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "status_set_to");
      expect(issue?.message).toBe("Choose one of the listed statuses.");
    }
  });
});

describe("institutePickerLabel — finding a finished institute again (feature D)", () => {
  const base = { name: "Horizon International School", city: "Ahmedabad" };

  it("spells out the status when the loop is closed", () => {
    expect(institutePickerLabel(SEED_STATUS_CATALOGUE, { ...base, status: "RSVP received" })).toBe(
      "Horizon International School · Ahmedabad (closed: RSVP received)",
    );
  });

  it("marks every closed status and no open one", () => {
    for (const status of SEED_STATUSES) {
      const label = institutePickerLabel(SEED_STATUS_CATALOGUE, { ...base, status });
      expect(label.includes("(closed:"), status).toBe(isClosedStatus(SEED_STATUS_CATALOGUE, status));
      // The status itself is only worth the space when it changes what the
      // rep is about to do.
      expect(label.includes(status), status).toBe(isClosedStatus(SEED_STATUS_CATALOGUE, status));
    }
  });

  it("says nothing extra for an institute with no status yet", () => {
    expect(institutePickerLabel(SEED_STATUS_CATALOGUE, { ...base, status: null })).toBe(
      "Horizon International School · Ahmedabad",
    );
  });

  it("copes with a missing city", () => {
    expect(institutePickerLabel(SEED_STATUS_CATALOGUE, { name: "Zenith", city: null, status: null })).toBe(
      "Zenith",
    );
    expect(
      institutePickerLabel(SEED_STATUS_CATALOGUE, { name: "Zenith", city: null, status: "Will not come" }),
    ).toBe("Zenith (closed: Will not come)");
  });

  it("does not mark a status it does not recognise", () => {
    // A stale row or a future status must not be silently called closed.
    expect(institutePickerLabel(SEED_STATUS_CATALOGUE, { ...base, status: "Something else" })).toBe(
      "Horizon International School · Ahmedabad",
    );
  });
});

describe("reopeningInstitute — when the picker should warn (feature D)", () => {
  const institutes = [
    { id: "closed-1", name: "Horizon", status: "RSVP received" },
    { id: "closed-2", name: "Pinnacle", status: "Will not come" },
    { id: "open-1", name: "Zenith", status: "First meeting done" },
    { id: "fresh-1", name: "Abc test", status: null },
  ];

  it("returns the institute when its loop is already closed", () => {
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "closed-1")?.name).toBe("Horizon");
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "closed-2")?.name).toBe("Pinnacle");
  });

  it("says nothing for an open one, an unstatused one, or no selection", () => {
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "open-1")).toBeNull();
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "fresh-1")).toBeNull();
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "")).toBeNull();
  });

  it("says nothing for an id that is not in the list", () => {
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, institutes, "not-a-real-id")).toBeNull();
  });

  it("agrees with the catalogue for every one of the nine", () => {
    for (const status of SEED_STATUSES) {
      const list = [{ id: "x", name: "Somewhere", status }];
      expect(Boolean(reopeningInstitute(SEED_STATUS_CATALOGUE, list, "x")), status).toBe(
        isClosedStatus(SEED_STATUS_CATALOGUE, status),
      );
    }
  });

  it("copes with an empty registry", () => {
    expect(reopeningInstitute(SEED_STATUS_CATALOGUE, [], "closed-1")).toBeNull();
  });
});
