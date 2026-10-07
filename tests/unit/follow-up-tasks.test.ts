import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  batchPlanSchema,
  defaultFollowUpDue,
  nextActionSchema,
  visitFormDataToInput,
  visitSchema,
} from "@/lib/validation/visit";

/**
 * Phase A's rules, as far as they can be proven without a database.
 *
 * The one thing this file CANNOT prove is the thing Phase A rests on: that a
 * follow-up lands in `follow_up_tasks` and never in `daily_plans`, and that
 * Rule 7 and the Overview denominator are therefore unmoved. That is a claim
 * about two tables and a function body, and only a real database can answer it
 * — the `follow_up_tasks` block in tests/integration/rules.test.ts does.
 *
 * What is here: the next-action pair rule, the tomorrow default, the batch
 * schema, and a source-level guard that the separation has not been quietly
 * undone.
 */

const base = {
  activity: "meeting",
  institute_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f",
  daily_plan_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d2f",
  lifecycle_status: "",
  expected_date: "",
  latitude: "",
  longitude: "",
  accuracy: "",
  photo_path: "rep/proof.jpg",
  notes: "",
  // A CLOSED status that asks for neither an event date nor a follow-up date,
  // so every assertion below is about the next action and nothing else.
  // "Session done" would drag `expected_date` in (asksExpectedDate) and make a
  // failure here ambiguous.
  status_set_to: "Will not come",
  follow_up_date: "",
  follow_up_time: "",
};

describe("the next action a visit leaves behind", () => {
  it("accepts a visit that leaves nothing owed", () => {
    const parsed = visitSchema.safeParse({ ...base, next_action: "", follow_up_due: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.next_action).toBeNull();
  });

  it("accepts a call and a meeting, each with a date", () => {
    for (const kind of ["call", "meeting"]) {
      const parsed = visitSchema.safeParse({
        ...base,
        next_action: kind,
        follow_up_due: "2026-10-08",
      });
      expect(parsed.success, kind).toBe(true);
      expect(parsed.data?.next_action).toBe(kind);
      expect(parsed.data?.follow_up_due).toBe("2026-10-08");
    }
  });

  it("refuses anything that is neither", () => {
    const parsed = visitSchema.safeParse({
      ...base,
      next_action: "email",
      follow_up_due: "2026-10-08",
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * THE RULE IS ABOUT THE PAIR, which is why it lives in the superRefine.
   * `follow_up_tasks.due_date` is NOT NULL (0038), so a task with no day cannot
   * exist — without this the rep would reach the database and be refused there
   * with a message about a column.
   */
  it("refuses an action with no day", () => {
    const parsed = visitSchema.safeParse({ ...base, next_action: "call", follow_up_due: "" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.path.includes("follow_up_due"))).toBe(true);
  });

  it("refuses a day with no action", () => {
    const parsed = visitSchema.safeParse({
      ...base,
      next_action: "",
      follow_up_due: "2026-10-08",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((i) => i.path.includes("next_action"))).toBe(true);
  });

  /**
   * ⚠ THE DEPLOY RULE, and the reason it is a test rather than a comment.
   *
   * During a deploy a rep's CACHED Log Visit page posts a form that has never
   * heard of these three fields. A required key would turn that into "a few
   * details still need filling in" on a visit that is otherwise perfect — at a
   * school gate, with the photograph already taken. `accuracy` carries the same
   * tolerance for the same reason, and this file had the bug before the
   * existing suite caught it.
   */
  it("accepts a submission from a page that predates the fields entirely", () => {
    const parsed = visitSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.next_action).toBeNull();
    expect(parsed.data?.follow_up_due).toBeNull();
    expect(parsed.data?.follow_up_note).toBeNull();
  });

  it("reads the three fields off the form the component posts", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(base)) fd.set(k, String(v));
    fd.set("next_action", "call");
    fd.set("follow_up_due", "2026-10-08");
    fd.set("follow_up_note", "Fees");

    const input = visitFormDataToInput(fd);
    expect(input.next_action).toBe("call");
    expect(input.follow_up_due).toBe("2026-10-08");
    expect(input.follow_up_note).toBe("Fees");
  });

  it("caps the note at 300, like a plan note", () => {
    const ok = visitSchema.safeParse({
      ...base, next_action: "call", follow_up_due: "2026-10-08",
      follow_up_note: "x".repeat(300),
    });
    expect(ok.success).toBe(true);
    const tooLong = visitSchema.safeParse({
      ...base, next_action: "call", follow_up_due: "2026-10-08",
      follow_up_note: "x".repeat(301),
    });
    expect(tooLong.success).toBe(false);
  });
});

describe("the recovery path asks the same question", () => {
  it("applies the identical pair rule", () => {
    expect(nextActionSchema.safeParse({ next_action: "", follow_up_due: "", follow_up_note: "" }).success).toBe(true);
    expect(nextActionSchema.safeParse({ next_action: "call", follow_up_due: "" }).success).toBe(false);
    expect(nextActionSchema.safeParse({ next_action: "", follow_up_due: "2026-10-08" }).success).toBe(false);
    expect(nextActionSchema.safeParse({ next_action: "call", follow_up_due: "2026-10-08" }).success).toBe(true);
  });

  /** It is the ONE route that skips Log Visit, so it must not skip this. */
  it("is actually wired into submitFeedback", () => {
    const actions = readFileSync(
      fileURLToPath(new URL("../../src/lib/feedback-actions.ts", import.meta.url)),
      "utf8",
    );
    const submit = actions.slice(actions.indexOf("export async function submitFeedback"));
    const body = submit.slice(0, submit.indexOf("\nexport ", 1));
    expect(body).toContain("nextActionSchema");
    expect(body).toContain("p_follow_up_kind");
  });
});

describe("tomorrow, in the app's own timezone", () => {
  it("is the day after the one it is given", () => {
    expect(defaultFollowUpDue("2026-10-06")).toBe("2026-10-07");
  });

  it("steps a month end, a year end and a leap day", () => {
    expect(defaultFollowUpDue("2026-10-31")).toBe("2026-11-01");
    expect(defaultFollowUpDue("2026-12-31")).toBe("2027-01-01");
    expect(defaultFollowUpDue("2028-02-28")).toBe("2028-02-29");
  });

  /**
   * It reads todayISO(), whose twin in SQL is app_today(). close_visit() falls
   * back to `app_today() + 1` for a caller that sends no date, so the form and
   * the database offer the same day by construction rather than coincidence.
   */
  it("is built on todayISO, not on the runtime's clock", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/lib/validation/visit.ts", import.meta.url)),
      "utf8",
    );
    const fn = source.slice(source.indexOf("export function defaultFollowUpDue"));
    expect(fn.slice(0, 400)).not.toContain("new Date()");
    expect(source).toContain('import { todayISO } from "@/lib/dates"');
  });
});

describe("the morning tick-list", () => {
  const id = (n: number) => `8b1a9953-4c22-4d1f-9b1a-99534c224d${String(n).padStart(2, "0")}`;

  it("takes a purpose and several institutes", () => {
    const parsed = batchPlanSchema.safeParse({
      purpose: "First meeting",
      institute_ids: [id(1), id(2), id(3)],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.institute_ids).toHaveLength(3);
  });

  /** A tick-list with no purpose writes rows that can never be logged. */
  it("refuses an empty purpose", () => {
    expect(batchPlanSchema.safeParse({ purpose: "", institute_ids: [id(1)] }).success).toBe(false);
    expect(batchPlanSchema.safeParse({ purpose: "   ", institute_ids: [id(1)] }).success).toBe(false);
  });

  it("refuses an empty selection rather than doing nothing quietly", () => {
    const parsed = batchPlanSchema.safeParse({ purpose: "First meeting", institute_ids: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/tick at least one/i);
  });

  /** A checkbox list cannot normally produce one; a tampered form can. */
  it("collapses duplicates", () => {
    const parsed = batchPlanSchema.safeParse({
      purpose: "First meeting",
      institute_ids: [id(1), id(1), id(2)],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.institute_ids).toEqual([id(1), id(2)]);
  });

  it("refuses a non-uuid and an implausibly long batch", () => {
    expect(batchPlanSchema.safeParse({ purpose: "x", institute_ids: ["nope"] }).success).toBe(false);
    expect(
      batchPlanSchema.safeParse({
        purpose: "x",
        institute_ids: Array.from({ length: 61 }, (_, i) => id(i % 90)),
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("the separation Phase A rests on, at source level", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

  /**
   * ⚠ THE GUARD THAT MATTERS MOST IN THIS FILE.
   *
   * A follow-up must land in `follow_up_tasks` and NEVER in `daily_plans`. If
   * somebody ever "simplifies" that away, the meeting gate starts seeing rows
   * it cannot process, Rule 7's Meetings figure changes meaning, and the
   * Overview's "of planned" denominator silently counts phone calls as visits.
   * None of those would look wrong on screen, which is exactly why this is
   * asserted rather than trusted.
   *
   * The integration suite proves the behaviour; this catches the edit.
   */
  it("writes the follow-up to follow_up_tasks in 0039, not to daily_plans", () => {
    const sql = read("supabase/migrations/0039_close_visit_next_action.sql");
    const fn = sql.slice(sql.indexOf("create or replace function public.close_visit"));
    const body = fn.slice(0, fn.indexOf("\nrevoke all"));

    expect(body).toContain("insert into public.follow_up_tasks");
    // The only `daily_plans` write in that body is the check-out, which has
    // been there since 0014 and is not a follow-up.
    const planWrites = body.match(/insert into public\.daily_plans/g) ?? [];
    expect(planWrites, "0039 must never INSERT a daily_plans row").toEqual([]);
  });

  it("keeps close_visit SECURITY INVOKER, so RLS and FO031 apply inside it", () => {
    const sql = read("supabase/migrations/0039_close_visit_next_action.sql");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer\nset search_path = ''\nas $$\ndeclare\n  v_member");
  });

  it("defaults the due date from app_today(), never current_date", () => {
    const sql = read("supabase/migrations/0038_follow_up_tasks.sql");
    expect(sql).toContain("default public.app_today()");
    expect(sql).not.toMatch(/due_date\s+date\s+not null default current_date/);
  });

  /** The dashboard reads tasks as their own list, never merged into entries. */
  it("hands the plan its tasks separately from its entries", () => {
    const plan = read("src/components/dashboard/daily-plan.tsx");
    expect(plan).toContain("tasks: FollowUpTask[]");
    expect(plan).toContain("<FollowUpCalls tasks={tasks} />");
  });

  /** A4: one source, two readers — which is what makes the sync unnecessary. */
  it("reads the same helper on the dashboard and on Pending", () => {
    expect(read("src/app/(app)/page.tsx")).toContain("listFollowUpTasks");
    expect(read("src/app/(app)/pending/page.tsx")).toContain("listFollowUpTasks");
  });
});
