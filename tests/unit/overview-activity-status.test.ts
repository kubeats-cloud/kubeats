import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_COLUMNS,
  ACTIVITY_STATUS_BANDS,
  OTHER_INACTIVE_STATUS,
  OTHER_INACTIVE_STATUS_LABEL,
  TOTAL_COLUMN_LABEL,
  TOTAL_ROW_LABEL,
  activitySheet,
  buildActivityGrid,
  type RepRow,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import {
  buildInstituteActivityRows,
  countActivityOpenClosed,
  type CountableVisit,
} from "@/lib/institute-activity-counts";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import type { StatusCatalogue, StatusRow } from "@/lib/validation/institute";

/**
 * The Overview's 12 Open/Closed columns.
 *
 * The numbers are the institute activity report's, by construction:
 * `countActivityOpenClosed()` is the function `buildInstituteActivityRows()`
 * now calls. What this file guards is the part that could drift silently — the
 * column set and order, the TOTAL not double-counting two views of one visit,
 * and the workbook carrying the same layout as the table.
 */

function rowof(
  status: string,
  category: StatusRow["category"],
  sortOrder: number,
): StatusRow {
  return {
    status,
    category,
    tone: "neutral",
    sortOrder,
    isActive: true,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
  };
}

const catalogue: StatusCatalogue = [
  rowof("Session done", "closed", 10),
  rowof("Will not come", "closed", 20),
  rowof("Session scheduled", "open", 30),
  rowof("First meeting done", "open", 40),
];

const columns: StatusColumns = {
  closed: [
    { status: "Session done", label: "Session done", retired: false },
    { status: "Will not come", label: "Will not come", retired: false },
  ],
  open: [
    { status: "Session scheduled", label: "Session scheduled", retired: false },
    { status: "First meeting done", label: "First meeting done", retired: false },
  ],
};

const ALL_STATUS_KEYS = [
  ...columns.closed,
  ...columns.open,
].map((column) => `status:${column.status}`);

const visit = (
  activity: string,
  lifecycle: string | null,
  status: string | null,
): CountableVisit => ({
  institute_id: "inst-1",
  activity,
  lifecycle_status: lifecycle,
  status_set_to: status,
});

const visits: CountableVisit[] = [
  // Meetings are visit rows in this arithmetic, exactly as they are for the
  // institute report. The plan-sourced Meetings column is a different figure.
  visit("meeting", null, "First meeting done"),
  visit("meeting", null, "Session scheduled"),
  visit("session", "Set", "Session scheduled"),
  visit("session", "Done", "Session done"),
  visit("campus_visit", "Done", "Session done"),
  visit("olympiad", null, "Will not come"),
  // Skips, both deliberate: one cannot reconcile into a bucket, one has a
  // status the catalogue does not know.
  visit("session", null, "Session done"),
  visit("meeting", null, "Not a status"),
];

const reps: RepRow[] = [
  {
    id: "rep-1",
    name: "Asha",
    activities: { ...ZERO_COUNTS },
    statuses: {
      "Session done": 2,
      "Session scheduled": 2,
      "First meeting done": 1,
      "Will not come": 1,
    },
    activityStatuses: countActivityOpenClosed(visits, catalogue),
  },
  {
    id: "rep-2",
    name: "Bhavin",
    activities: { ...ZERO_COUNTS },
    statuses: {},
    activityStatuses: countActivityOpenClosed([], catalogue),
  },
];

describe("the counting is the institute report's, reused", () => {
  it("splits each visit by activity bucket and catalogue category", () => {
    const counts = countActivityOpenClosed(visits, catalogue);
    // Both meetings carry an OPEN status ("First meeting done" and "Session
    // scheduled"), so the split is 2/0 rather than one each.
    expect(counts.meeting).toEqual({ open: 2, closed: 0 });
    expect(counts.session).toEqual({ open: 1, closed: 1 });
    expect(counts.campus_visit).toEqual({ open: 0, closed: 1 });
    expect(counts.olympiad).toEqual({ open: 0, closed: 1 });
    expect(counts.application).toEqual({ open: 0, closed: 0 });
    expect(counts.admission).toEqual({ open: 0, closed: 0 });
  });

  it("matches buildInstituteActivityRows cell for cell", () => {
    /*
     * Everything except the session with no lifecycle. That row is
     * MISBUCKETED as far as `reconcileActivityCounts` is concerned, and a
     * flagged institute deliberately reports zeros rather than a split it
     * cannot reconcile — asserted separately below. The statusless meeting
     * stays in: it reconciles fine, and both paths skip it for its unknown
     * status.
     */
    const reconcilable = visits.filter(
      (row) => !(row.activity === "session" && row.lifecycle_status === null),
    );
    const { rows, reconciliationFailures } = buildInstituteActivityRows({
      institutes: [{ id: "inst-1", name: "One" }],
      visits: reconcilable,
      meetingsCompletedByInstitute: new Map(),
      followUpsOwnedByInstitute: new Map(),
      followUpsPendingByInstitute: new Map(),
      presenceByInstitute: new Map(),
      catalogue,
    });
    expect(reconciliationFailures).toEqual([]);
    expect(rows[0].byActivity).toEqual(
      countActivityOpenClosed(reconcilable, catalogue),
    );
  });

  it("skips a visit it cannot bucket or categorise", () => {
    const counts = countActivityOpenClosed(
      [visit("session", null, "Session done"), visit("meeting", null, "Ghost")],
      catalogue,
    );
    for (const activity of Object.values(counts)) {
      expect(activity).toEqual({ open: 0, closed: 0 });
    }
  });
});

describe("the 12 columns", () => {
  const input = {
    reps,
    columns,
    showActivities: false,
    showActivityStatuses: true,
    hiddenColumns: ALL_STATUS_KEYS,
  };

  const grid = buildActivityGrid(input);

  it("uses the client's six activity labels, in order", () => {
    expect(ACTIVITY_STATUS_BANDS.map((band) => band.label)).toEqual(
      ACTIVITY_COLUMNS.map((column) => column.label),
    );
  });

  it("puts one Open and one Closed column under each activity", () => {
    const [, labelRow] = grid.rows;
    expect(labelRow.slice(1, -1)).toEqual(
      ACTIVITY_STATUS_BANDS.flatMap(() => ["Open", "Closed"]),
    );
    // The row total is still last.
    expect(labelRow[labelRow.length - 1]).toBe(TOTAL_COLUMN_LABEL);
  });

  it("bands each pair under its activity, after the status vocabulary", () => {
    const [groupRow] = grid.rows;
    for (const band of ACTIVITY_STATUS_BANDS) {
      expect(groupRow).toContain(band.label);
    }
    // No DASHBOARD ACTIVITIES band on the Overview (showActivities: false).
    expect(groupRow).not.toContain("DASHBOARD ACTIVITIES");
  });

  it("carries the counted cells and a zero row for a quiet rep", () => {
    const [, , asha, bhavin] = grid.rows;
    // Meeting O/C, Session O/C, Campus O/C, Olympiad O/C, App O/C, Admission O/C
    expect(asha.slice(1, 13)).toEqual([2, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0]);
    expect(bhavin.slice(1, 13)).toEqual(Array.from({ length: 12 }, () => 0));
  });

  it("offers the 18 per-status columns in the picker, not the table", () => {
    const keys = grid.columns.map((column) => column.key);
    for (const key of ALL_STATUS_KEYS) {
      expect(keys).not.toContain(key);
    }
    // They exist in the FULL grid, which is what the picker is built from.
    const full = buildActivityGrid({
      reps,
      columns,
      showActivities: false,
      showActivityStatuses: true,
    });
    const fullKeys = full.columns.map((column) => column.key);
    for (const key of ALL_STATUS_KEYS) expect(fullKeys).toContain(key);
    for (const band of ACTIVITY_STATUS_BANDS) {
      expect(fullKeys).toContain(`activity-status:${band.activity}:open`);
      expect(fullKeys).toContain(`activity-status:${band.activity}:closed`);
    }
  });

  it("names each of the 12 distinctly, though six labels repeat", () => {
    const keys = grid.columns
      .map((column) => column.key)
      .filter((key) => key.startsWith("activity-status:"));
    expect(new Set(keys).size).toBe(12);
  });
});

describe("the totals add the parts once", () => {
  const input = {
    reps,
    columns,
    showActivities: false,
    showActivityStatuses: true,
    hiddenColumns: ALL_STATUS_KEYS,
  };
  const grid = buildActivityGrid(input);
  const totals = grid.totals!;

  it("makes each row total the sum of its own 12 cells", () => {
    const [, , ...body] = grid.rows;
    const ashaTotal = body[0][body[0].length - 1] as number;
    const parts = (body[0].slice(1, 13) as number[]).reduce((a, b) => a + b, 0);
    expect(ashaTotal).toBe(parts);
    expect(totals.perRow[0]).toBe(parts);
  });

  it("does not add the per-status view on top when both are visible", () => {
    const both = buildActivityGrid({
      reps,
      columns,
      showActivities: false,
      showActivityStatuses: true,
    });
    const [, , asha] = both.rows;
    // The statuses are visible here too, and still are not added twice.
    expect(asha[asha.length - 1]).toBe(totals.perRow[0]);
  });

  it("puts the sum of the 12 column totals at the bottom right", () => {
    const twelve = totals.perColumn.slice(1, 13);
    expect(twelve.reduce<number>((n, v) => n + (v ?? 0), 0)).toBe(totals.grand);
    // The TOTAL column's own sum is the same figure, not a second one.
    expect(totals.perColumn[totals.perColumn.length - 1]).toBe(totals.grand);
  });

  it("falls back to the status cells if every one of the 12 is folded away", () => {
    const withoutTwelve = buildActivityGrid({
      reps,
      columns,
      showActivities: false,
      showActivityStatuses: true,
      hiddenColumns: ACTIVITY_STATUS_BANDS.flatMap((band) => [
        `activity-status:${band.activity}:open`,
        `activity-status:${band.activity}:closed`,
      ]),
    });
    // Asha's four status cells: 2 + 2 + 1 + 1.
    expect(withoutTwelve.totals?.perRow[0]).toBe(6);
  });
});

describe("the reconciliation bucket", () => {
  const otherColumn = {
    status: OTHER_INACTIVE_STATUS,
    label: OTHER_INACTIVE_STATUS_LABEL,
    retired: false,
  };
  const reconciled: RepRow[] = [
    {
      name: "Asha",
      activities: { ...ZERO_COUNTS },
      statuses: {
        "First meeting done": 6,
        [OTHER_INACTIVE_STATUS]: 2,
      },
      activityStatuses: {
        meeting: { open: 6, closed: 0 },
        session: { open: 0, closed: 0 },
        campus_visit: { open: 0, closed: 0 },
        olympiad: { open: 0, closed: 0 },
        application: { open: 0, closed: 0 },
        admission: { open: 0, closed: 0 },
      },
    },
  ];

  it("makes the 12-column view plus Other equal Total visits", () => {
    const grid = buildActivityGrid({
      reps: reconciled,
      columns: { closed: [], open: [] },
      showActivities: false,
      showActivityStatuses: true,
      unsetColumn: otherColumn,
    });
    const row = grid.rows[2];
    expect(row[1]).toBe(2);
    expect(row[row.length - 1]).toBe(8);
    expect((row.slice(1, -1) as number[]).reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("makes the per-status view plus Other equal the same total", () => {
    const grid = buildActivityGrid({
      reps: reconciled,
      columns: {
        closed: [],
        open: [{ status: "First meeting done", label: "First meeting done", retired: false }],
      },
      showActivities: false,
      showActivityStatuses: true,
      unsetColumn: otherColumn,
      hiddenColumns: ACTIVITY_STATUS_BANDS.flatMap((band) => [
        `activity-status:${band.activity}:open`,
        `activity-status:${band.activity}:closed`,
      ]),
    });
    const row = grid.rows[2];
    expect(row.slice(1)).toEqual([6, 2, 8]);
  });

  it("carries the same Other column into the Overview workbook", () => {
    const sheet = activitySheet({
      reps: reconciled,
      columns: { closed: [], open: [] },
      showActivities: false,
      showActivityStatuses: true,
      unsetColumn: otherColumn,
    }, "All reps");
    expect(sheet.rows[0]).toContain("NO STATUS");
    expect(sheet.rows[1]).toContain(OTHER_INACTIVE_STATUS_LABEL);
    expect(sheet.rows[2][sheet.rows[2].length - 1]).toBe(8);
  });
});

describe("the workbook matches the table for the same filter", () => {
  const tableInput = {
    reps,
    columns,
    showActivities: false,
    showActivityStatuses: true,
    hiddenColumns: ALL_STATUS_KEYS,
  };
  /*
   * The export reaches the same layout the other way: empty status bands
   * rather than folded-away ones. If those two produce different sheets, the
   * Overview's download and its table have drifted.
   */
  const exportInput = {
    reps,
    columns: { closed: [], open: [] } as StatusColumns,
    showActivities: false,
    showActivityStatuses: true,
  };

  it("produces the same rows from the screen path and the export path", () => {
    expect(activitySheet(exportInput, "All reps")).toEqual(
      activitySheet(tableInput, "All reps"),
    );
  });

  it("ends in a total row that sums all 12 columns", () => {
    const sheet = activitySheet(exportInput, "All reps");
    const last = sheet.rows[sheet.rows.length - 1];
    expect(last[0]).toBe(TOTAL_ROW_LABEL);
    expect(last).toHaveLength(1 + 12 + 1);
    expect(last.slice(1).every((value) => typeof value === "number")).toBe(true);
    expect(last[last.length - 1]).toBe(
      (last.slice(1, 13) as number[]).reduce((a, b) => a + b, 0),
    );
  });
});

describe("only the Overview asks for it", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

  it("wires the grid and the download on the Overview", () => {
    const page = read("src/app/(app)/page.tsx");
    expect((page.match(/showActivityStatuses/g) ?? []).length).toBe(2);
    expect(page).toContain("showActivities={false}");
  });

  it("puts the layout in the download's URL, and validates it server-side", () => {
    expect(read("src/components/report/export-excel.tsx")).toContain(
      'params.set("layout", "activity-status")',
    );
    const route = read("src/app/api/export/activity/route.ts");
    expect(route).toContain('params.get("layout")');
    expect(route).toContain('layout !== "activity-status"');
    expect(route).toContain("layout === \"activity-status\" ? { layout } : {}");
  });

  it("reaches the workbook through the named layout, never a flag default", () => {
    const model = read("src/lib/exports/activity-export.ts");
    expect(model).toContain('options.layout === "activity-status"');
    expect(model).toContain("showActivityStatuses: true");
    expect(model).toContain("showActivities: false");
    expect(model).toContain("unsetColumn: result.model.otherStatusColumn");
  });

  it("leaves the Team report's grid and download unchanged", () => {
    const team = read("src/app/(app)/team/report/page.tsx");
    expect(team).not.toContain("showActivityStatuses");
    expect(team).toContain("<ExportExcel start={start} end={end}");
  });
});
