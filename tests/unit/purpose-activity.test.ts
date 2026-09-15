import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVITIES,
  ACTIVITY_KEYS,
  hasLifecycle,
  plannedActivityIsValid,
  plannedActivityLabel,
  dailyPlanSchema,
} from "@/lib/validation/visit";
import { METRICS } from "@/lib/validation/weekly";

/**
 * Stage 3 — the activity is DERIVED from the plan's purpose, not chosen.
 *
 * The selector is gone, so every question it used to answer is now answered by
 * one `purposes` row: which of the six fixed activities the visit is, and
 * whether it is Set or Done. Which makes the derivation load-bearing in a way a
 * pre-fill was not — get it wrong and a rep's work lands in the wrong weekly
 * metric, or in none.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

describe("plannedActivityIsValid — the pair the visits table would accept", () => {
  it("accepts the four lifecycle combinations that exist", () => {
    for (const activity of ["session", "campus_visit"] as const) {
      for (const lifecycle of ["Set", "Done"] as const) {
        expect(plannedActivityIsValid({ activity, lifecycle }), `${activity}/${lifecycle}`).toBe(
          true,
        );
      }
    }
  });

  it("accepts the four one-shots, and only with a NULL lifecycle", () => {
    // Not a judgement call: visits_lifecycle_matches_activity (0001) refuses a
    // lifecycle on anything that is not a session or a campus visit, so a
    // purpose mapping to meeting/olympiad/application/admission must carry
    // null. This is where "First meeting" and "Other" land.
    for (const activity of ["meeting", "olympiad", "application", "admission"] as const) {
      expect(plannedActivityIsValid({ activity, lifecycle: null }), activity).toBe(true);
      expect(
        plannedActivityIsValid({ activity, lifecycle: "Done" }),
        `${activity} must not carry a lifecycle`,
      ).toBe(false);
    }
  });

  it("refuses a lifecycle activity with no lifecycle", () => {
    // The other direction of the same CHECK, and the one that matters most:
    // "Fix a session" and "Complete a session" both map to `session`, so a
    // missing Set/Done is the difference between Sessions Set and nothing at
    // all.
    for (const activity of ["session", "campus_visit"] as const) {
      expect(plannedActivityIsValid({ activity, lifecycle: null }), activity).toBe(false);
      expect(plannedActivityIsValid({ activity, lifecycle: "Held" }), activity).toBe(
        false,
      );
    }
  });

  it("refuses a plan with no mapping at all", () => {
    // Reachable two ways, both handled rather than crashed on: a plan made
    // before 0025 linked plans to purposes, and one whose purpose was DELETED
    // rather than retired. /log shows a sentence and sends the rep back to
    // re-plan; their check-in is untouched.
    expect(plannedActivityIsValid(null)).toBe(false);
    expect(plannedActivityIsValid({ activity: null, lifecycle: null })).toBe(false);
    expect(plannedActivityIsValid({ activity: "event", lifecycle: null })).toBe(false);
  });

  it("agrees with hasLifecycle for every activity in the vocabulary", () => {
    // Two statements of one rule, checked against each other rather than
    // against a list written out a third time.
    for (const key of ACTIVITY_KEYS) {
      expect(plannedActivityIsValid({ activity: key, lifecycle: "Set" }), key).toBe(
        hasLifecycle(key),
      );
      expect(plannedActivityIsValid({ activity: key, lifecycle: null }), key).toBe(
        !hasLifecycle(key),
      );
    }
  });
});

describe("every weekly metric is still reachable from a purpose", () => {
  /**
   * THE FAILURE THIS GUARDS IS SILENT.
   *
   * Before stage 3 a rep could reach any activity from the selector. Now the
   * only route to one is a purpose mapped to it, so a metric with no purpose
   * behind it simply cannot be earned — and nobody finds out until a week's
   * numbers come in flat.
   *
   * Migration 0025's assertion block checks this against the real table and
   * refuses to apply otherwise. This checks the other half: that the shape the
   * app derives is one Rule 7 can actually count.
   */
  it("each of the eight metrics names a derivable (activity, lifecycle) pair", () => {
    const visitMetrics = METRICS.filter((m) => m.source === "visits");
    expect(visitMetrics).toHaveLength(7); // the eighth, Meetings, comes from daily_plans

    for (const metric of visitMetrics) {
      expect(
        plannedActivityIsValid({
          activity: metric.activity,
          lifecycle: metric.lifecycle ?? null,
        }),
        `${metric.label} (${metric.activity}/${metric.lifecycle ?? "null"})`,
      ).toBe(true);
    }
  });

  it("Meetings is derivable too, even though it is counted from the plan", () => {
    // Rule 7 counts Meetings from daily_plans.meetings_actual, which log_visit()
    // sets only when the activity is `meeting`. So the derivation still has to
    // be able to produce one.
    expect(plannedActivityIsValid({ activity: "meeting", lifecycle: null })).toBe(true);
  });
});

describe("plannedActivityLabel — what the rep is shown instead of a dropdown", () => {
  it("spells out Set and Done, which mean nothing on their own", () => {
    expect(plannedActivityLabel({ activity: "session", lifecycle: "Set" })).toBe(
      "Session · to be held later",
    );
    expect(plannedActivityLabel({ activity: "campus_visit", lifecycle: "Done" })).toBe(
      "Campus Visit · held today",
    );
  });

  it("says just the activity when there is no lifecycle", () => {
    expect(plannedActivityLabel({ activity: "meeting", lifecycle: null })).toBe(
      "Meeting",
    );
    expect(plannedActivityLabel({ activity: "olympiad", lifecycle: null })).toBe(
      "Olympiad Registration",
    );
  });

  it("names every activity in the vocabulary", () => {
    for (const activity of ACTIVITIES) {
      const label = plannedActivityLabel({
        activity: activity.key,
        lifecycle: activity.lifecycle ? "Done" : null,
      });
      expect(label.startsWith(activity.label), activity.key).toBe(true);
    }
  });
});

describe('the "Other" purpose has to say what it means', () => {
  const base = {
    institute_id: "3f1d4f4e-2b6a-4f1a-9f4e-9d2c1b0a7e55",
    purpose: "Other",
  };

  it("refuses a note-demanding purpose with no note", () => {
    const result = dailyPlanSchema.safeParse({
      ...base,
      purpose_note: "",
      requires_note: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "purpose_note");
      expect(issue?.message).toBe("Say what this visit is for.");
    }
  });

  it("accepts it once the words are there", () => {
    expect(
      dailyPlanSchema.safeParse({
        ...base,
        purpose_note: "Dropped off the new prospectus",
        requires_note: true,
      }).success,
    ).toBe(true);
  });

  it("asks nothing of a purpose that does not demand a note", () => {
    expect(
      dailyPlanSchema.safeParse({
        ...base,
        purpose: "First meeting",
        purpose_note: "",
        requires_note: false,
      }).success,
    ).toBe(true);
  });
});

describe("the Activity selector is gone and stays gone", () => {
  /**
   * WHY A SOURCE-LEVEL TEST. Proving this properly needs a DOM, and this
   * project has no DOM test environment on purpose — vitest.config.mts
   * documents the split. So this asserts the two things checkable from Node,
   * the same bargain `log-visit-form.test.ts` and `capture-fields.test.ts`
   * strike.
   *
   * The regression it guards is not "somebody re-adds a dropdown" but something
   * quieter: restoring `useState` for the activity would make the hidden field
   * divergeable from the plan, and a rep could file a session as a meeting
   * again — which is exactly the mismatch stage 3 exists to close.
   */
  const source = read("src/components/visits/log-visit-form.tsx");

  it("offers no Activity or Set/Done control", () => {
    expect(source).not.toContain('aria-label="Activity"');
    expect(source).not.toContain('aria-label="Set or Done"');
    expect(source).not.toContain("setActivity");
    expect(source).not.toContain("setLifecycleStatus");
  });

  it("derives both from the plan instead", () => {
    expect(source).toContain("plannedActivityIsValid");
    expect(source).toContain("plan.activity");
    expect(source).toContain("plan.lifecycle");
  });

  it("still posts both, because log_visit() is unchanged", () => {
    // The RPC, the meeting gate and Rule 3's CHECK all still take the activity
    // from the row being inserted. Stage 3 changed where the value comes from,
    // not what the database is told.
    expect(source).toContain('name="activity"');
    expect(source).toContain('name="lifecycle_status"');
  });

  it("explains to the next reader why nothing is asked here", () => {
    expect(source).toMatch(/derive|Decided by what you planned/i);
  });
});
