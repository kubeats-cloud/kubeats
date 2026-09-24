import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_COLUMNS,
  GROUP_HEADERS,
  activitySheet,
  buildActivityGrid,
  metricsMissingFromExport,
  statusColumnsFor,
  type RepRow,
} from "@/lib/exports/activity-grid";
import { METRICS, ZERO_COUNTS } from "@/lib/validation/weekly";
import type { StatusCatalogue, StatusRow } from "@/lib/validation/institute";
import { buildWorkbook } from "@/lib/xlsx";

/**
 * DASHBOARD ACTIVITIES comes off the SCREEN and stays in the SPREADSHEET.
 *
 * The client reads the status bands; the six activity counts repeated what
 * /team and /report already show and pushed the status columns off the right of
 * a phone. But the .xlsx is the client's OWN template, with formulas and pivots
 * written against fixed column positions — the reason TEMPLATE_COLUMN_ORDER
 * exists at all. Dropping six columns from it would silently break every one of
 * those formulas, and a spreadsheet that opens fine and computes the wrong
 * total is the worst possible failure available here.
 *
 * So `showActivities` DEFAULTS TO TRUE and only the two screen callers opt out.
 * That direction matters: a caller that forgets the flag gets the full grid.
 *
 * The header band and the body cells are built by SEPARATE loops, so the risk
 * this file mainly guards is not "the band is still there" but "the band went
 * and the cells did not" — which would shift every status count six columns out
 * of line with its own header and still render perfectly.
 */

/** Typed as StatusRow rather than cast, so a new field breaks this loudly. */
function st(
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
  st("Session done", "closed", 10),
  st("Will not come", "closed", 20),
  st("Session scheduled", "open", 30),
  st("First meeting done", "open", 40),
];

const seen = new Set([
  "Session done",
  "Will not come",
  "Session scheduled",
  "First meeting done",
]);

const reps: RepRow[] = [
  {
    name: "Asha Rao",
    activities: {
      ...ZERO_COUNTS,
      meetings: 4,
      sessions_set: 2,
      sessions_done: 1,
      olympiad: 3,
      application: 5,
      admission: 1,
    },
    statuses: { "Session done": 1, "Session scheduled": 2 },
  },
  {
    name: "Bhavin Shah",
    activities: {
      ...ZERO_COUNTS,
      meetings: 1,
      campus_visits_set: 2,
      campus_visits_done: 2,
    },
    statuses: { "Will not come": 3, "First meeting done": 1 },
  },
];

const columns = statusColumnsFor(catalogue, seen);
const statusLabels = [...columns.closed, ...columns.open].map((c) => c.label);

describe("the screen grid — showActivities: false", () => {
  const { rows, merges } = buildActivityGrid({ reps, columns, showActivities: false });
  const [groupRow, labelRow, ...body] = rows;

  it("omits the DASHBOARD ACTIVITIES band header entirely", () => {
    expect(groupRow).not.toContain(GROUP_HEADERS.activities);
  });

  it("omits every one of the six activity column labels", () => {
    for (const column of ACTIVITY_COLUMNS) {
      expect(labelRow).not.toContain(column.label);
    }
  });

  it("keeps Representative and both status bands", () => {
    expect(groupRow[0]).toBe(GROUP_HEADERS.representative);
    expect(groupRow).toContain(GROUP_HEADERS.closed);
    expect(groupRow).toContain(GROUP_HEADERS.open);
    expect(labelRow.slice(1)).toEqual(statusLabels);
  });

  /**
   * THE REAL REGRESSION RISK. Two loops build the header and the body; if only
   * one of them dropped the band, every status count would sit under the wrong
   * header and the report would still render.
   */
  it("keeps each status count under its own header", () => {
    expect(body).toHaveLength(2);
    for (const row of body) {
      expect(row).toHaveLength(labelRow.length);
    }

    const asha = body[0];
    expect(asha[0]).toBe("Asha Rao");
    // Column 1 is the first status column, not "Meetings".
    expect(asha.slice(1)).toEqual([1, 0, 2, 0]);

    const bhavin = body[1];
    expect(bhavin.slice(1)).toEqual([0, 3, 0, 1]);
  });

  it("merges only the two status bands, and column A", () => {
    expect(merges).toEqual([
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 0, col: 1, rowSpan: 1, colSpan: columns.closed.length },
      {
        row: 0,
        col: 1 + columns.closed.length,
        rowSpan: 1,
        colSpan: columns.open.length,
      },
    ]);
  });
});

describe("the export grid — the default", () => {
  it("keeps all six activity columns when the flag is absent", () => {
    const { rows } = buildActivityGrid({ reps, columns });
    const [groupRow, labelRow] = rows;

    expect(groupRow).toContain(GROUP_HEADERS.activities);
    expect(labelRow.slice(1, 1 + ACTIVITY_COLUMNS.length)).toEqual(
      ACTIVITY_COLUMNS.map((c) => c.label),
    );
    expect(labelRow).toHaveLength(1 + ACTIVITY_COLUMNS.length + statusLabels.length);
  });

  it("treats an explicit true as the default", () => {
    expect(buildActivityGrid({ reps, columns, showActivities: true })).toEqual(
      buildActivityGrid({ reps, columns }),
    );
  });

  it("still folds eight metrics into six columns", () => {
    const { rows } = buildActivityGrid({ reps, columns });
    const asha = rows[2];
    // Meetings 4 | Sessions 2+1 | Campus 0 | Olympiad 3 | Application 5 | Admission 1
    expect(asha.slice(1, 7)).toEqual([4, 3, 0, 3, 5, 1]);
  });
});

describe("the .xlsx is untouched", () => {
  /**
   * The bytes this fixture produced BEFORE `showActivities` existed, captured
   * from the pre-change tree. `xlsx.ts` writes no timestamps, so the zip is
   * deterministic and this hash is stable — it can only move if the export
   * genuinely changes, which is exactly what it is here to catch.
   */
  const BASELINE_SHA256 =
    "968356ffb4479be18cb132e229938aa31a40d5267a5f3054ab666a15b9ef75a6";
  const BASELINE_BYTES = 6404;

  const bytes = buildWorkbook(activitySheet({ reps, columns }, "All reps"));

  it("is byte-identical to the pre-change export", () => {
    expect(bytes).toHaveLength(BASELINE_BYTES);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(BASELINE_SHA256);
  });

  it("is NOT what the screen would have produced", () => {
    const screen = buildWorkbook(
      activitySheet({ reps, columns, showActivities: false }, "All reps"),
    );
    expect(createHash("sha256").update(screen).digest("hex")).not.toBe(BASELINE_SHA256);
  });

  /** The export path must never pass the flag, or the default stops protecting it. */
  it("is never handed showActivities by the export path", () => {
    const text = readFileSync(
      fileURLToPath(
        new URL("../../src/lib/exports/activity-export.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(text).not.toContain("showActivities");
  });
});

describe("what B must not have disturbed", () => {
  it("leaves every metric feeding a column", () => {
    expect(metricsMissingFromExport()).toEqual([]);
  });

  it("leaves the six activity columns and their folds in place", () => {
    expect(ACTIVITY_COLUMNS.map((c) => c.label)).toEqual([
      "Meetings",
      "Sessions",
      "Campus Visits",
      "Olympiad Registrations",
      "Applications",
      "Admissions",
    ]);
    expect(ACTIVITY_COLUMNS.flatMap((c) => [...c.from]).sort()).toEqual(
      METRICS.map((m) => m.key).sort(),
    );
  });

  it("leaves the template's status column order alone", () => {
    expect(statusLabels).toEqual([
      "Session done",
      "Will not come",
      "Session scheduled",
      "First meeting done",
    ]);
  });
});

describe("the two screen callers opt out", () => {
  const page = (path: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../src/app/${path}`, import.meta.url)),
      "utf8",
    );

  it("the admin Overview passes showActivities: false", () => {
    expect(page("(app)/page.tsx")).toContain("showActivities: false");
  });

  it("/team/report passes showActivities: false", () => {
    expect(page("(app)/team/report/page.tsx")).toContain("showActivities: false");
  });
});
