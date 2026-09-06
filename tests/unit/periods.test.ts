import { describe, expect, it } from "vitest";
import {
  PERIODS,
  isPeriod,
  monthEndOf,
  monthStartOf,
  normalisePeriodStart,
  periodRange,
  periodStartOf,
  shiftPeriod,
} from "@/lib/periods";
import { mondayOf, weekCountEnd } from "@/lib/weeks";
import {
  progressStatus,
  remaining,
  METRIC_KEYS,
} from "@/lib/validation/weekly";

/**
 * The date arithmetic behind daily, weekly and monthly targets.
 *
 * The weekly case must keep agreeing with weeks.ts, which is the authority for
 * the Monday-to-Saturday reporting week and its Sunday counting end. The other
 * two are new, and month boundaries are where this kind of code usually breaks:
 * February, a leap year, and a 31st that does not exist in the next month.
 */

describe("periodStartOf", () => {
  it("leaves a daily period on the day it was given", () => {
    expect(periodStartOf("daily", "2026-09-16")).toBe("2026-09-16");
  });

  it("snaps a weekly period back to its Monday, agreeing with weeks.ts", () => {
    for (const date of ["2026-09-16", "2026-09-14", "2026-09-20"]) {
      expect(periodStartOf("weekly", date), date).toBe(mondayOf(date));
    }
    expect(periodStartOf("weekly", "2026-09-16")).toBe("2026-09-14");
  });

  it("snaps a monthly period back to the 1st", () => {
    expect(periodStartOf("monthly", "2026-09-16")).toBe("2026-09-01");
    expect(periodStartOf("monthly", "2026-09-01")).toBe("2026-09-01");
    expect(periodStartOf("monthly", "2026-12-31")).toBe("2026-12-01");
  });

  it("is idempotent — snapping an already-snapped date changes nothing", () => {
    for (const period of PERIODS) {
      const once = periodStartOf(period, "2026-09-16");
      expect(periodStartOf(period, once), period).toBe(once);
    }
  });
});

describe("month boundaries", () => {
  it("finds the last day of months of every length", () => {
    expect(monthEndOf("2026-01-01")).toBe("2026-01-31");
    expect(monthEndOf("2026-04-01")).toBe("2026-04-30");
    expect(monthEndOf("2026-02-01")).toBe("2026-02-28");
    expect(monthEndOf("2028-02-01")).toBe("2028-02-29"); // leap year
    expect(monthEndOf("2026-12-01")).toBe("2026-12-31");
  });

  it("works from any day in the month, not just the 1st", () => {
    expect(monthEndOf("2026-02-17")).toBe("2026-02-28");
    expect(monthStartOf("2026-02-17")).toBe("2026-02-01");
  });
});

describe("periodRange — what the achieved figures are counted over", () => {
  it("covers exactly one day for daily", () => {
    expect(periodRange("daily", "2026-09-16")).toEqual({
      start: "2026-09-16",
      end: "2026-09-16",
    });
  });

  it("ends a week on the Sunday, not the Saturday", () => {
    // Rule 7's deliberate asymmetry: the rep is shown Monday to Saturday, but
    // a Sunday's work folds into the week that just ended rather than falling
    // out of every total. weeks.ts owns that decision; this defers to it.
    const range = periodRange("weekly", "2026-09-14");
    expect(range.start).toBe("2026-09-14");
    expect(range.end).toBe(weekCountEnd("2026-09-14"));
    expect(range.end).toBe("2026-09-20"); // the Sunday
  });

  it("covers a whole month for monthly", () => {
    expect(periodRange("monthly", "2026-02-01")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("never returns a range that ends before it starts", () => {
    for (const period of PERIODS) {
      const start = periodStartOf(period, "2026-09-16");
      const range = periodRange(period, start);
      expect(range.end >= range.start, period).toBe(true);
    }
  });
});

describe("shiftPeriod", () => {
  it("steps a day", () => {
    expect(shiftPeriod("daily", "2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftPeriod("daily", "2026-09-30", 1)).toBe("2026-10-01");
  });

  it("steps a week and stays on a Monday", () => {
    expect(shiftPeriod("weekly", "2026-09-14", -1)).toBe("2026-09-07");
    expect(shiftPeriod("weekly", "2026-09-14", 1)).toBe("2026-09-21");
  });

  it("steps a month and stays on the 1st, across a year boundary", () => {
    expect(shiftPeriod("monthly", "2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftPeriod("monthly", "2026-12-01", 1)).toBe("2027-01-01");
  });

  it("does not drift when stepping back and forward again", () => {
    for (const period of PERIODS) {
      const start = periodStartOf(period, "2026-03-15");
      expect(shiftPeriod(period, shiftPeriod(period, start, -1), 1), period).toBe(
        start,
      );
    }
  });

  it("survives a 31st stepping into a shorter month", () => {
    // The classic date bug: naive month arithmetic on the 31st lands in the
    // month after next. period_start is always the 1st, so this cannot happen —
    // asserted rather than assumed.
    expect(shiftPeriod("monthly", periodStartOf("monthly", "2026-01-31"), 1)).toBe(
      "2026-02-01",
    );
  });
});

describe("normalisePeriodStart", () => {
  it("snaps a hand-edited URL onto the period's grid", () => {
    expect(normalisePeriodStart("weekly", "2026-09-16")).toBe("2026-09-14");
    expect(normalisePeriodStart("monthly", "2026-09-16")).toBe("2026-09-01");
    expect(normalisePeriodStart("daily", "2026-09-16")).toBe("2026-09-16");
  });

  it("falls back to the current period for nonsense", () => {
    for (const bad of [undefined, "", "not-a-date", "2026-13-45", "2026-02-31"]) {
      const result = normalisePeriodStart("monthly", bad);
      expect(/^\d{4}-\d{2}-01$/.test(result), String(bad)).toBe(true);
    }
  });
});

describe("isPeriod", () => {
  it("accepts the three and refuses everything else", () => {
    for (const p of PERIODS) expect(isPeriod(p), p).toBe(true);
    for (const bad of ["quarterly", "yearly", "", null, undefined, 7]) {
      expect(isPeriod(bad), String(bad)).toBe(false);
    }
  });
});

describe("remaining and progressStatus", () => {
  it("never reports negative remaining", () => {
    expect(remaining(12, 10)).toBe(0);
    expect(remaining(3, 10)).toBe(7);
    expect(remaining(0, 0)).toBe(0);
  });

  it("reads the three states the way a person would", () => {
    expect(progressStatus(0, 10)).toBe("not-started");
    expect(progressStatus(4, 10)).toBe("in-progress");
    expect(progressStatus(10, 10)).toBe("completed");
    expect(progressStatus(12, 10)).toBe("completed");
  });

  it("calls a commitment of nothing Not Started, not Completed", () => {
    // Committing to nothing and achieving nothing is not an achievement — the
    // same judgement toneFor() makes when it returns "none" rather than "met".
    expect(progressStatus(0, 0)).toBe("not-started");
  });

  it("counts anything achieved against a zero target as in progress", () => {
    expect(progressStatus(3, 0)).toBe("in-progress");
  });
});

describe("the metric set", () => {
  it("carries the ninth metric the targets table has a column for", () => {
    expect(METRIC_KEYS).toContain("institutes_covered");
    expect(METRIC_KEYS).toHaveLength(9);
  });
});
