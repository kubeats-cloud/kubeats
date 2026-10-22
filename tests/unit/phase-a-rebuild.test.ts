import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  batchCallSchema,
  listedFollowUpCount,
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

describe("Log Call is the visit form minus photo, not Done/No answer", () => {
  const form = read("src/components/visits/log-call-form.tsx");

  it("renders StatusOutcomeFields, not an outcome picker", () => {
    expect(form).toContain("<StatusOutcomeFields");
    expect(form).not.toContain('value="done"');
    expect(form).not.toContain("no_answer");
    expect(form).not.toContain("No answer");
  });

  it("never mounts a photo, a check-in or a GPS checkout", () => {
    expect(form).not.toContain("CaptureFields");
    expect(form).not.toContain("checkoutFix");
    expect(form).not.toContain("geolocate");
    expect(form).toContain("openLoops={[]}");
  });

  it("always shows Next Action", () => {
    expect(form).toContain("showNextAction");
  });
});

describe("corrected Next Action uses the existing follow-up date", () => {
  const fields = read("src/components/visits/next-action-fields.tsx");
  it("adds no second visible date or note control", () => {
    expect(fields).not.toContain('type="date"');
    expect(fields).not.toContain('What about?');
    expect(fields).toContain('name="next_action"');
    expect(fields).toContain('name="follow_up_due"');
  });
  it("both status-driven form paths hide the action for closed statuses", () => {
    expect(read("src/components/visits/status-outcome-fields.tsx")).toContain("nextActionShown(catalogue, status)");
    expect(read("src/components/visits/log-visit-form.tsx")).toContain("nextActionShown(catalogue, status)");
    expect(read("src/components/visits/feedback-only-form.tsx")).toContain("nextActionShown(catalogue, statusSetTo)");
  });
});

describe("logFollowUpCallOutcome never touches a visit, a plan row or a photo", () => {
  const actions = read("src/lib/visit-actions.ts");
  // Includes CALL_RPC immediately above the function — the codes live there.
  const body = actions.slice(actions.indexOf("const CALL_RPC"));

  it("calls log_call, not a table update", () => {
    expect(body).toContain('.rpc("log_call"');
    expect(body).not.toContain('.from("follow_up_tasks")');
    expect(body).not.toContain(".update(");
  });

  it("never writes daily_plans, visits, a check-in or a photo path", () => {
    expect(body).not.toContain('.from("daily_plans")');
    expect(body).not.toContain('.from("visits")');
    expect(body).not.toContain("photo_path");
    expect(body).not.toContain("checkin");
    expect(body).not.toContain("log_visit");
    expect(body).not.toContain("close_visit");
  });

  it("maps FO004, FO006, FO016, FO024 and FO038-FO044 by code", () => {
    for (const code of [
      "FO004",
      "FO006",
      "FO016",
      "FO024",
      "FO038",
      "FO039",
      "FO040",
      "FO041",
      "FO042",
      "FO043",
      "FO044",
    ]) {
      expect(body, code).toContain(code);
    }
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

describe("listedFollowUpCount matches what Pending's block actually lists (Phase A fix)", () => {
  it("counts a call and an untouched meeting prompt — the ordinary case", () => {
    const tasks = [task({ id: "c1", kind: "call" }), task({ id: "m1", kind: "meeting" })];
    expect(listedFollowUpCount(tasks, [])).toBe(2);
  });

  /**
   * ★ THE HEADER BUG, PINNED ★ — "1 follow-up you set" over nothing listed.
   * The meeting task is still OPEN (it has no `doneAt`), but the moment its
   * institute has an upcoming plan entry, `meetingPromptsFor()` stops
   * showing it as a prompt — correctly, it is now a real plan row. The old
   * header read `dueTasks.length`, which does not know that; this must.
   */
  it("drops a meeting from the count the instant it is genuinely planned", () => {
    const tasks = [task({ id: "c1", kind: "call" }), task({ id: "m1", kind: "meeting", instituteId: "i1" })];
    const plannedEntries = [entry("i1", { checkinAt: null })]; // "Scheduled" — upcoming, not Completed
    expect(listedFollowUpCount(tasks, plannedEntries)).toBe(1);
  });

  it("is zero when nothing is listed", () => {
    expect(listedFollowUpCount([], [])).toBe(0);
  });

  it("counts only calls when every meeting is already planned", () => {
    const tasks = [
      task({ id: "m1", kind: "meeting", instituteId: "i1" }),
      task({ id: "m2", kind: "meeting", instituteId: "i2" }),
    ];
    const plannedEntries = [entry("i1"), entry("i2")];
    expect(listedFollowUpCount(tasks, plannedEntries)).toBe(0);
  });
});

describe("MeetingPrompts' 'Plan it' opens StartFollowUp in place (Phase A fix)", () => {
  const file = read("src/components/dashboard/meeting-prompts.tsx");

  it("reuses StartFollowUp rather than building a new form", () => {
    expect(file).toContain(
      'import { StartFollowUp } from "@/components/visits/follow-up-list"',
    );
    expect(file).toContain("<StartFollowUp");
    // "No new UI": no second form-building import that would suggest a
    // parallel panel was written instead of reusing this one.
    expect(file).not.toContain("useActionState");
  });

  it("builds the stub from only the two fields StartFollowUp reads — no status, no city", () => {
    const stubStart = file.indexOf("const stub: FollowUp");
    const stub = file.slice(stubStart, file.indexOf("return (", stubStart));
    expect(stub).toContain("instituteId: task.instituteId");
    expect(stub).toContain("instituteName: task.instituteName");
    // The other fields are present only because FollowUp requires the shape —
    // null/placeholder, never read FROM the task or anywhere else.
    expect(stub).toContain('status: ""');
    expect(stub).toContain("city: null");
  });

  it("no longer links away to /pending — it opens in place instead", () => {
    expect(file).not.toContain('href={`/pending?due=today`}');
  });

  /**
   * ★ THE EDGE CASE THE DECISION WAS ABOUT ★ — a meeting raised while the
   * status was CLOSED must still get a working panel. `StartFollowUp()` is
   * exported from `follow-up-list.tsx`; the real proof it works independently
   * of `getOpenFollowUps()` is in `startFollowUp()` itself (visit-actions.ts)
   * — read directly, not inferred — which this checks never gained a status
   * read on this path.
   */
  /**
   * The stub's `status: ""` placeholder is expected — FollowUp requires the
   * field structurally, see the test above. What must NOT be here is any of
   * the actual machinery that asks or filters on a REAL status. The doc
   * comment NAMES `getOpenFollowUps()` to explain why it is not needed, so
   * this checks for an IMPORT of it, not the bare word.
   */
  it("does not filter or gate by the institute's current status anywhere in this file", () => {
    for (const term of ["isOpenStatus", "statusRow", "catalogue"]) {
      expect(file, term).not.toContain(term);
    }
    expect(file).not.toMatch(/import\s*\{[^}]*getOpenFollowUps/);
  });

  it("startFollowUp() itself still asks nothing about institute status", () => {
    const actions = read("src/lib/visit-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function startFollowUp"));
    const body = fn.slice(0, fn.indexOf("\nexport async function removeFromDailyPlan"));
    expect(body.toLowerCase()).not.toContain("institutes.status");
    expect(body).not.toContain("getOpenFollowUps");
  });

  it("StartFollowUp is exported, for MeetingPrompts to import directly", () => {
    const followUpList = read("src/components/visits/follow-up-list.tsx");
    expect(followUpList).toContain("export function StartFollowUp");
  });

  /**
   * "Planning removes the prompt without closing the task" — unchanged by
   * this fix. Closing still only ever happens through closeFollowUpTask's
   * own kind-guarded path (Done) or the log-call page; opening the panel
   * does not touch done_at at all.
   */
  it("does not call closeFollowUpTask from the open-panel path", () => {
    const openBranch = file.slice(file.indexOf('open === task.id ? ('));
    const panel = openBranch.slice(0, openBranch.indexOf(") : ("));
    expect(panel).not.toContain("closeFollowUpTask");
  });
});
