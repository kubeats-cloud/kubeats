import { describe, expect, it } from "vitest";
import {
  addWeeks,
  isInWeek,
  mondayOf,
  normaliseWeekParam,
  weekCountEnd,
  weekEnd,
} from "@/lib/weeks";

/**
 * The week grid. Every weekly figure in the app is bucketed by these, so an
 * off-by-one day here moves real numbers into the wrong week.
 */

// 31 Aug 2026 is a Monday; 5 Sep is its Saturday, 6 Sep its Sunday.
const MONDAY = "2026-08-31";

describe("mondayOf", () => {
  it("returns the same day for a Monday", () => {
    expect(mondayOf(MONDAY)).toBe(MONDAY);
  });

  it("walks back to Monday from any weekday", () => {
    expect(mondayOf("2026-09-02")).toBe(MONDAY); // Wednesday
    expect(mondayOf("2026-09-05")).toBe(MONDAY); // Saturday
  });

  it("pulls a Sunday back into the week that just ended", () => {
    // The whole point of the rule: a Sunday belongs to the preceding week, so
    // no day is orphaned from the rollups.
    expect(mondayOf("2026-09-06")).toBe(MONDAY);
    expect(mondayOf("2026-08-30")).toBe("2026-08-24");
  });

  it("falls back to this week for anything malformed", () => {
    expect(mondayOf("not-a-date")).toBe(mondayOf());
    expect(mondayOf("2026-02-31")).toBe(mondayOf());
  });
});

describe("the two ends of a week", () => {
  it("shows Saturday and counts through Sunday", () => {
    expect(weekEnd(MONDAY)).toBe("2026-09-05");
    expect(weekCountEnd(MONDAY)).toBe("2026-09-06");
  });

  it("counts Monday through Sunday and nothing outside", () => {
    expect(isInWeek(MONDAY, MONDAY)).toBe(true);
    expect(isInWeek("2026-09-05", MONDAY)).toBe(true); // Saturday
    expect(isInWeek("2026-09-06", MONDAY)).toBe(true); // Sunday, folded in
    expect(isInWeek("2026-09-07", MONDAY)).toBe(false); // next Monday
    expect(isInWeek("2026-08-30", MONDAY)).toBe(false); // previous Sunday
    expect(isInWeek(null, MONDAY)).toBe(false);
  });

  it("gives every date exactly one week", () => {
    // Walk a fortnight: each day must fall inside the week its own Monday names,
    // and inside no other.
    for (let day = 0; day < 14; day++) {
      const date = addWeeks(MONDAY, 0);
      const iso = new Date(
        new Date(`${date}T00:00:00.000Z`).getTime() + day * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      const owner = mondayOf(iso);
      expect(isInWeek(iso, owner)).toBe(true);
      expect(isInWeek(iso, addWeeks(owner, -1))).toBe(false);
      expect(isInWeek(iso, addWeeks(owner, 1))).toBe(false);
    }
  });
});

describe("addWeeks", () => {
  it("moves whole weeks and stays on Monday", () => {
    expect(addWeeks(MONDAY, 1)).toBe("2026-09-07");
    expect(addWeeks(MONDAY, -1)).toBe("2026-08-24");
    expect(mondayOf(addWeeks(MONDAY, 7))).toBe(addWeeks(MONDAY, 7));
  });
});

describe("normaliseWeekParam", () => {
  it("keeps a Monday", () => {
    expect(normaliseWeekParam(MONDAY)).toBe(MONDAY);
  });

  it("snaps a mid-week date to its Monday", () => {
    expect(normaliseWeekParam("2026-09-03")).toBe(MONDAY);
  });

  it("falls back to this week rather than erroring", () => {
    // A hand-edited URL should land somewhere sensible, not on a stack trace.
    expect(normaliseWeekParam(undefined)).toBe(mondayOf());
    expect(normaliseWeekParam("../../etc/passwd")).toBe(mondayOf());
    expect(normaliseWeekParam("")).toBe(mondayOf());
  });
});
