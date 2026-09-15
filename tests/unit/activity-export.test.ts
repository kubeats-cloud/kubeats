import { describe, expect, it } from "vitest";

import {
  ACTIVITY_COLUMNS,
  GROUP_HEADERS,
  RETIRED_SUFFIX,
  activityCount,
  buildActivityGrid,
  metricsMissingFromExport,
  statusColumnsFor,
  statusesWithoutColumns,
  type RepRow,
} from "@/lib/exports/activity-grid";
import { METRICS, ZERO_COUNTS, tallyVisitMetrics } from "@/lib/validation/weekly";
import type { StatusCatalogue } from "@/lib/validation/institute";
import { buildWorkbook, cellRef, columnName } from "@/lib/xlsx";

/**
 * The export's shape and arithmetic, without a database.
 *
 * Everything the client specified that could be got wrong silently lives here:
 * the eight-into-six fold, the dynamically generated status columns, and the
 * two-row grouped header. A wrong number in a spreadsheet is not an error
 * anyone sees — it is a number someone acts on — so these assert the layout
 * cell by cell rather than checking the file merely opens.
 */

const catalogue: StatusCatalogue = [
  row("Admitted", "closed", 10, true),
  row("Not interested", "closed", 20, true),
  row("Old closed reason", "closed", 15, false),
  row("First meeting done", "open", 30, true),
  row("Session scheduled", "open", 40, true),
  row("Retired open thing", "open", 35, false),
];

function row(
  status: string,
  category: "open" | "closed",
  sortOrder: number,
  isActive: boolean,
) {
  return {
    status,
    category,
    tone: "neutral" as const,
    sortOrder,
    isActive,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
  };
}

/* ------------------------------------------------------------------ */

describe("the six activity columns", () => {
  it("covers every metric Rule 7 counts", () => {
    // If a ninth metric is added, it must be given a column or deliberately
    // folded into one. Failing here is the point: the alternative is a metric
    // that is simply absent from the client's report and nobody notices.
    expect(metricsMissingFromExport()).toEqual([]);
  });

  it("folds the two lifecycle pairs, and only those", () => {
    expect(ACTIVITY_COLUMNS.map((c) => c.label)).toEqual([
      "Meetings",
      "Sessions",
      "Campus Visits",
      "Olympiad Registrations",
      "Applications",
      "Admissions",
    ]);
    const multi = ACTIVITY_COLUMNS.filter((c) => c.from.length > 1);
    expect(multi.map((c) => c.label)).toEqual(["Sessions", "Campus Visits"]);
  });

  it("adds Set and Done into one Sessions figure, matching tallyVisitMetrics", () => {
    // Exactly what the app counts, fed through the app's own tally.
    const counts = tallyVisitMetrics([
      { activity: "session", lifecycle_status: "Set" },
      { activity: "session", lifecycle_status: "Set" },
      { activity: "session", lifecycle_status: "Done" },
      { activity: "campus_visit", lifecycle_status: "Done" },
      { activity: "olympiad", lifecycle_status: null },
    ]);

    const by = (label: string) =>
      activityCount(counts, ACTIVITY_COLUMNS.find((c) => c.label === label)!);

    expect(counts.sessions_set).toBe(2);
    expect(counts.sessions_done).toBe(1);
    expect(by("Sessions")).toBe(3);
    expect(by("Campus Visits")).toBe(1);
    expect(by("Olympiad Registrations")).toBe(1);
    // Meetings never come from the visits log — Rule 7's split.
    expect(by("Meetings")).toBe(0);
  });

  it("counts every session visit exactly once", () => {
    // The fold is only exact because a session visit always carries a
    // lifecycle (0001's visits_lifecycle_matches_activity). Ten session rows
    // split any way must total ten.
    const visits = Array.from({ length: 10 }, (_, i) => ({
      activity: "session",
      lifecycle_status: i % 3 === 0 ? "Done" : "Set",
    }));
    const counts = tallyVisitMetrics(visits);
    expect(counts.sessions_set + counts.sessions_done).toBe(10);
  });
});

/* ------------------------------------------------------------------ */

describe("the status columns are generated, never hardcoded", () => {
  it("takes its columns from the catalogue, in sort order", () => {
    const columns = statusColumnsFor(catalogue, new Set());
    expect(columns.closed.map((c) => c.label)).toEqual([
      "Admitted",
      "Not interested",
    ]);
    expect(columns.open.map((c) => c.label)).toEqual([
      "First meeting done",
      "Session scheduled",
    ]);
  });

  it("gives a status an admin added its own column, with no code change", () => {
    const extended: StatusCatalogue = [
      ...catalogue,
      row("Awaiting principal", "open", 45, true),
    ];
    const columns = statusColumnsFor(extended, new Set());
    expect(columns.open.map((c) => c.status)).toContain("Awaiting principal");
    // In the OPEN band, not the closed one, and after the lower sort orders.
    expect(columns.closed.map((c) => c.status)).not.toContain("Awaiting principal");
    expect(columns.open.at(-1)?.status).toBe("Awaiting principal");
  });

  it("omits a retired status with no counts in the range", () => {
    const columns = statusColumnsFor(catalogue, new Set());
    const all = [...columns.closed, ...columns.open].map((c) => c.status);
    expect(all).not.toContain("Old closed reason");
    expect(all).not.toContain("Retired open thing");
  });

  it("includes a retired status that HAS counts, marked and at the end", () => {
    const columns = statusColumnsFor(
      catalogue,
      new Set(["Old closed reason", "Admitted"]),
    );
    // Appended, not interleaved at its sort_order of 15 — so the live columns
    // keep their positions from one export to the next.
    expect(columns.closed.map((c) => c.label)).toEqual([
      "Admitted",
      "Not interested",
      "Old closed reason" + RETIRED_SUFFIX,
    ]);
    expect(columns.closed.at(-1)?.retired).toBe(true);
    // The count key stays the raw status; only the header is decorated.
    expect(columns.closed.at(-1)?.status).toBe("Old closed reason");
  });

  it("reports a counted status that has no column at all", () => {
    const columns = statusColumnsFor(catalogue, new Set(["Ghost status"]));
    expect(statusesWithoutColumns(columns, new Set(["Ghost status"]))).toEqual([
      "Ghost status",
    ]);
    // The normal case is silent.
    expect(statusesWithoutColumns(columns, new Set(["Admitted"]))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("the grid matches the client's template", () => {
  const reps: RepRow[] = [
    {
      name: "Asha",
      activities: {
        ...ZERO_COUNTS,
        meetings: 4,
        sessions_set: 2,
        sessions_done: 1,
        admission: 5,
      },
      statuses: { Admitted: 3, "Session scheduled": 2 },
    },
    { name: "Bilal", activities: { ...ZERO_COUNTS }, statuses: {} },
  ];

  const columns = statusColumnsFor(catalogue, new Set());
  const { rows, merges } = buildActivityGrid({ reps, columns });

  it("has a two-row header, then one row per rep", () => {
    expect(rows).toHaveLength(2 + reps.length);
    expect(rows[0][0]).toBe(GROUP_HEADERS.representative);
    expect(rows[1][0]).toBeNull();
    expect(rows[2][0]).toBe("Asha");
    expect(rows[3][0]).toBe("Bilal");
  });

  it("puts each group header over the first cell of its own band", () => {
    // A: Representative. B..G: the six activities. H..: closed, then open.
    expect(rows[0][1]).toBe(GROUP_HEADERS.activities);
    expect(rows[0][7]).toBe(GROUP_HEADERS.closed);
    expect(rows[0][9]).toBe(GROUP_HEADERS.open);
    // Everything else on row 1 is blank — the merge covers it.
    expect(rows[0][2]).toBeNull();
    expect(rows[0][8]).toBeNull();
  });

  it("labels row 2 with the columns, in band order", () => {
    expect(rows[1].slice(1)).toEqual([
      "Meetings",
      "Sessions",
      "Campus Visits",
      "Olympiad Registrations",
      "Applications",
      "Admissions",
      "Admitted",
      "Not interested",
      "First meeting done",
      "Session scheduled",
    ]);
  });

  it("merges column A down, and each band across", () => {
    expect(merges).toEqual([
      { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
      { row: 0, col: 1, rowSpan: 1, colSpan: 6 },
      { row: 0, col: 7, rowSpan: 1, colSpan: 2 },
      { row: 0, col: 9, rowSpan: 1, colSpan: 2 },
    ]);
  });

  it("writes counts, with zero rather than a blank for nothing", () => {
    // Asha: meetings 4, sessions 2+1, campus 0, olympiad 0, apps 0, admissions 5
    expect(rows[2].slice(1, 7)).toEqual([4, 3, 0, 0, 0, 5]);
    expect(rows[2].slice(7)).toEqual([3, 0, 0, 2]);
    // A rep with no activity is a row of zeroes, not a missing row.
    expect(rows[3].slice(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("drops a band that has no columns rather than merging over nothing", () => {
    const noOpen = statusColumnsFor(
      catalogue.filter((r) => r.category === "closed"),
      new Set(),
    );
    const grid = buildActivityGrid({ reps, columns: noOpen });
    expect(grid.rows[0]).not.toContain(GROUP_HEADERS.open);
    expect(grid.merges).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */

describe("the contract the on-screen table depends on", () => {
  // ActivityGridTable renders THESE rows and derives its <th colSpan> from
  // THESE merges — that is what makes the screen and the .xlsx incapable of
  // disagreeing. The invariants below are what that rendering assumes; break
  // one and the table silently grows or loses a header cell while the
  // spreadsheet stays correct, which is the exact drift the shared builder
  // exists to prevent.
  const reps: RepRow[] = [
    { name: "Asha", activities: { ...ZERO_COUNTS }, statuses: {} },
  ];

  for (const [label, seen] of [
    ["no retired columns", new Set<string>()],
    ["a retired column", new Set(["Old closed reason"])],
  ] as const) {
    it(`every group header starts a merge, with ${label}`, () => {
      const columns = statusColumnsFor(catalogue, seen);
      const { rows, merges } = buildActivityGrid({ reps, columns });
      const starts = new Map(
        merges.filter((m) => m.row === 0).map((m) => [m.col, m.colSpan]),
      );

      rows[0].forEach((value, index) => {
        if (value !== null) {
          // A visible header must begin a merge, or the table would render it
          // one cell wide over a band several columns long.
          expect(starts.has(index), `header at ${index} starts a merge`).toBe(true);
        }
      });

      // The merges must tile row 1 exactly: no gap, no overlap, no overrun.
      let covered = 0;
      for (const [col, span] of [...starts].sort((a, b) => a[0] - b[0])) {
        expect(col).toBe(covered);
        covered += span;
      }
      expect(covered).toBe(rows[1].length);
      expect(covered).toBe(rows[0].length);
    });
  }

  it("keeps every body row the same width as the header", () => {
    const columns = statusColumnsFor(catalogue, new Set(["Old closed reason"]));
    const { rows } = buildActivityGrid({
      reps: [
        { name: "Asha", activities: { ...ZERO_COUNTS }, statuses: { Admitted: 1 } },
        { name: "Bilal", activities: { ...ZERO_COUNTS }, statuses: {} },
      ],
      columns,
    });
    const width = rows[1].length;
    for (const row of rows) expect(row).toHaveLength(width);
  });
});

/* ------------------------------------------------------------------ */

describe("the workbook writer", () => {
  it("names columns past Z", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(27)).toBe("AB");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
    expect(cellRef(0, 0)).toBe("A1");
    expect(cellRef(2, 27)).toBe("AB3");
  });

  it("produces a ZIP whose entries are the parts Excel requires", () => {
    const bytes = buildWorkbook({
      name: "All reps",
      rows: [["Representative", "Meetings"], [null, null], ["Asha", 4]],
      merges: [{ row: 0, col: 0, rowSpan: 2, colSpan: 1 }],
      boldRows: [0, 1],
    });

    // PK\x03\x04 — it is a ZIP at all.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // And ends with the end-of-central-directory record.
    const tail = bytes.slice(-22, -18);
    expect([...tail]).toEqual([0x50, 0x4b, 0x05, 0x06]);

    const text = new TextDecoder().decode(bytes);
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("<mergeCell ref=\"A1:A2\"/>");
    expect(text).toContain("Asha");
  });

  it("is byte-identical for the same input", () => {
    // Timestamps are pinned, so two exports of one range can be compared with a
    // checksum instead of by opening both.
    const spec = { name: "S", rows: [["a", 1]] };
    expect(buildWorkbook(spec)).toEqual(buildWorkbook(spec));
  });

  it("escapes XML and strips the bytes Excel refuses to open", () => {
    // The control byte is CONSTRUCTED, never typed: a literal one in a source
    // file does not survive being edited, which is how it got lost the first
    // time this test was written.
    const BEL = String.fromCharCode(7);
    const bytes = buildWorkbook({
      name: "S",
      rows: [["R&D <school>", "a" + BEL + "b"]],
    });
    // Scoped to the SHEET XML, not the whole file: a ZIP's CRC and size fields
    // are binary and will contain 0x07 sooner or later by chance, so asserting
    // over the container would fail for a reason that has nothing to do with
    // the escaping.
    const text = new TextDecoder().decode(bytes);
    const sheet = text.slice(text.indexOf("<worksheet"), text.indexOf("</worksheet>"));
    expect(sheet).toContain("R&amp;D &lt;school&gt;");
    expect(sheet).toContain("ab");
    expect(sheet).not.toContain(BEL);
  });

  it("keeps a sheet name Excel will accept", () => {
    const text = new TextDecoder().decode(
      buildWorkbook({ name: "a/b:c*".repeat(20), rows: [["x"]] }),
    );
    const name = text.match(/<sheet name="([^"]*)"/)?.[1] ?? "";
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[:\\/?*[\]]/);
  });
});

/* ------------------------------------------------------------------ */

describe("METRICS is still the shape this export assumes", () => {
  it("has exactly one plan-sourced metric, and it is meetings", () => {
    const plan = METRICS.filter((m) => m.source === "plan");
    expect(plan.map((m) => m.key)).toEqual(["meetings"]);
  });
});
