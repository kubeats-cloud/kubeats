import { describe, expect, it } from "vitest";
import {
  METRICS,
  tallyVisitMetrics,
} from "@/lib/validation/weekly";

/** Rule 7, and the arithmetic the dashboards report. */

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

  it("declares where every metric's achieved figure comes from", () => {
    // Two sources. meetings comes from the daily plan (Rule 7); the other
    // seven are counts of matching visit rows.
    const sources = Object.fromEntries(METRICS.map((m) => [m.key, m.source]));

    expect(sources.meetings).toBe("plan");

    for (const metric of METRICS.filter((m) => m.key !== "meetings")) {
      expect(metric.source, metric.key).toBe("visits");
    }
  });

  it("never lets tallyVisitMetrics fill in the one it does not own", () => {
    // Meetings are the caller's job. A bug that quietly counted them from the
    // visits log would be invisible in the UI, so it is asserted here.
    const tallied = tallyVisitMetrics([
      { activity: "olympiad", lifecycle_status: null },
      { activity: "meeting", lifecycle_status: null },
    ]);
    expect(tallied.meetings).toBe(0);
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

/*
 * The toneFor and completionPercent suites lived here.
 *
 * Both measured achieved AGAINST A TARGET — the colour of a progress bar and
 * the percentage of a commitment. Stage 2 removed the commitment, so both
 * functions went with it and there is no denominator left to test.
 *
 * Rule 7 above is untouched, and that is the half that mattered: it says where
 * each number COMES FROM, which is still true and still load-bearing for the
 * read-only week summary.
 */
