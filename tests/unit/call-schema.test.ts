import { describe, expect, it } from "vitest";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import { makeCallSchema } from "@/lib/validation/visit";

/**
 * Log Call's schema: the same status-driven rules as Log Visit, no photo.
 *
 * The RPC itself (FO038-FO044, institute status, next-action insert) is
 * proven in tests/integration/rules.test.ts's log_call() block. What is here
 * is everything the form can get wrong before that RPC runs.
 */

const TASK = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
const schema = makeCallSchema(SEED_STATUS_CATALOGUE);

const base = {
  task_id: TASK,
  status_set_to: "First meeting done",
  expected_date: "",
  follow_up_date: "2026-10-20",
  next_action: "",
  follow_up_note: "",
  notes: "Spoke to the principal",
  students_attended: "",
  session_topic: "",
  session_taken_by: "",
};

const issuesOn = (payload: Record<string, unknown>, path: string) => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return [];
  return parsed.error.issues.filter((issue) => issue.path[0] === path);
};

describe("makeCallSchema — no photo, no GPS, no plan row", () => {
  it("parses a valid open-status call without a photo_path key", () => {
    const parsed = schema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data && "photo_path" in parsed.data).toBe(false);
  });

  it("has no photo, GPS or plan fields at all", () => {
    const parsed = schema.safeParse({
      ...base,
      photo_path: "rep/proof.jpg",
      latitude: "12.3",
      daily_plan_id: TASK,
      closes_visit_id: TASK,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("photo_path");
    expect(parsed.data).not.toHaveProperty("latitude");
    expect(parsed.data).not.toHaveProperty("daily_plan_id");
    expect(parsed.data).not.toHaveProperty("closes_visit_id");
  });
});

describe("makeCallSchema — status-driven dates", () => {
  it("requires a follow-up date on an open status", () => {
    expect(issuesOn({ ...base, follow_up_date: "" }, "follow_up_date").length).toBe(1);
  });

  it("does not require a follow-up date on a closed instant-close status", () => {
    const parsed = schema.safeParse({
      ...base,
      status_set_to: "RSVP received",
      follow_up_date: "",
      notes: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a follow-up date when a next action is chosen, even on a closed status", () => {
    expect(
      issuesOn(
        {
          ...base,
          status_set_to: "RSVP received",
          follow_up_date: "",
          next_action: "call",
          notes: "",
        },
        "follow_up_date",
      ).length,
    ).toBe(1);
  });

  it("requires the expected date on Session done", () => {
    expect(
      issuesOn(
        {
          ...base,
          status_set_to: "Session done",
          expected_date: "",
          follow_up_date: "",
          students_attended: "40",
          session_topic: "Careers",
          session_taken_by: "Dr Rao",
          notes: "Held it",
        },
        "expected_date",
      ).length,
    ).toBe(1);
  });
});

describe("makeCallSchema — closing-report rules match Log Visit", () => {
  it("requires notes on an open status", () => {
    expect(issuesOn({ ...base, notes: "" }, "notes").length).toBe(1);
  });

  it("does not require notes on RSVP received", () => {
    const parsed = schema.safeParse({
      ...base,
      status_set_to: "RSVP received",
      follow_up_date: "",
      notes: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires students, topic and taken-by on Session done", () => {
    const payload = {
      ...base,
      status_set_to: "Session done",
      expected_date: "2026-10-13",
      follow_up_date: "",
      notes: "Held it",
      students_attended: "",
      session_topic: "",
      session_taken_by: "",
    };
    expect(issuesOn(payload, "students_attended").length).toBe(1);
    expect(issuesOn(payload, "session_topic").length).toBe(1);
    expect(issuesOn(payload, "session_taken_by").length).toBe(1);
  });

  it("accepts a complete Session done call", () => {
    const parsed = schema.safeParse({
      ...base,
      status_set_to: "Session done",
      expected_date: "2026-10-13",
      follow_up_date: "",
      notes: "Held it",
      students_attended: "40",
      session_topic: "Careers",
      session_taken_by: "Dr Rao",
    });
    expect(parsed.success).toBe(true);
  });
});
