import { describe, expect, it } from "vitest";
import {
  METRICS,
  ZERO_COUNTS,
  completionPercent,
  tallyVisitMetrics,
  toneFor,
  type MetricCounts,
} from "@/lib/validation/weekly";

/** Rule 7, and the arithmetic the dashboards report. */

const counts = (overrides: Partial<MetricCounts>): MetricCounts => ({
  ...ZERO_COUNTS,
  ...overrides,
});

describe("Rule 7 — where each metric is counted from", () => {
  it("counts meetings from nowhere in the visits tally", () => {
    // The load-bearing half of the rule. Meetings come from daily_plans; if this
    // ever counted meeting visits instead, a meeting logged without its plan
    // entry marked held would still show up, and the gate would stop meaning
    // anything.
    const tallied = tallyVisitMetrics([
      { activity: "meeting", lifecycle_status: null },
      { activity: "meeting", lifecycle_status: null },
    ]);
    expect(tallied.meetings).toBe(0);
  });

  it("declares meetings as plan-sourced and everything else as visit-sourced", () => {
    const meetings = METRICS.find((m) => m.key === "meetings");
    expect(meetings?.source).toBe("plan");
    for (const metric of METRICS.filter((m) => m.key !== "meetings")) {
      expect(metric.source).toBe("visits");
    }
  });

  it("splits sessions and campus visits by lifecycle", () => {
    const tallied = tallyVisitMetrics([
      { activity: "session", lifecycle_status: "Set" },
      { activity: "session", lifecycle_status: "Done" },
      { activity: "session", lifecycle_status: "Done" },
      { activity: "campus_visit", lifecycle_status: "Set" },
    ]);
    expect(tallied.sessions_set).toBe(1);
    expect(tallied.sessions_done).toBe(2);
    expect(tallied.campus_visits_set).toBe(1);
    expect(tallied.campus_visits_done).toBe(0);
  });

  it("never counts one row under both Set and Done", () => {
    const tallied = tallyVisitMetrics([
      { activity: "session", lifecycle_status: "Done" },
    ]);
    expect(tallied.sessions_set + tallied.sessions_done).toBe(1);
  });

  it("counts the one-shot activities regardless of lifecycle", () => {
    const tallied = tallyVisitMetrics([
      { activity: "olympiad", lifecycle_status: null },
      { activity: "application", lifecycle_status: null },
      { activity: "admission", lifecycle_status: null },
    ]);
    expect(tallied.olympiad).toBe(1);
    expect(tallied.application).toBe(1);
    expect(tallied.admission).toBe(1);
  });
});

describe("toneFor", () => {
  it("is green at or past target, amber from half way, red below", () => {
    expect(toneFor(5, 5)).toBe("met");
    expect(toneFor(6, 5)).toBe("met");
    expect(toneFor(3, 5)).toBe("progressing"); // 60%
    expect(toneFor(1, 5)).toBe("behind"); // 20%
    expect(toneFor(0, 5)).toBe("behind");
  });

  it("does not call an empty commitment an achievement", () => {
    expect(toneFor(0, 0)).toBe("none");
    expect(toneFor(3, 0)).toBe("met");
  });
});

describe("completionPercent", () => {
  it("ignores metrics with no commitment", () => {
    expect(
      completionPercent(counts({ meetings: 4 }), counts({ meetings: 4 })),
    ).toBe(100);
  });

  it("weighs every committed metric equally", () => {
    // 30 meetings and 2 admissions: missing the admissions costs half, even
    // though it is a fraction of the volume.
    const percent = completionPercent(
      counts({ meetings: 30, admission: 0 }),
      counts({ meetings: 30, admission: 2 }),
    );
    expect(percent).toBe(50);
  });

  it("caps each metric so one cannot cover for another", () => {
    const percent = completionPercent(
      counts({ meetings: 100, admission: 0 }),
      counts({ meetings: 10, admission: 5 }),
    );
    expect(percent).toBe(50);
  });

  it("returns null when nothing was committed", () => {
    expect(completionPercent(counts({ meetings: 3 }), ZERO_COUNTS)).toBeNull();
  });
});
