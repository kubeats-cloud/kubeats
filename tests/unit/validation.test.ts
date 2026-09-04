import { describe, expect, it } from "vitest";
import { visitSchema } from "@/lib/validation/visit";
import { newMemberSchema } from "@/lib/validation/admin";
import { weeklyTargetsSchema } from "@/lib/validation/weekly";

/**
 * The schemas the browser and the server share. These are the rules a rep meets
 * before the database does — the CHECK constraints and triggers still stand
 * behind them, and the integration tests cover those.
 */

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

describe("visitSchema", () => {
  it("accepts a plain one-shot visit", () => {
    expect(visitSchema.safeParse(baseVisit).success).toBe(true);
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

  it("refuses a meeting with no plan entry behind it (Rule 2)", () => {
    const result = visitSchema.safeParse({ ...baseVisit, activity: "meeting" });
    expect(result.success).toBe(false);
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

  it("requires a follow-up for a pending approval, and forbids one when scheduled (Rule 5)", () => {
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Pending for management approval",
      }).success,
    ).toBe(false);
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Pending for management approval",
        follow_up_date: "2026-09-30",
      }).success,
    ).toBe(true);
    expect(
      visitSchema.safeParse({
        ...baseVisit,
        status_set_to: "Session scheduled",
        follow_up_date: "2026-09-30",
      }).success,
    ).toBe(false);
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

describe("weeklyTargetsSchema", () => {
  const week = { week_start: "2026-08-31" };
  const zeros = {
    meetings: "",
    sessions_set: "",
    sessions_done: "",
    campus_visits_set: "",
    campus_visits_done: "",
    olympiad: "",
    application: "",
    admission: "",
  };

  it("reads an empty box as zero", () => {
    const result = weeklyTargetsSchema.safeParse({ ...week, ...zeros });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.meetings).toBe(0);
  });

  it("refuses a target that is not a whole number", () => {
    expect(
      weeklyTargetsSchema.safeParse({ ...week, ...zeros, meetings: "12a" }).success,
    ).toBe(false);
    expect(
      weeklyTargetsSchema.safeParse({ ...week, ...zeros, meetings: "-3" }).success,
    ).toBe(false);
  });

  it("insists the week starts on a Monday", () => {
    expect(
      weeklyTargetsSchema.safeParse({ ...zeros, week_start: "2026-09-02" }).success,
    ).toBe(false);
  });
});

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
