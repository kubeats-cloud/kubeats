import { describe, expect, it } from "vitest";

import {
  daysBetweenISO,
  instituteCounts,
  workedItBy,
} from "@/lib/institute-hub";
import type { VisitSummary } from "@/lib/institutes";

/**
 * The institute hub's derived facts, without a database.
 *
 * These are pure precisely so the numbers printed at the top of
 * /institutes/[id] can be proved rather than eyeballed: they are counted from
 * the same array the visit history below them prints, and a count that
 * disagrees with the list under it is the one failure this whole shape exists
 * to avoid.
 */

/** Only the fields these functions read. */
const visit = (
  member: string,
  name: string | null,
  date: string,
): VisitSummary => ({ member, memberName: name, date }) as VisitSummary;

describe("daysBetweenISO", () => {
  it("counts whole days forward", () => {
    expect(daysBetweenISO("2026-09-19", "2026-09-24")).toBe(5);
  });

  it("is zero on the same day", () => {
    expect(daysBetweenISO("2026-09-24", "2026-09-24")).toBe(0);
  });

  /** Month and year boundaries, where naive arithmetic goes wrong. */
  it("crosses a month and a year", () => {
    expect(daysBetweenISO("2026-08-30", "2026-09-02")).toBe(3);
    expect(daysBetweenISO("2025-12-30", "2026-01-02")).toBe(3);
  });

  /** A leap day is a real day; 2028 is a leap year. */
  it("counts through 29 February", () => {
    expect(daysBetweenISO("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    expect(daysBetweenISO("not-a-date", "2026-09-24")).toBeNull();
    expect(daysBetweenISO("2026-09-24", "")).toBeNull();
  });
});

describe("instituteCounts", () => {
  const visits = [
    visit("a", "Asha", "2026-09-23"),
    visit("b", "Bhavin", "2026-09-10"),
    visit("a", "Asha", "2026-09-19"),
  ];

  it("counts the visits it was given", () => {
    expect(instituteCounts(visits, null).visits).toBe(3);
  });

  /**
   * The history arrives newest-first today. Taking `visits[0].date` would work
   * and would break silently the day anything re-sorts it, so the maximum is
   * taken rather than the first.
   */
  it("finds the latest date regardless of array order", () => {
    expect(instituteCounts(visits, null).lastVisit).toBe("2026-09-23");

    const reordered = [...visits].sort((x, y) => x.date.localeCompare(y.date));
    expect(instituteCounts(reordered, null).lastVisit).toBe("2026-09-23");
  });

  it("has no last visit when there are none", () => {
    expect(instituteCounts([], null)).toEqual({
      visits: 0,
      lastVisit: null,
      daysAtStatus: null,
    });
  });

  /**
   * `status_updated_at` is a timestamp and "today" is a calendar day in
   * Asia/Kolkata, so the conversion goes through `todayISO()` — the app's one
   * definition of a day, shared with `public.app_today()`.
   */
  it("counts days at the current status", () => {
    const counts = instituteCounts(
      [],
      "2026-09-19T16:21:04Z",
      new Date("2026-09-24T12:00:00Z"),
    );
    expect(counts.daysAtStatus).toBe(5);
  });

  /**
   * THE TIMEZONE CASE. 2026-09-19T19:00Z is already the 20th in Kolkata
   * (00:30 IST), so a UTC reading would count one day too many.
   */
  it("reads both ends as Kolkata days, not UTC days", () => {
    const counts = instituteCounts(
      [],
      "2026-09-19T19:00:00Z",
      new Date("2026-09-24T12:00:00Z"),
    );
    expect(counts.daysAtStatus).toBe(4);
  });

  it("has no day count when the status was never stamped", () => {
    expect(instituteCounts([], null).daysAtStatus).toBeNull();
  });
});

describe("workedItBy", () => {
  it("gives one row per rep, with their own visit count", () => {
    const rows = workedItBy([
      visit("a", "Asha", "2026-09-23"),
      visit("b", "Bhavin", "2026-09-10"),
      visit("a", "Asha", "2026-09-19"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      memberId: "a",
      name: "Asha",
      visits: 2,
      lastVisit: "2026-09-23",
    });
  });

  it("puts the busiest first, breaking ties on the most recent visit", () => {
    const rows = workedItBy([
      visit("a", "Asha", "2026-09-01"),
      visit("b", "Bhavin", "2026-09-20"),
    ]);
    expect(rows.map((r) => r.memberId)).toEqual(["b", "a"]);
  });

  /** Keyed on the id, so an unnamed rep cannot silently merge with another. */
  it("keeps an unnamed rep separate", () => {
    const rows = workedItBy([
      visit("a", null, "2026-09-01"),
      visit("b", null, "2026-09-02"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.name === "Unnamed rep")).toBe(true);
  });

  it("answers an empty history with no rows", () => {
    expect(workedItBy([])).toEqual([]);
  });

  /** The tally must account for every visit, or the panel contradicts the list. */
  it("sums back to the number of visits", () => {
    const visits = [
      visit("a", "Asha", "2026-09-01"),
      visit("a", "Asha", "2026-09-02"),
      visit("b", "Bhavin", "2026-09-03"),
      visit("c", "Chetan", "2026-09-04"),
    ];
    expect(workedItBy(visits).reduce((sum, r) => sum + r.visits, 0)).toBe(
      visits.length,
    );
  });
});
