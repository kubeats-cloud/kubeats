import { describe, expect, it } from "vitest";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import { makeAdminCallEditSchema } from "@/lib/validation/visit";

/**
 * admin_update_call_report()'s client-side mirror (0063) — the SAME
 * status-driven date rule Log Call uses (makeCallSchema /
 * refineStatusDrivenDates), and nothing else: no session topic, no head
 * count, no taken-by, because none of those is an editable field here.
 *
 * The RPC itself (admin-only, the most-recent-event rule, the audit trail,
 * the closed-status next_action clear) is proven in
 * tests/integration/rules.test.ts's admin_update_call_report() block and on
 * the rehearsal DB — not here, because none of it is a client-side rule.
 */

const TASK = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
const schema = makeAdminCallEditSchema(SEED_STATUS_CATALOGUE);

const base = {
  task_id: TASK,
  status_set_to: "First meeting done",
  expected_date: "",
  follow_up_date: "2026-10-20",
  outcome: "done",
  notes: "Corrected the status.",
};

const issuesOn = (payload: Record<string, unknown>, path: string) => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return [];
  return parsed.error.issues.filter((issue) => issue.path[0] === path);
};

describe("makeAdminCallEditSchema — shape", () => {
  it("parses a valid open-status edit", () => {
    const parsed = schema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rejects a task id that is not a uuid", () => {
    expect(issuesOn({ ...base, task_id: "not-a-uuid" }, "task_id").length).toBe(1);
  });

  it("rejects a status outside the catalogue", () => {
    expect(issuesOn({ ...base, status_set_to: "Made up status" }, "status_set_to").length).toBe(1);
  });

  it("accepts every outcome in the follow_up_tasks_outcome_valid vocabulary", () => {
    for (const outcome of ["done", "no_answer", "rescheduled", "cancelled"]) {
      expect(schema.safeParse({ ...base, outcome }).success).toBe(true);
    }
  });

  it("rejects an outcome outside that vocabulary", () => {
    expect(issuesOn({ ...base, outcome: "ghosted" }, "outcome").length).toBe(1);
  });

  it("treats a blank outcome as null rather than refusing it", () => {
    // adminUpdateCallReport() coalesces a null outcome to "leave it alone" —
    // the schema's job is only to refuse an INVALID one, not to require one.
    const parsed = schema.safeParse({ ...base, outcome: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outcome).toBeNull();
  });

  it("has no session_topic, session_taken_by or students_attended key at all", () => {
    const parsed = schema.safeParse({
      ...base,
      session_topic: "Careers",
      session_taken_by: "Dr Rao",
      students_attended: "40",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("session_topic");
    expect(parsed.data).not.toHaveProperty("session_taken_by");
    expect(parsed.data).not.toHaveProperty("students_attended");
  });
});

describe("makeAdminCallEditSchema — the same status-driven dates as Log Call", () => {
  it("requires a follow-up date on an open status", () => {
    expect(issuesOn({ ...base, follow_up_date: "" }, "follow_up_date").length).toBe(1);
  });

  it("does not require a follow-up date on a closed instant-close status", () => {
    const parsed = schema.safeParse({
      ...base,
      status_set_to: "RSVP received",
      follow_up_date: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires the expected date on Session done", () => {
    expect(
      issuesOn(
        { ...base, status_set_to: "Session done", expected_date: "", follow_up_date: "" },
        "expected_date",
      ).length,
    ).toBe(1);
  });

  it("accepts a complete Session done edit with no session fields supplied", () => {
    const parsed = schema.safeParse({
      ...base,
      status_set_to: "Session done",
      expected_date: "2026-10-13",
      follow_up_date: "",
    });
    expect(parsed.success).toBe(true);
  });
});
