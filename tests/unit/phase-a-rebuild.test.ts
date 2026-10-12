import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  batchCallSchema,
  logCallOutcomeSchema,
  meetingPromptsFor,
} from "@/lib/validation/visit";
import { isActive } from "@/lib/nav";
import type { FollowUpTask, PlanEntry } from "@/lib/visits";

/**
 * Phase A rebuild — the pieces that need no database.
 *
 * What a live database proves instead — a real Call next-action writing
 * exactly one `follow_up_tasks(kind='call')` row and zero `daily_plans` rows
 * on the shared date, the same for Meeting, the tick-list's Call mode
 * batching N rows in one insert, and the log-call page's submit actually
 * closing a real task — is the "Phase A rebuild" block in
 * tests/integration/rules.test.ts. What is here is everything provable from
 * the shape alone.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

const task = (overrides: Partial<FollowUpTask> = {}): FollowUpTask => ({
  id: "t1",
  instituteId: "i1",
  instituteName: "Test School",
  kind: "meeting",
  dueDate: "2026-10-13",
  note: null,
  phone: null,
  doneAt: null,
  outcome: null,
  ...overrides,
});

const entry = (
  institute_id: string,
  state: { checkinAt?: string | null; checkoutAt?: string | null; checkoutMissing?: boolean } = {},
): PlanEntry =>
  ({
    institute_id,
    checkinAt: state.checkinAt ?? null,
    checkoutAt: state.checkoutAt ?? null,
    checkoutMissing: state.checkoutMissing ?? false,
  }) as PlanEntry;

describe("meetingPromptsFor", () => {
  it("keeps a meeting-kind task not yet on today's plan", () => {
    const due = meetingPromptsFor([task({ instituteId: "i1", kind: "meeting" })], []);
    expect(due).toHaveLength(1);
  });

  it("excludes a call-kind task entirely — this is the Meeting section's list", () => {
    const due = meetingPromptsFor([task({ instituteId: "i1", kind: "call" })], []);
    expect(due).toHaveLength(0);
  });

  /**
   * THE ONE COLLISION THIS SHAPE CAN PRODUCE. An institute already on
   * today's entries (a real `daily_plans` row) must not also show as a
   * prompt — the plan entry above is where it belongs now.
   */
  it("excludes a meeting whose institute is already on today's plan", () => {
    const due = meetingPromptsFor(
      [task({ instituteId: "i1", kind: "meeting" })],
      [entry("i1")],
    );
    expect(due).toHaveLength(0);
  });

  it("does not exclude a DIFFERENT institute's plan entry", () => {
    const due = meetingPromptsFor(
      [task({ instituteId: "i1", kind: "meeting" })],
      [entry("i2")],
    );
    expect(due).toHaveLength(1);
  });

  /**
   * ★ THE PHASE A BUG, FIXED ★ — a Meeting next-action's own originating
   * visit IS a `daily_plans` row for this institute, today, and it is
   * "Completed" the instant it is logged. The old check excluded on "is
   * this institute in entries at all", which hid the meeting it had just
   * raised before the rep ever saw it, on the Dashboard or on Pending.
   */
  it("does NOT exclude a meeting whose institute's only entry is COMPLETED", () => {
    const due = meetingPromptsFor(
      [task({ instituteId: "i1", kind: "meeting" })],
      [entry("i1", { checkinAt: "2026-10-13T09:00:00Z", checkoutAt: "2026-10-13T09:30:00Z" })],
    );
    expect(due).toHaveLength(1);
  });

  it("still excludes a meeting whose institute has an IN-PROGRESS entry", () => {
    const due = meetingPromptsFor(
      [task({ instituteId: "i1", kind: "meeting" })],
      [entry("i1", { checkinAt: "2026-10-13T09:00:00Z" })],
    );
    expect(due).toHaveLength(0);
  });

  it("excludes a swept (checkout_missing) entry too — still Completed, not upcoming", () => {
    const due = meetingPromptsFor(
      [task({ instituteId: "i1", kind: "meeting" })],
      [entry("i1", { checkinAt: "2026-10-13T09:00:00Z", checkoutMissing: true })],
    );
    expect(due).toHaveLength(1);
  });

  it("answers an empty list for empty input, not an error", () => {
    expect(meetingPromptsFor([], [])).toEqual([]);
  });
});

describe("batchCallSchema", () => {
  const id = (n: number) => `8b1a9953-4c22-4d1f-9b1a-99534c224d${String(n).padStart(2, "0")}`;

  it("takes institute ids and nothing else — no purpose field at all", () => {
    const parsed = batchCallSchema.safeParse({ institute_ids: [id(1), id(2)] });
    expect(parsed.success).toBe(true);
    expect(Object.keys(batchCallSchema.shape)).toEqual(["institute_ids"]);
  });

  it("refuses an empty selection", () => {
    expect(batchCallSchema.safeParse({ institute_ids: [] }).success).toBe(false);
  });

  it("collapses duplicates, like the meeting batch does", () => {
    const parsed = batchCallSchema.safeParse({ institute_ids: [id(1), id(1), id(2)] });
    expect(parsed.data?.institute_ids).toEqual([id(1), id(2)]);
  });

  it("caps at 60, same guard as the meeting batch", () => {
    expect(
      batchCallSchema.safeParse({
        institute_ids: Array.from({ length: 61 }, (_, i) => id(i % 90)),
      }).success,
    ).toBe(false);
  });
});

describe("logCallOutcomeSchema", () => {
  const taskId = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";

  it("accepts done and no_answer — the old buttons' exact two values", () => {
    expect(
      logCallOutcomeSchema.safeParse({ task_id: taskId, outcome: "done", note: "" }).success,
    ).toBe(true);
    expect(
      logCallOutcomeSchema.safeParse({ task_id: taskId, outcome: "no_answer", note: "" })
        .success,
    ).toBe(true);
  });

  /**
   * `follow_up_tasks` permits "rescheduled" too (0038), but nothing before
   * this page ever offered it and this page is not adding it.
   */
  it("refuses rescheduled — not an option this page offers", () => {
    expect(
      logCallOutcomeSchema.safeParse({ task_id: taskId, outcome: "rescheduled", note: "" })
        .success,
    ).toBe(false);
  });

  it("refuses a missing outcome", () => {
    expect(logCallOutcomeSchema.safeParse({ task_id: taskId, outcome: "", note: "" }).success).toBe(
      false,
    );
  });

  it("caps the note at 300, like every other follow-up note", () => {
    const ok = logCallOutcomeSchema.safeParse({
      task_id: taskId, outcome: "done", note: "x".repeat(300),
    });
    expect(ok.success).toBe(true);
    const tooLong = logCallOutcomeSchema.safeParse({
      task_id: taskId, outcome: "done", note: "x".repeat(301),
    });
    expect(tooLong.success).toBe(false);
  });
});

describe("NextActionFields' askDate — one date box, not two", () => {
  const fields = read("src/components/visits/next-action-fields.tsx");

  it("defaults askDate to false", () => {
    expect(fields).toMatch(/askDate\s*=\s*false/);
  });

  it("only posts follow_up_due when askDate is true", () => {
    expect(fields).toMatch(/\{askDate && \(\s*<input type="hidden" name="follow_up_due"/);
  });

  it("Log Visit never passes askDate — it borrows Rule 5's own date instead", () => {
    const form = read("src/components/visits/log-visit-form.tsx");
    const usage = form.slice(form.indexOf("<NextActionFields"));
    const tag = usage
      .slice(0, usage.indexOf("/>") + 2)
      // Comments explaining the default are fine; a passed prop is not.
      .replace(/\/\/[^\n]*/g, "");
    expect(tag).not.toContain("askDate");
    // The one shared box: Log Visit's own needsFollowUp now reads next_action.
    expect(form).toContain('nextAction.kind !== ""');
  });

  it("the recovery form passes askDate — it has no visit-date to borrow", () => {
    const form = read("src/components/visits/feedback-only-form.tsx");
    const usage = form.slice(form.indexOf("<NextActionFields"));
    const tag = usage.slice(0, usage.indexOf("/>") + 2);
    expect(tag).toContain("askDate");
  });
});

describe("logFollowUpCallOutcome never touches a visit, a plan row or a photo", () => {
  const actions = read("src/lib/visit-actions.ts");
  // The last function in the file — nothing to slice off the end of.
  const body = actions.slice(actions.indexOf("export async function logFollowUpCallOutcome"));

  it("is a direct update of follow_up_tasks", () => {
    expect(body).toContain('.from("follow_up_tasks")');
    expect(body).toContain(".update(");
  });

  it("never references visits, daily_plans, check-in or a photo", () => {
    for (const term of ["daily_plans", "visits", "photo", "checkin", "log_visit", "close_visit"]) {
      expect(body.toLowerCase()).not.toContain(term);
    }
  });

  it("is scoped to the member and to kind='call', and only an open task", () => {
    expect(body).toContain('.eq("member", user.id)');
    expect(body).toContain('.eq("kind", "call")');
    expect(body).toContain('.is("done_at", null)');
  });
});

describe("addManyFollowUpCalls batches N rows in one insert, no purpose", () => {
  const actions = read("src/lib/visit-actions.ts");
  const fn = actions.slice(actions.indexOf("export async function addManyFollowUpCalls"));
  const body = fn.slice(0, fn.indexOf("\nexport async function logFollowUpCallOutcome"));

  it("inserts an array, not a loop", () => {
    expect(body).toContain('.from("follow_up_tasks").insert(');
    expect(body).toContain(".map(");
    expect(body).not.toMatch(/for\s*\(|forEach/);
  });

  it("never reads or sends a purpose", () => {
    expect(body.toLowerCase()).not.toContain("purpose");
  });

  it("sends kind: \"call\" as a literal, never from the form", () => {
    expect(body).toContain('kind: "call"');
  });
});

describe("the one follow-up date reaches both RPCs", () => {
  /**
   * The RPC level — a given `p_follow_up_due` really does create the right
   * task, `daily_plans` really is untouched — is already proven in
   * tests/integration/rules.test.ts's "close_visit records what happens
   * next (0039)" block, called directly against the database. What matters
   * here, which that block cannot see, is WHERE `logAndFileVisit()` gets the
   * value it sends: the same field Rule 5's own box writes, not a second one.
   */
  it("logAndFileVisit sends visit.follow_up_date to close_visit's p_follow_up_due", () => {
    const actions = read("src/lib/feedback-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function logAndFileVisit"));
    const body = fn.slice(0, fn.indexOf("\nexport async function", 1));
    expect(body).toContain("p_follow_up_date: visit.follow_up_date");
    expect(body).toContain("p_follow_up_due: visit.follow_up_date");
    expect(body).not.toContain("visit.follow_up_due");
  });
});

describe("the Meeting / Follow-up calls split stays disjoint by kind", () => {
  it("FollowUpCalls filters to call only", () => {
    const file = read("src/components/dashboard/follow-up-calls.tsx");
    expect(file).toContain('task.kind === "call"');
    expect(file).not.toContain('"meeting"');
  });

  it("MeetingPrompts (via meetingPromptsFor) filters to meeting only", () => {
    const helper = read("src/lib/validation/visit.ts");
    const fn = helper.slice(helper.indexOf("export function meetingPromptsFor"));
    const body = fn.slice(0, fn.indexOf("\nexport ", 1));
    expect(body).toContain('task.kind === "meeting"');
  });

  it("neither Done/No-answer button survives on a call row — Log call replaces them", () => {
    const file = read("src/components/dashboard/follow-up-calls.tsx");
    expect(file).not.toContain("closeFollowUpTask");
    expect(file).not.toContain(">Done<");
    expect(file).not.toContain("No answer");
    expect(file).toContain("Log call");
  });
});

describe("closeFollowUpTask's kind guard (Phase A fix)", () => {
  const actions = read("src/lib/visit-actions.ts");
  const fn = actions.slice(actions.indexOf("export async function closeFollowUpTask"));
  const body = fn.slice(0, fn.indexOf("\nexport async function"));

  it("filters the update by the caller's own kind, not just id and member", () => {
    expect(body).toContain('.eq("kind", kind)');
  });

  it("MeetingPrompts' Done button passes \"meeting\" explicitly", () => {
    const file = read("src/components/dashboard/meeting-prompts.tsx");
    expect(file).toContain('closeFollowUpTask(task.id, "done", "meeting")');
  });
});

describe("isActive no longer matches /log-call as the Log Visit tab (Phase A fix)", () => {
  it("does not light 'Log Visit' for the log-call page", () => {
    expect(isActive("/log-call/8b1a9953-4c22-4d1f-9b1a-99534c224d1f", "/log")).toBe(false);
  });

  it("still lights 'Log Visit' for /log itself", () => {
    // usePathname() never carries a query string — /log?plan= is "/log" by
    // the time it reaches isActive — so there is no query case to cover here.
    expect(isActive("/log", "/log")).toBe(true);
  });

  it("still lights Dashboard only on an exact match", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/institutes", "/")).toBe(false);
  });

  it("still lights a real subtree, like an institute's own page", () => {
    expect(isActive("/institutes/abc123", "/institutes")).toBe(true);
  });
});
