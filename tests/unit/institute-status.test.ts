import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  INSTITUTE_STATUSES,
  INSTITUTE_STATUS_CATALOGUE,
  STATUS_CATEGORIES,
  isClosedStatus,
  isOpenStatus,
  statusCategory,
  statusesInCategory,
} from "@/lib/validation/institute";
import {
  followUpHidden,
  followUpRequired,
  followUpSuggested,
  visitSchema,
} from "@/lib/validation/visit";

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

const baseVisit = {
  activity: "olympiad",
  institute_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  daily_plan_id: null,
  lifecycle_status: "",
  expected_date: "",
  latitude: "",
  longitude: "",
  photo_path: "9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d/proof.jpg",
  notes: "",
  status_set_to: "",
  follow_up_date: "",
  follow_up_time: "",
};

describe("the institute status catalogue", () => {
  it("carries exactly the nine statuses, in display order", () => {
    expect(INSTITUTE_STATUSES).toEqual(Object.keys(EXPECTED));
  });

  it("gives every status the category the spec asks for", () => {
    for (const [status, category] of Object.entries(EXPECTED)) {
      expect(statusCategory(status), status).toBe(category);
    }
  });

  it("lists no status twice", () => {
    expect(new Set(INSTITUTE_STATUSES).size).toBe(INSTITUTE_STATUSES.length);
  });

  it("has a category for every entry and no third category", () => {
    for (const entry of INSTITUTE_STATUS_CATALOGUE) {
      expect(STATUS_CATEGORIES, entry.status).toContain(entry.category);
    }
  });

  it("partitions the catalogue — every status in exactly one category", () => {
    const grouped = STATUS_CATEGORIES.flatMap((category) => [
      ...statusesInCategory(category),
    ]);
    expect(grouped.toSorted()).toEqual([...INSTITUTE_STATUSES].toSorted());
    expect(new Set(grouped).size).toBe(INSTITUTE_STATUSES.length);
  });

  it("keeps each category in catalogue order", () => {
    expect(statusesInCategory("open")).toEqual(
      INSTITUTE_STATUSES.filter((s) => EXPECTED[s] === "open"),
    );
    expect(statusesInCategory("closed")).toEqual(
      INSTITUTE_STATUSES.filter((s) => EXPECTED[s] === "closed"),
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
    expect(statusCategory(null)).toBeNull();
    expect(isOpenStatus(null)).toBe(false);
    expect(isClosedStatus(null)).toBe(false);
  });

  it("says nothing about a status it does not know", () => {
    expect(statusCategory("Invented by a stale client")).toBeNull();
    expect(isOpenStatus("Invented by a stale client")).toBe(false);
    expect(isClosedStatus("Invented by a stale client")).toBe(false);
  });

  it("is case- and whitespace-sensitive, like the CHECK constraint", () => {
    expect(statusCategory("rsvp received")).toBeNull();
    expect(statusCategory(" RSVP received")).toBeNull();
  });
});

describe("Rule 5 still holds, with the three new statuses folded in", () => {
  it("leaves the original hidden and required statuses alone", () => {
    expect(followUpHidden("Session scheduled")).toBe(true);
    expect(followUpHidden("Campus visit scheduled")).toBe(true);
    expect(followUpRequired("Pending for management approval")).toBe(true);
  });

  it("neither hides nor requires a follow-up for the three new statuses", () => {
    for (const status of [
      "Invited principal for event",
      "RSVP received",
      "Will not come",
    ]) {
      expect(followUpHidden(status), status).toBe(false);
      expect(followUpRequired(status), status).toBe(false);
    }
  });

  it("suggests a follow-up for an invitation, and only for that", () => {
    expect(followUpSuggested("Invited principal for event")).toBe(true);
    for (const status of INSTITUTE_STATUSES.filter(
      (s) => s !== "Invited principal for event",
    )) {
      expect(followUpSuggested(status), status).toBe(false);
    }
    expect(followUpSuggested(null)).toBe(false);
  });
});

describe("visitSchema accepts the widened vocabulary", () => {
  it("takes every one of the nine statuses", () => {
    for (const status of INSTITUTE_STATUSES) {
      const result = visitSchema.safeParse({
        ...baseVisit,
        status_set_to: status,
        // The one status that demands a date; supplying it here keeps this
        // test about the vocabulary rather than about Rule 5.
        follow_up_date: followUpRequired(status) ? "2026-09-30" : "",
      });
      expect(result.success, `${status}: ${result.error?.message}`).toBe(true);
    }
  });

  it("lets an invitation save with no follow-up date", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "Invited principal for event",
    });
    expect(result.success).toBe(true);
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
