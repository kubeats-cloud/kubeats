import { describe, expect, it } from "vitest";
import {
  DAILY_STATUSES,
  DAILY_STATUS_LABELS,
  DAILY_STATUS_PAGE_SIZE,
  EMPTY_DAILY_STATUS_COUNTS,
  isDailyStatus,
  rowForRep,
  shapeDailyStatusReport,
} from "@/lib/validation/rep-daily-status";

/**
 * The contract between 0069's `rep_daily_status_report()` and the two screens.
 * Pure shaping only — the RLS and RPC behaviour is covered against a real
 * Postgres in tests/integration/rules.test.ts.
 */

const PAYLOAD = {
  start: "2026-09-01",
  end: "2026-09-07",
  total: 2,
  pages: 1,
  page: 1,
  totals: { inField: 2, inOffice: 3, onLeave: 1, recorded: 6 },
  rows: [
    {
      id: "rep-a",
      name: "Asha",
      inField: 2,
      inOffice: 1,
      onLeave: 1,
      recorded: 4,
      days: [
        { date: "2026-09-01", status: "in_field" },
        { date: "2026-09-02", status: "in_field" },
        { date: "2026-09-03", status: "on_leave" },
        { date: "2026-09-05", status: "in_office" },
      ],
    },
    {
      id: "rep-b",
      name: "Bilal",
      inField: 0,
      inOffice: 2,
      onLeave: 0,
      recorded: 2,
      days: [
        { date: "2026-09-01", status: "in_office" },
        { date: "2026-09-04", status: "in_office" },
      ],
    },
  ],
};

describe("the three statuses", () => {
  it("are exactly in_field, in_office, on_leave", () => {
    expect(DAILY_STATUSES).toEqual(["in_field", "in_office", "on_leave"]);
  });

  it("have client wording for each, and no fourth", () => {
    expect(DAILY_STATUS_LABELS).toEqual({
      in_field: "In-Field",
      in_office: "In-Office",
      on_leave: "On-Leave",
    });
  });

  it("isDailyStatus refuses anything else, including a tempting fourth value", () => {
    expect(isDailyStatus("in_field")).toBe(true);
    expect(isDailyStatus("in_office")).toBe(true);
    expect(isDailyStatus("on_leave")).toBe(true);
    // The database's CHECK refuses this with 23514; the app must not offer it.
    expect(isDailyStatus("at_lunch")).toBe(false);
    expect(isDailyStatus("In-Field")).toBe(false);
    expect(isDailyStatus(null)).toBe(false);
    expect(isDailyStatus(undefined)).toBe(false);
  });
});

describe("shapeDailyStatusReport", () => {
  it("keeps the range, totals and both rows", () => {
    const report = shapeDailyStatusReport(PAYLOAD);
    expect(report).not.toBeNull();
    expect(report!.start).toBe("2026-09-01");
    expect(report!.end).toBe("2026-09-07");
    expect(report!.total).toBe(2);
    expect(report!.totals).toEqual({
      inField: 2,
      inOffice: 3,
      onLeave: 1,
      recorded: 6,
    });
    expect(report!.rows).toHaveLength(2);
    expect(report!.rows[0]).toMatchObject({
      id: "rep-a",
      name: "Asha",
      inField: 2,
      inOffice: 1,
      onLeave: 1,
      recorded: 4,
    });
  });

  it("keeps only the days that were recorded — an unset day has no entry", () => {
    // Asha recorded 4 of the range's 7 days. The three she did not declare are
    // absent, not present as a placeholder or as an inferred status.
    const report = shapeDailyStatusReport(PAYLOAD)!;
    expect(report.rows[0].days).toEqual(PAYLOAD.rows[0].days);
    expect(report.rows[0].days).toHaveLength(report.rows[0].recorded);
    expect(report.rows[0].days.map((day) => day.date)).not.toContain("2026-09-04");
  });

  it("drops a malformed day entry rather than losing the rep's whole row", () => {
    const report = shapeDailyStatusReport({
      ...PAYLOAD,
      rows: [
        {
          ...PAYLOAD.rows[0],
          days: [
            { date: "2026-09-01", status: "in_field" },
            { date: "2026-09-02", status: "at_lunch" },
            { status: "in_office" },
            null,
          ],
        },
      ],
    })!;
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].days).toEqual([
      { date: "2026-09-01", status: "in_field" },
    ]);
  });

  it("falls back to a readable name, never an undefined cell", () => {
    const report = shapeDailyStatusReport({
      ...PAYLOAD,
      rows: [{ ...PAYLOAD.rows[0], name: "   " }],
    })!;
    expect(report.rows[0].name).toBe("Unnamed rep");
  });

  it("coerces missing or nonsense counts to zero instead of NaN", () => {
    const report = shapeDailyStatusReport({
      ...PAYLOAD,
      totals: {},
      rows: [{ id: "rep-a", name: "Asha", days: [] }],
    })!;
    expect(report.totals).toEqual(EMPTY_DAILY_STATUS_COUNTS);
    expect(report.rows[0]).toMatchObject(EMPTY_DAILY_STATUS_COUNTS);
  });

  it("answers null for anything that is not the contract", () => {
    expect(shapeDailyStatusReport(null)).toBeNull();
    expect(shapeDailyStatusReport("nope")).toBeNull();
    expect(shapeDailyStatusReport({})).toBeNull();
    // A missing rows array must not read as an empty, quiet table.
    expect(shapeDailyStatusReport({ start: "2026-09-01", end: "2026-09-07" })).toBeNull();
    expect(
      shapeDailyStatusReport({ ...PAYLOAD, start: undefined }),
    ).toBeNull();
  });

  it("pins the page size the table's pager assumes", () => {
    expect(DAILY_STATUS_PAGE_SIZE).toBe(50);
  });
});

describe("rowForRep", () => {
  const report = shapeDailyStatusReport(PAYLOAD)!;

  it("returns the rep's own row when the RPC listed them", () => {
    expect(rowForRep(report, "rep-b")).toMatchObject({
      id: "rep-b",
      name: "Bilal",
      recorded: 2,
    });
  });

  it("returns a zeroed row for a rep the RPC did not list", () => {
    expect(rowForRep(report, "rep-c")).toEqual({
      id: "rep-c",
      name: "",
      ...EMPTY_DAILY_STATUS_COUNTS,
      days: [],
    });
  });
});
