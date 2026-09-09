import { describe, expect, it } from "vitest";
import { fieldLabel, visitSchema } from "@/lib/validation/visit";
import { newMemberSchema } from "@/lib/validation/admin";

/**
 * The schemas the browser and the server share. These are the rules a rep meets
 * before the database does — the CHECK constraints and triggers still stand
 * behind them, and the integration tests cover those.
 */

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
  status_set_to: "",
  follow_up_date: "",
  follow_up_time: "",
};

describe("visitSchema", () => {
  it("accepts a plain one-shot visit", () => {
    expect(visitSchema.safeParse(baseVisit).success).toBe(true);
  });

  it("carries the accuracy of the fix when there is one", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      latitude: "23.0225",
      longitude: "72.5714",
      accuracy: "137",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accuracy).toBe(137);
  });

  it("saves a visit whose form carries no accuracy field at all", () => {
    // baseVisit has no accuracy key, which is what a page cached from before
    // this shipped will post. Accuracy is a diagnostic and never a gate, so an
    // otherwise perfect visit must not fail on it.
    const result = visitSchema.safeParse(baseVisit);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accuracy).toBeNull();
  });

  it("refuses an accuracy that is not a length", () => {
    for (const accuracy of ["north", "-5"]) {
      expect(
        visitSchema.safeParse({ ...baseVisit, accuracy }).success,
        accuracy,
      ).toBe(false);
    }
  });

  it("refuses a visit with no photo (Rule 12)", () => {
    const result = visitSchema.safeParse({ ...baseVisit, photo_path: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "photo_path");
      expect(issue?.message).toBe("A photo is required to log this visit.");
    }
  });

  it("refuses a photo path that is only whitespace", () => {
    expect(visitSchema.safeParse({ ...baseVisit, photo_path: "   " }).success).toBe(
      false,
    );
  });

  it("requires a photo on every activity, not just the ones with a report", () => {
    for (const activity of ["session", "campus_visit", "olympiad", "application", "admission"]) {
      const result = visitSchema.safeParse({
        ...baseVisit,
        activity,
        photo_path: "",
        // Keep the lifecycle activities otherwise valid, so the only thing
        // wrong with them is the missing photo.
        lifecycle_status: activity === "session" || activity === "campus_visit" ? "Done" : "",
      });
      expect(result.success, `${activity} should be refused without a photo`).toBe(false);
    }
  });

  it("refuses ANY activity with no check-in behind it", () => {
    // This used to be Rule 2's alone — only a meeting needed a plan row. Stage
    // 3 widens the presence guarantee to every activity, so the schema does
    // too, mirroring enforce_checkin_before_visit() in migration 0018.
    for (const activity of ["meeting", "olympiad", "session"] as const) {
      const result = visitSchema.safeParse({
        ...baseVisit,
        activity,
        lifecycle_status: activity === "session" ? "Done" : "",
        daily_plan_id: null,
      });
      expect(result.success, activity).toBe(false);
    }
  });

  it("accepts a meeting that names its plan entry", () => {
    const result = visitSchema.safeParse({
      ...baseVisit,
      activity: "meeting",
      daily_plan_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f",
    });
    expect(result.success).toBe(true);
  });

  it("requires a lifecycle status on a session, and forbids one elsewhere (Rule 3)", () => {
    expect(
      visitSchema.safeParse({ ...baseVisit, activity: "session" }).success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        activity: "session",
        lifecycle_status: "Done",
      }).success,
    ).toBe(true);
    expect(
      visitSchema.safeParse({ ...baseVisit, lifecycle_status: "Set" }).success,
    ).toBe(false);
  });

  it("requires an expected date for a Set", () => {
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        activity: "session",
        lifecycle_status: "Set",
      }).success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        activity: "session",
        lifecycle_status: "Set",
        expected_date: "2026-09-30",
      }).success,
    ).toBe(true);
  });

  it("requires a date AND a time for an open status (Rule 5, restated)", () => {
    // Nothing at all — refused.
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Pending for management approval",
      }).success,
    ).toBe(false);

    // A date but no time — still refused. This is the half that is new: a
    // date alone puts a loop in a day rather than in a diary.
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Pending for management approval",
        follow_up_date: "2026-09-30",
      }).success,
    ).toBe(false);

    // Both — accepted.
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Pending for management approval",
        follow_up_date: "2026-09-30",
        follow_up_time: "10:30",
      }).success,
    ).toBe(true);
  });

  it("no longer FORBIDS a follow-up on a scheduled status", () => {
    // The reversal. "Session scheduled" used to refuse a follow-up outright —
    // visits_follow_up_hidden_when_scheduled, dropped by 0018 — and is now the
    // case that most needs one, because "next session set" IS this status.
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Session scheduled",
        follow_up_date: "2026-09-30",
        follow_up_time: "10:30",
      }).success,
    ).toBe(true);
  });

  it("refuses coordinates outside the globe", () => {
    expect(
      visitSchema.safeParse({ ...baseVisit, latitude: "91" }).success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({ ...baseVisit, longitude: "-181" }).success,
    ).toBe(false);
  });
});

/*
 * The targetsSchema suite lived here. It is gone with the schema: stage 2 of
 * the redesign ended weekly and daily commitments (docs/flow-redesign-plan.md,
 * changes 3 and 4), so there is no longer a form that writes a target and
 * nothing left for those assertions to hold. public.targets and its
 * targets_period_start_aligned CHECK are untouched in the database, and the
 * targets suite in tests/integration/rules.test.ts still exercises them —
 * which is what keeps the reversibility honest rather than merely claimed.
 */

describe("newMemberSchema", () => {
  const valid = {
    name: "Asha Rao",
    email: "asha@example.com",
    password: "temporary-123",
    role: "rep",
  };

  it("accepts a sensible new member", () => {
    expect(newMemberSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a short password and a password that is the email", () => {
    expect(
      newMemberSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
    expect(
      newMemberSchema.safeParse({ ...valid, password: valid.email }).success,
    ).toBe(false);
  });

  it("refuses a role it does not know", () => {
    expect(
      newMemberSchema.safeParse({ ...valid, role: "superuser" }).success,
    ).toBe(false);
  });

  it("lowercases the email so one person cannot have two accounts", () => {
    const result = newMemberSchema.safeParse({ ...valid, email: "Asha@Example.com" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("asha@example.com");
  });
});

describe("fieldLabel", () => {
  it("names a person by their position, counting from one", () => {
    expect(fieldLabel("people.0.name")).toBe("Person 1: name");
    expect(fieldLabel("people.2.contact_number")).toBe("Person 3: mobile");
  });

  it("uses the words printed beside the field, not the column name", () => {
    expect(fieldLabel("activities_conducted")).toBe("What you did");
    expect(fieldLabel("discussion_summary")).toBe("What was discussed");
    expect(fieldLabel("visit_outcome")).toBe("How it ended");
    expect(fieldLabel("photo_path")).toBe("Photo");
  });

  it("never leaks a raw path to a rep", () => {
    for (const key of [
      "people.0.name",
      "activities_conducted",
      "management_feedback",
      "follow_up_date",
    ]) {
      expect(fieldLabel(key)).not.toMatch(/[._]/);
    }
  });

  it("degrades to something readable for a field it has not been told about", () => {
    expect(fieldLabel("some_new_field")).toBe("Some new field");
  });
});
