import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PHASE_A_DAILY_PLAN } from "@/lib/features";
import { visitSchema } from "@/lib/validation/visit";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

/**
 * Phase A's daily-plan surfaces, taken down for a redo.
 *
 * ⚠ WHAT THIS FILE IS ACTUALLY GUARDING is not that the flag is off — the
 * client may turn it back on tomorrow and nothing here should fail when they
 * do. It is that the flag only ever hides a SURFACE: the schema, the rows, the
 * rules and the save path are all untouched, and a visit still logs with the
 * field gone.
 *
 * So every assertion below is either independent of the flag's value, or reads
 * the flag and asserts the matching shape.
 */

describe("the flag is one switch, and it hides screens only", () => {
  it("is a single exported constant", () => {
    expect(typeof PHASE_A_DAILY_PLAN).toBe("boolean");
  });

  /**
   * ⚠ NOT AN ENVIRONMENT VARIABLE. CLAUDE.md requires every `process.env` read
   * to live in env.ts, and a deployment-configured flag would let two
   * environments disagree about whether a feature exists with neither saying so
   * in a diff.
   */
  it("reads no environment variable", () => {
    /*
     * COMMENTS STRIPPED, which is the difference between a test and a word
     * search: features.ts explains at length WHY it is not an env var, naming
     * `process.env` and `NEXT_PUBLIC_*` to do so, and a raw match fails the
     * moment the file documents its own decision. The same trap the alerts and
     * roles suites both hit.
     */
    const code = read("src/lib/features.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("process.env");
    expect(code).not.toContain("NEXT_PUBLIC");
    // And what survives is one exported constant.
    expect(code).toMatch(/export const PHASE_A_DAILY_PLAN = (true|false);/);
  });

  /** One name, so re-enabling is one edit. */
  it("is the only flag the Phase A surfaces consult", () => {
    for (const path of [
      "src/components/dashboard/daily-plan.tsx",
      "src/components/visits/log-visit-form.tsx",
      "src/components/visits/feedback-only-form.tsx",
      "src/app/(app)/page.tsx",
    ]) {
      expect(read(path), path).toContain("PHASE_A_DAILY_PLAN");
    }
  });

  /**
   * ⚠ THE TAKE-DOWN MUST NOT HAVE DELETED ANYTHING. Hiding a surface and
   * removing a feature look identical on screen and are entirely different in
   * the database — these are the four things a careless "cleanup" would take
   * with it, and every one is still referenced.
   */
  it("leaves the data layer and its rules in place", () => {
    // The table, its policies and FO031.
    expect(read("supabase/migrations/0038_follow_up_tasks.sql")).toContain(
      "create table if not exists public.follow_up_tasks",
    );
    // The column that records what the rep said they would do next.
    expect(read("supabase/migrations/0038_follow_up_tasks.sql")).toContain(
      "add column if not exists next_action text",
    );
    // close_visit() still accepts the pair, defaulted.
    expect(read("supabase/migrations/0039_close_visit_next_action.sql")).toContain(
      "p_follow_up_kind",
    );
    // And the components are still in the repo, ready to be switched back on.
    expect(read("src/components/visits/next-action-fields.tsx")).toContain(
      "next_action",
    );
    expect(read("src/components/dashboard/morning-plan.tsx")).toContain("MorningPlan");
  });

  /**
   * Pending keeps its follow-up list on purpose: it is the only place a rep can
   * CLOSE a task they already owe, and hiding it would strand every outstanding
   * row. features.ts carries the reasoning; this stops it being swept up by
   * someone finishing the job.
   */
  it("leaves Pending able to close what is already owed", () => {
    const pending = read("src/app/(app)/pending/page.tsx");
    expect(pending).toContain("FollowUpCalls");
    expect(pending).not.toContain("PHASE_A_DAILY_PLAN");
  });
});

describe("a visit still saves with the field gone", () => {
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
    status_set_to: "Will not come",
    follow_up_date: "",
    follow_up_time: "",
  };

  /**
   * ⚠ THE ASSERTION THE TAKE-DOWN RESTS ON. With the field not rendered, the
   * form posts no `next_action`, `follow_up_due` or `follow_up_note` key at
   * all — all three hidden inputs live inside `NextActionFields`.
   *
   * That absence-tolerance was built for a rep submitting a CACHED page during
   * the Phase A deploy; taking the field back down is the same situation
   * pointing the other way, which is why this needed no schema change. A
   * required key here would refuse a rep's whole visit at a school gate, with
   * the photograph already taken.
   */
  it("accepts a submission with no next-action keys", () => {
    const parsed = visitSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.next_action).toBeNull();
    expect(parsed.data?.follow_up_due).toBeNull();
    expect(parsed.data?.follow_up_note).toBeNull();
  });

  /** And still accepts one WITH them, so turning the flag back on needs nothing else. */
  it("still accepts a submission carrying them", () => {
    const parsed = visitSchema.safeParse({
      ...base,
      next_action: "call",
      follow_up_due: "2026-10-08",
      follow_up_note: "Fees",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.next_action).toBe("call");
  });

  /**
   * The three hidden inputs are INSIDE the component, which is what makes not
   * rendering it equivalent to not asking. If one ever moved out to the parent
   * form, the flag would hide the control and keep posting an empty value.
   */
  it("keeps every next-action input inside the component the flag hides", () => {
    const fields = read("src/components/visits/next-action-fields.tsx");
    for (const name of ["next_action", "follow_up_due", "follow_up_note"]) {
      expect(fields).toContain(`name="${name}"`);
    }
    for (const path of [
      "src/components/visits/log-visit-form.tsx",
      "src/components/visits/feedback-only-form.tsx",
    ]) {
      expect(read(path), path).not.toContain('name="next_action"');
    }
  });
});

describe("what the flag must NOT reach", () => {
  /**
   * `daily_plans` was never Phase A's. The plan itself, the meeting gate,
   * check-in/out and Rule 7's Meetings figure all predate it — what Phase A
   * added was the SPLIT and the batch add, and only those come down.
   */
  it("leaves the plan, its check-in chain and the meeting gate alone", () => {
    const plan = read("src/components/dashboard/daily-plan.tsx");
    expect(plan).toContain("addToDailyPlan");
    // The control is `CheckInButton`, from check-buttons.tsx — the chain the
    // meeting gate and the presence guarantee both hang off, and none of it
    // is Phase A's.
    expect(plan).toContain("CheckInButton");
  });

  /** E1's alert machinery is a cron job, not a screen, and is not shipped. */
  it("does not touch the alert layer", () => {
    for (const path of ["src/lib/alerts.ts", "src/lib/alert-actions.ts"]) {
      expect(read(path), path).not.toContain("PHASE_A_DAILY_PLAN");
    }
  });
});
