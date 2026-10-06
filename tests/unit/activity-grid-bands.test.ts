import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_COLUMNS,
  GROUP_HEADERS,
  TOTAL_COLUMN_LABEL,
  TOTAL_ROW_LABEL,
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
    // C1: TOTAL rides at the end, after the vocabulary.
    expect(labelRow.slice(1)).toEqual([...statusLabels, TOTAL_COLUMN_LABEL]);
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
    // Column 1 is the first status column, not "Meetings". The last cell is
    // the row total — the four status cells summed, and nothing else.
    expect(asha.slice(1)).toEqual([1, 0, 2, 0, 3]);

    const bhavin = body[1];
    expect(bhavin.slice(1)).toEqual([0, 3, 0, 1, 4]);
  });

  it("merges the two status bands, column A, and TOTAL", () => {
    expect(merges).toEqual([
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 0, col: 1, rowSpan: 1, colSpan: columns.closed.length },
      {
        row: 0,
        col: 1 + columns.closed.length,
        rowSpan: 1,
        colSpan: columns.open.length,
      },
      // One column wide, so `buildWorkbook` emits no <mergeCell> for it — but
      // the band loop still records it, and the table reads its colSpan here.
      {
        row: 0,
        col: 1 + columns.closed.length + columns.open.length,
        rowSpan: 1,
        colSpan: 1,
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
    // +1 for TOTAL, which the export takes by the same default.
    expect(labelRow).toHaveLength(
      1 + ACTIVITY_COLUMNS.length + statusLabels.length + 1,
    );
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

describe("the .xlsx, and the one deliberate re-baseline", () => {
  /**
   * RE-BASELINED ONCE, FOR C1, AND THE OLD HASH IS KEPT BELOW.
   *
   * `xlsx.ts` writes no timestamps, so the zip is deterministic and these
   * hashes are stable — a hash can only move if the export genuinely changes,
   * which is exactly what this block is here to catch.
   *
   * The template gains ONE COLUMN (TOTAL, at the far right after every band it
   * already had) and ONE ROW (the column sums, at the foot). Nothing else
   * moves: every existing column keeps its letter and every rep keeps its row
   * number, which is what the client's formulas and pivots are written
   * against. That claim is not asserted by hope — `PRE_TOTALS_SHA256` below is
   * the hash from before C1, and it is still produced exactly, by the same
   * fixture, under `showTotals: false`. If the totals work had disturbed a
   * single other byte, that test would fail.
   */
  const BASELINE_SHA256 =
    "df0316df208a1d80b90ba902715e52b3e0d57a7f58d588a2440dd58289f3216b";
  const BASELINE_BYTES = 7055;

  /** What this fixture produced before C1 added totals. Unchanged since. */
  const PRE_TOTALS_SHA256 =
    "968356ffb4479be18cb132e229938aa31a40d5267a5f3054ab666a15b9ef75a6";
  const PRE_TOTALS_BYTES = 6404;

  const bytes = buildWorkbook(activitySheet({ reps, columns }, "All reps"));

  it("matches the re-baselined export, totals included", () => {
    expect(bytes).toHaveLength(BASELINE_BYTES);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(BASELINE_SHA256);
  });

  /**
   * THE PROOF THAT C1 IS ADDITIVE.
   *
   * Turn the new field off and the bytes are the pre-C1 bytes, to the byte.
   * This is the only test in the suite that can distinguish "we added a column
   * and a row" from "we added a column and a row and nudged something else",
   * and it is why `showTotals` exists as a flag at all rather than being
   * unconditional.
   */
  it("reproduces the pre-totals export exactly under showTotals: false", () => {
    const before = buildWorkbook(
      activitySheet({ reps, columns, showTotals: false }, "All reps"),
    );
    expect(before).toHaveLength(PRE_TOTALS_BYTES);
    expect(createHash("sha256").update(before).digest("hex")).toBe(
      PRE_TOTALS_SHA256,
    );
  });

  it("is NOT what the screen would have produced", () => {
    const screen = buildWorkbook(
      activitySheet({ reps, columns, showActivities: false }, "All reps"),
    );
    expect(createHash("sha256").update(screen).digest("hex")).not.toBe(BASELINE_SHA256);
  });

  /**
   * The export path must never pass EITHER flag, or the defaults stop
   * protecting it. `showActivities` would silently delete six columns from the
   * client's spreadsheet; `showTotals` would silently delete the new ones.
   */
  it("is never handed showActivities or showTotals by the export path", () => {
    const text = readFileSync(
      fileURLToPath(
        new URL("../../src/lib/exports/activity-export.ts", import.meta.url),
      ),
      "utf8",
    );
    expect(text).not.toContain("showActivities");
    expect(text).not.toContain("showTotals");
  });

  /** The sheet carries the total row, bold, as its last row. */
  it("appends the total row to the sheet and bolds it", () => {
    const sheet = activitySheet({ reps, columns }, "All reps");
    const last = sheet.rows[sheet.rows.length - 1];
    expect(last[0]).toBe(TOTAL_ROW_LABEL);
    expect(sheet.boldRows).toEqual([0, 1, sheet.rows.length - 1]);
    // Every column gets a sum, the activity band included.
    expect(last).toHaveLength(sheet.rows[1].length);
    expect(last.slice(1).every((v) => typeof v === "number")).toBe(true);
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

describe("the NO STATUS band and cell links (report b)", () => {
  const unsetColumn = { status: "__none__", label: "No status yet", retired: false };

  /** Rows carrying an id and a null-status count, as report (b) builds them. */
  const owners: RepRow[] = [
    {
      id: "rep-1",
      name: "Asha Rao",
      activities: { ...ZERO_COUNTS },
      statuses: { "Session done": 2, "Session scheduled": 3, __none__: 1 },
    },
    {
      id: "__unassigned__",
      name: "Unassigned",
      activities: { ...ZERO_COUNTS },
      statuses: { __none__: 4 },
    },
  ];

  const grid = buildActivityGrid({
    reps: owners,
    columns,
    showActivities: false,
    unsetColumn,
    hrefFor: (rep, status) => `/institutes?owner=${rep.id}&status=${status}`,
  });

  it("adds NO STATUS as its own band, after the vocabulary", () => {
    const [groupRow, labelRow] = grid.rows;
    expect(groupRow).toContain(GROUP_HEADERS.unset);
    // Second from last now: TOTAL sits after it, and both are appended rather
    // than inserted, so the template's bands keep their positions.
    expect(labelRow[labelRow.length - 2]).toBe("No status yet");
    expect(labelRow[labelRow.length - 1]).toBe(TOTAL_COLUMN_LABEL);
  });

  it("counts null-status institutes in that column", () => {
    const [, , asha, unassigned] = grid.rows;
    // -2, because the row total is the last cell.
    expect(asha[asha.length - 2]).toBe(1);
    expect(unassigned[unassigned.length - 2]).toBe(4);
  });

  /**
   * THE RECONCILIATION REQUIREMENT: the cells ARE the registry.
   *
   * Read off `totals` rather than by re-summing the body, which is the point
   * of C1 — the figure the screen and the sheet both print is the figure this
   * asserts, not a second computation that happens to agree.
   */
  it("sums to the number of institutes behind it", () => {
    expect(grid.totals?.grand).toBe(2 + 3 + 1 + 4);
  });

  /** And both routes to the grand total agree. */
  it("reaches the same grand total by row and by column", () => {
    const totals = grid.totals!;
    const byRow = totals.perRow.reduce((n, v) => n + v, 0);
    // The status half of perColumn: everything except column A and the TOTAL
    // column itself, which is already a sum of the others.
    const byColumn = totals.perColumn
      .slice(1, -1)
      .reduce<number>((n, v) => n + (v ?? 0), 0);
    expect(byRow).toBe(totals.grand);
    expect(byColumn).toBe(totals.grand);
  });

  /** The TOTAL column's own column sum is the grand total, not a second one. */
  it("puts the grand total at the bottom right", () => {
    const totals = grid.totals!;
    expect(totals.perColumn[totals.perColumn.length - 1]).toBe(totals.grand);
  });

  it("gives each row the sum of its own status cells, excluding activities", () => {
    const totals = grid.totals!;
    // Asha: 2 + 3 + 1 null-status = 6. Unassigned: 4.
    expect(totals.perRow).toEqual([6, 4]);
    const [, , ...body] = grid.rows;
    body.forEach((row, r) => {
      expect(row[row.length - 1]).toBe(totals.perRow[r]);
    });
  });

  it("links every non-zero cell and no zero one", () => {
    const [, , ...body] = grid.rows;
    const [, , ...hrefs] = grid.hrefs;

    for (let r = 0; r < body.length; r += 1) {
      // The last column is the row total, which is never a door — asserted on
      // its own below rather than exempted quietly here.
      for (let c = 1; c < body[r].length - 1; c += 1) {
        const count = body[r][c];
        if (count === 0) expect(hrefs[r][c], `row ${r} col ${c}`).toBeNull();
        else expect(hrefs[r][c], `row ${r} col ${c}`).toBeTruthy();
      }
    }
  });

  /**
   * A TOTAL IS NEVER A DOOR, even a non-zero one.
   *
   * CountLink's rule is that a count and the page it opens must agree, and a
   * total spans several statuses — no single cohort page is the honest
   * destination. `hrefFor` is not consulted for it at all.
   */
  it("never links the row total, however large", () => {
    const [, , ...body] = grid.rows;
    const [, , ...hrefs] = grid.hrefs;
    body.forEach((row, r) => {
      expect(row[row.length - 1]).toBeGreaterThan(0);
      expect(hrefs[r][row.length - 1]).toBeNull();
    });
  });

  it("points each cell at that owner's institutes at that status", () => {
    const [, labelRow, ...body] = grid.rows;
    const [, , ...hrefs] = grid.hrefs;

    const col = labelRow.indexOf("Session scheduled");
    expect(body[0][col]).toBe(3);
    expect(hrefs[0][col]).toBe(
      "/institutes?owner=rep-1&status=Session scheduled",
    );

    // The Unassigned row keeps its sentinel, and so does the null column —
    // which is now second from last, behind TOTAL.
    const unset = labelRow.length - 2;
    expect(hrefs[1][unset]).toBe(
      "/institutes?owner=__unassigned__&status=__none__",
    );
  });

  /**
   * The column→sort-key map, emitted by the builder so the headers and the
   * columns under them cannot drift. Activity columns are deliberately not
   * sortable; see the field's own note.
   */
  it("names a sort key for every column but the activity band", () => {
    expect(grid.sortKeys[0]).toBe("rep");
    expect(grid.sortKeys[grid.sortKeys.length - 1]).toBe("total");
    expect(grid.sortKeys).toHaveLength(grid.rows[1].length);

    const withActivities = buildActivityGrid({ reps: owners, columns });
    // Six nulls, one per activity column, straight after column A.
    expect(withActivities.sortKeys.slice(1, 7)).toEqual([
      null, null, null, null, null, null,
    ]);
  });

  it("never links column A, which is the row's own name", () => {
    const [, , ...hrefs] = grid.hrefs;
    for (const row of hrefs) expect(row[0]).toBeNull();
  });

  it("keeps hrefs the same shape as rows, header rows included", () => {
    expect(grid.hrefs).toHaveLength(grid.rows.length);
    grid.rows.forEach((row, i) => expect(grid.hrefs[i]).toHaveLength(row.length));
    // The two header rows carry no links.
    expect(grid.hrefs[0].every((h) => h === null)).toBe(true);
    expect(grid.hrefs[1].every((h) => h === null)).toBe(true);
  });
});

describe("the activity report is untouched by all of it", () => {
  it("emits no NO STATUS band when no unsetColumn is given", () => {
    const { rows } = buildActivityGrid({ reps, columns });
    expect(rows[0]).not.toContain(GROUP_HEADERS.unset);
    expect(rows[1]).not.toContain("No status yet");
  });

  it("emits no links when no hrefFor is given", () => {
    const { hrefs } = buildActivityGrid({ reps, columns });
    expect(hrefs.every((row) => row.every((h) => h === null))).toBe(true);
  });

  /** And `showTotals: false` leaves no trace of C1 anywhere in the output. */
  it("emits no TOTAL band, column or totals under showTotals: false", () => {
    const grid = buildActivityGrid({ reps, columns, showTotals: false });
    expect(grid.rows[0]).not.toContain(GROUP_HEADERS.total);
    expect(grid.rows[1]).not.toContain(TOTAL_COLUMN_LABEL);
    expect(grid.totals).toBeNull();
    // And the sort keys stop at the last status column.
    expect(grid.sortKeys).not.toContain("total");
    expect(grid.sortKeys).toHaveLength(grid.rows[1].length);
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
