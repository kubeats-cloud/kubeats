import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NOT_INTERESTED_STATUS,
  SEED_STATUS_CATALOGUE,
  isClosedStatus,
  isOpenStatus,
} from "@/lib/validation/institute";
import {
  followUpRequired,
  nextActionShown,
  visitSchema,
} from "@/lib/validation/visit";
import {
  reconcileActivityCounts,
  tallyVisitMetrics,
  type ReconcilableVisit,
} from "@/lib/validation/weekly";

/**
 * FIX 3 (R5/IQ5). Not Interested is a built-in closed status, and the
 * counting guard sits on the same function the weekly screens already call.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const baseVisit = {
  activity: "olympiad",
  institute_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  daily_plan_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3399",
  lifecycle_status: "",
  expected_date: "",
  latitude: "",
  longitude: "",
  photo_path: "9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d/proof.jpg",
  notes: "",
  status_set_to: NOT_INTERESTED_STATUS,
  follow_up_date: "",
  follow_up_time: "",
};

describe("Not Interested is a built-in closed status", () => {
  it("is in the seed, closed, and asks for no follow-up", () => {
    const row = SEED_STATUS_CATALOGUE.find((entry) => entry.status === NOT_INTERESTED_STATUS);
    expect(row).toMatchObject({
      category: "closed",
      tone: "neutral",
      isActive: true,
      asksExpectedDate: false,
      asksSessionDetail: false,
      asksHeadCount: false,
    });
    expect(isClosedStatus(SEED_STATUS_CATALOGUE, NOT_INTERESTED_STATUS)).toBe(true);
    expect(followUpRequired(SEED_STATUS_CATALOGUE, NOT_INTERESTED_STATUS)).toBe(false);
  });

  it("hides Next Action for Not Interested and for every other closed status", () => {
    expect(nextActionShown(SEED_STATUS_CATALOGUE, NOT_INTERESTED_STATUS)).toBe(false);
    for (const row of SEED_STATUS_CATALOGUE) {
      expect(nextActionShown(SEED_STATUS_CATALOGUE, row.status), row.status).toBe(
        isOpenStatus(SEED_STATUS_CATALOGUE, row.status),
      );
    }
    expect(nextActionShown(SEED_STATUS_CATALOGUE, null)).toBe(false);
  });

  it("refuses a next action on a closed status, including Not Interested", () => {
    for (const status of [NOT_INTERESTED_STATUS, "Session done", "Will not come"]) {
      const result = visitSchema.safeParse({
        ...baseVisit,
        status_set_to: status,
        next_action: "call",
        follow_up_due: "2026-10-21",
      });
      expect(result.success, status).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === "next_action")).toBe(
          true,
        );
      }
    }
  });

  it("accepts Not Interested with no follow-up and no next action", () => {
    const result = visitSchema.safeParse(baseVisit);
    expect(result.success).toBe(true);
  });

  it("still asks Next Action on an open status", () => {
    expect(nextActionShown(SEED_STATUS_CATALOGUE, "First meeting done")).toBe(true);
    const result = visitSchema.safeParse({
      ...baseVisit,
      status_set_to: "First meeting done",
      follow_up_date: "2026-10-21",
      next_action: "call",
      follow_up_due: "2026-10-21",
    });
    expect(result.success).toBe(true);
  });
});

describe("Log Visit hides Next Action when the status is closed", () => {
  it("gates both forms on nextActionShown", () => {
    const log = read("src/components/visits/log-visit-form.tsx");
    const recovery = read("src/components/visits/feedback-only-form.tsx");
    expect(log).toContain("nextActionShown(catalogue, status)");
    expect(recovery).toContain("nextActionShown(catalogue, statusSetTo)");
  });
});

describe("per-institute activity reconciliation", () => {
  const row = (
    institute_id: string,
    activity: string,
    lifecycle_status: string | null,
  ): ReconcilableVisit => ({ institute_id, activity, lifecycle_status });

  it("holds when the six activity counts sum to the visits", () => {
    const visits = [
      row("school-a", "meeting", null),
      row("school-a", "session", "Set"),
      row("school-a", "session", "Done"),
      row("school-a", "campus_visit", "Set"),
      row("school-a", "olympiad", null),
      row("school-a", "application", null),
      row("school-a", "admission", null),
      row("school-b", "meeting", null),
    ];
    expect(reconcileActivityCounts(visits)).toEqual([]);

    // The meetings bucket is not the weekly plan figure. tallyVisitMetrics
    // still refuses to count the meeting rows.
    const tallied = tallyVisitMetrics(visits.filter((visit) => visit.institute_id === "school-a"));
    expect(tallied.meetings).toBe(0);
    expect(tallied.sessions_set + tallied.sessions_done).toBe(2);
  });

  it("fails an institute whose session has no lifecycle", () => {
    const failures = reconcileActivityCounts([
      row("school-a", "session", null),
      row("school-a", "olympiad", null),
      row("school-b", "admission", null),
    ]);
    expect(failures.map((failure) => failure.instituteId)).toEqual(["school-a"]);
    expect(failures[0]).toMatchObject({ total: 2, summed: 1 });
  });

  it("fails an institute with an activity the counting source does not know", () => {
    const failures = reconcileActivityCounts([row("school-a", "workshop", null)]);
    expect(failures).toHaveLength(1);
    expect(failures[0].summed).toBe(0);
    expect(failures[0].total).toBe(1);
  });

  it("does not let one row fill two buckets", () => {
    // A session is Set or Done, never both. The guard uses the same matcher
    // as the tally, so a row that matched twice would fail even if a later
    // change made the metrics overlap.
    const visits = [row("school-a", "session", "Done")];
    expect(reconcileActivityCounts(visits)).toEqual([]);
    const tallied = tallyVisitMetrics(visits);
    expect(tallied.sessions_set + tallied.sessions_done).toBe(1);
  });
});

describe("0046 and its down migration", () => {
  const up = read("supabase/migrations/0046_not_interested.sql");
  const down = read("supabase/rollbacks/0046_not_interested_down.sql");

  it("adds Not Interested as closed and does not copy the retired field", () => {
    expect(up).toContain("'Not Interested', 'closed'");
    expect(up).not.toMatch(/institutes\s+set\s+status\s*=/i);
    expect(up).not.toContain("visit_outcome = 'Not Interested'");
    expect(up).toContain("left as history");
  });

  it("cancels open tasks and deletes only upcoming unstarted plans", () => {
    expect(up).toContain("outcome = 'cancelled'");
    expect(up).toContain("delete from public.daily_plans");
    expect(up).toContain("checkin_at is null");
    expect(up).toContain("meetings_actual is null");
    expect(up).not.toMatch(/delete\s+from\s+public\.visits/i);
    expect(up).not.toMatch(/delete\s+from\s+public\.institutes/i);
  });

  it("refuses a follow-up on a closed status without widening delete policies", () => {
    expect(up).toContain("FO038");
    expect(up).toContain("a closed status creates no follow-up");
    expect(up).not.toMatch(/create\s+policy/i);
    expect(up).toContain("daily_plans_delete");
  });

  it("down drops the behaviour and does not delete history", () => {
    expect(down).toContain("drop trigger if exists institutes_cancel_follow_ups");
    expect(down).toContain("drop function if exists public.cancel_upcoming_follow_ups()");
    expect(down).toContain("drop column if exists cancels_follow_ups");
    expect(down).toContain("if p_follow_up_kind is not null then");
    // The down's own assertion refuses to finish if close_visit still skips
    // the task. The phrase is what it searches the function body for.
    expect(down).toContain("position('a closed status creates no follow-up' in body) > 0");
    expect(down).not.toMatch(/delete\s+from\s+public\.visits/i);
    expect(down).not.toMatch(/delete\s+from\s+public\.institutes\b/i);
    expect(down).toContain("retired rather than deleted");
  });
});
