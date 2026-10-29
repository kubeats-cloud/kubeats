import { describe, expect, it } from "vitest";
import {
  buildCallActivitySheet,
  callActivityExportFilename,
  totalsRow,
} from "@/lib/exports/call-activity-grid";
import type { RepRow, StatusColumns } from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";

/**
 * The Call Activity Report's .xlsx sheet (Part 4) — PURE, like
 * `activity-grid-bands.test.ts` beside it. No database: `reps`/`columns`/
 * `totals` here are exactly what `shapeRpcPayload()` would hand the real
 * export builder, typed by hand.
 */

const columns: StatusColumns = {
  closed: [{ status: "Will not come", label: "Will not come", retired: false }],
  open: [{ status: "First meeting done", label: "First meeting done", retired: false }],
};

const reps: RepRow[] = [
  {
    id: "rep-1",
    name: "Asha Rao",
    activities: ZERO_COUNTS,
    statuses: { "First meeting done": 5 },
  },
  {
    id: "rep-2",
    name: "Bhavin Shah",
    activities: ZERO_COUNTS,
    statuses: { "Will not come": 3 },
  },
  {
    id: "rep-3",
    name: "Chetan Iyer",
    // A rep with nothing at all still gets a row — "every configured call
    // status present, even with zero" extends to a rep with no calls too.
    activities: ZERO_COUNTS,
    statuses: {},
  },
];

const totals = { byStatus: { "First meeting done": 5, "Will not come": 3 }, openTotal: 5, closedTotal: 3, total: 8 };

describe("buildCallActivitySheet — title rows", () => {
  it("the first three rows are the title, the date range and the filters, then a blank row", () => {
    const sheet = buildCallActivitySheet(reps, columns, totals, {
      from: "2026-10-01",
      to: "2026-10-20",
      repLabel: null,
      institute: null,
      status: null,
    });
    expect(sheet.rows[0]).toEqual(["Call Activity Report"]);
    expect(sheet.rows[1]).toEqual(["Date range: 2026-10-01 to 2026-10-20"]);
    expect(sheet.rows[2][0]).toContain("Representative: Everyone");
    expect(sheet.rows[2][0]).toContain("Institute contains: Any");
    expect(sheet.rows[2][0]).toContain("Call Status: Any status");
    expect(sheet.rows[3]).toEqual([null]);
  });

  it("names the applied filters in plain words when they are set", () => {
    const sheet = buildCallActivitySheet(reps, columns, totals, {
      from: "2026-10-01",
      to: "2026-10-20",
      repLabel: "Asha Rao",
      institute: "Greenfield",
      status: "Will not come",
    });
    expect(sheet.rows[2][0]).toContain("Representative: Asha Rao");
    expect(sheet.rows[2][0]).toContain('Institute contains: "Greenfield"');
    expect(sheet.rows[2][0]).toContain("Call Status: Will not come");
  });

  it("says 'All dates' is never invented — the caller always resolves a real range first", () => {
    // buildCallActivitySheet() takes a resolved {from, to}; the "no date
    // filter -> last 31 days" default is the EXPORT BUILDER's job
    // (call-activity-export.ts), not this pure function's. Asserted here so
    // a reader does not go looking for an "All dates" branch in this file.
    const sheet = buildCallActivitySheet(reps, columns, totals, {
      from: "2026-10-01",
      to: "2026-10-20",
      repLabel: null,
      institute: null,
      status: null,
    });
    expect(sheet.rows[1]).not.toContain("All dates");
  });
});

describe("buildCallActivitySheet — headings and body", () => {
  const sheet = buildCallActivitySheet(reps, columns, totals, {
    from: "2026-10-01",
    to: "2026-10-20",
    repLabel: null,
    institute: null,
    status: null,
  });
  // Rows 0-3 are the title block; 4 and 5 are the two header rows.
  const groupRow = sheet.rows[4];
  const labelRow = sheet.rows[5];

  it("orders the headings: Representative, Closed status, Open status, then the three totals", () => {
    expect(labelRow).toEqual([
      null,
      "Will not come",
      "First meeting done",
      "Open total",
      "Closed total",
      "Total",
    ]);
    expect(groupRow[0]).toBe("Representative");
  });

  it("every configured status has a column, even a rep with zero calls", () => {
    const chetanRow = sheet.rows.find((r) => r[0] === "Chetan Iyer");
    expect(chetanRow).toEqual(["Chetan Iyer", 0, 0, 0, 0, 0]);
  });

  it("sheet name is exactly 'Call Activity'", () => {
    expect(sheet.name).toBe("Call Activity");
  });
});

describe("buildCallActivitySheet — the totals row", () => {
  it("is the sum of every body row, and uses the server's full-population totals, not a page's worth", () => {
    const sheet = buildCallActivitySheet(reps, columns, totals, {
      from: "2026-10-01",
      to: "2026-10-20",
      repLabel: null,
      institute: null,
      status: null,
    });
    const last = sheet.rows[sheet.rows.length - 1];
    // name, closed, open, openTotal, closedTotal, total
    expect(last).toEqual(["All reps", 3, 5, 5, 3, 8]);

    // Cross-checked against a hand reduction over the body rows actually
    // rendered — not just against the `totals` argument restated.
    const bodyStart = 6;
    const bodyEnd = sheet.rows.length - 1;
    const bodyRows = sheet.rows.slice(bodyStart, bodyEnd);
    const sumAt = (col: number) =>
      bodyRows.reduce((sum, row) => sum + (typeof row[col] === "number" ? (row[col] as number) : 0), 0);
    expect(sumAt(1)).toBe(last[1]); // closed status column
    expect(sumAt(2)).toBe(last[2]); // open status column
    expect(sumAt(5)).toBe(last[5]); // Total column
  });

  it("totals come from the RPC's full-population object, not a recount of only the exported rows", () => {
    // A totals object that does NOT match a naive sum of `reps` — proves the
    // sheet trusts the passed-in totals rather than recomputing them.
    const widerTotals = { byStatus: { "First meeting done": 50, "Will not come": 30 }, openTotal: 50, closedTotal: 30, total: 80 };
    const sheet = buildCallActivitySheet(reps, columns, widerTotals, {
      from: "2026-10-01", to: "2026-10-20", repLabel: null, institute: null, status: null,
    });
    const last = sheet.rows[sheet.rows.length - 1];
    expect(last).toEqual(["All reps", 30, 50, 50, 30, 80]);
  });
});

describe("totalsRow", () => {
  it("builds a single RepRow whose statuses are the server's full-population sums", () => {
    const row = totalsRow(totals);
    expect(row.statuses).toEqual(totals.byStatus);
    expect(row.name).toBe("");
  });
});

describe("callActivityExportFilename", () => {
  it("is its own name, never activity-export.ts's kubeats-activity- prefix", () => {
    const name = callActivityExportFilename("2026-10-01", "2026-10-20", null);
    expect(name).toBe("kubeats-call-activity-all-2026-10-01-to-2026-10-20.xlsx");
    expect(name).not.toContain("kubeats-activity-");
  });

  it("includes a sanitised rep name when one is given", () => {
    const name = callActivityExportFilename("2026-10-01", "2026-10-20", "Asha Rao");
    expect(name).toBe("kubeats-call-activity-Asha-Rao-2026-10-01-to-2026-10-20.xlsx");
  });
});
