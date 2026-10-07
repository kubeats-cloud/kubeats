import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildActivityGrid,
  SORT_BY_REP,
  SORT_BY_TOTAL,
  TOTAL_COLUMN_LABEL,
  type GridInput,
} from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import { cohortHref } from "@/lib/validation/pipeline-report";

/**
 * The "customise this table" picker (change-doc item 7).
 *
 * The picker's own interaction — the popover, the checkboxes, localStorage —
 * is a browser behaviour and is verified live rather than here. What this file
 * pins is the part that can go silently wrong: which columns a grid produces
 * once some are folded away, that the folding never reaches the .xlsx, and
 * that the storage shape makes a NEW column visible rather than hidden.
 */

const rep = (name: string, statuses: Record<string, number> = {}) => ({
  id: `id-${name}`,
  name,
  activities: { ...ZERO_COUNTS },
  statuses,
});

const COLUMNS = {
  closed: [
    { status: "Will not come", label: "Will not come", retired: false },
    { status: "Admitted", label: "Admitted", retired: false },
  ],
  open: [
    { status: "Session scheduled", label: "Session scheduled", retired: false },
    { status: "First meeting done", label: "First meeting done", retired: false },
  ],
};

const input = (over: Partial<GridInput> = {}): GridInput => ({
  reps: [
    rep("Asha", { "Will not come": 1, Admitted: 2, "Session scheduled": 3 }),
    rep("Bimal", { Admitted: 4, "First meeting done": 5 }),
  ],
  columns: COLUMNS,
  ...over,
});

describe("the column descriptor the picker is built from", () => {
  it("names every column, in the order the rows carry them", () => {
    const grid = buildActivityGrid(input());
    // One descriptor per cell of the label row, column A included.
    expect(grid.columns).toHaveLength(grid.rows[1].length);
    expect(grid.columns[0].key).toBe(SORT_BY_REP);
    expect(grid.columns.at(-1)?.key).toBe(SORT_BY_TOTAL);
    expect(grid.columns.at(-1)?.label).toBe(TOTAL_COLUMN_LABEL);
  });

  /**
   * ⚠ NAMESPACED, because an activity and a status can share a label —
   * "Admission" is already both — and a preference that confused the two would
   * fold away the wrong column.
   */
  it("namespaces activity keys apart from status keys", () => {
    const grid = buildActivityGrid(input({ showActivities: true }));
    const keys = grid.columns.map((c) => c.key);
    expect(keys.some((k) => k.startsWith("activity:"))).toBe(true);
    expect(keys).toContain("status:Admitted");
    expect(keys).not.toContain("Admitted");
  });

  /** The status KEY, never the label — a retired status renders as "X (retired)". */
  it("keys a status on the status, so retiring it does not unhide it", () => {
    const grid = buildActivityGrid(
      input({
        columns: {
          closed: [{ status: "Admitted", label: "Admitted (retired)", retired: true }],
          open: [],
        },
      }),
    );
    expect(grid.columns.map((c) => c.key)).toContain("status:Admitted");
  });

  /**
   * Column A and TOTAL carry no band, which is how the picker knows not to
   * offer them: a table of counts belonging to nobody is not a table, and a
   * row total hidden while its own cells are on screen is a worse reading.
   */
  it("marks the two unfoldable columns with no band", () => {
    const grid = buildActivityGrid(input());
    const unbanded = grid.columns.filter((c) => c.band === null).map((c) => c.key);
    expect(unbanded).toEqual([SORT_BY_REP, SORT_BY_TOTAL]);
  });
});

describe("hiding a column narrows the whole grid, not just the cells", () => {
  /**
   * ⚠ THE FAILURE THIS EXISTS TO PREVENT. The bands, the merges, the sort keys
   * and both totals are all derived from the same column lists. Hide a column
   * anywhere downstream and the band header above it keeps its original
   * `colSpan`, so every column to its right slides out from under its own
   * heading — a report that looks fine and is wrong.
   */
  it("keeps the band header's colSpan in step with the columns it covers", () => {
    const full = buildActivityGrid(input());
    const narrowed = buildActivityGrid(
      input({ hiddenColumns: ["status:Admitted"] }),
    );

    // One fewer column everywhere, in step.
    expect(narrowed.rows[1]).toHaveLength(full.rows[1].length - 1);
    expect(narrowed.columns).toHaveLength(full.columns.length - 1);
    expect(narrowed.sortKeys).toHaveLength(full.sortKeys.length - 1);
    for (const row of narrowed.rows) {
      expect(row).toHaveLength(narrowed.rows[1].length);
    }

    /*
     * And the band headers still cover the table exactly once.
     *
     * THE SUM OF THE SPANS IS THE WIDTH. Column A's merge is a rowSpan of 2
     * over a single column, so it contributes 1; every other row-0 merge is a
     * band spanning its own labels. If a column were dropped from the rows
     * without its band being narrowed, this total would exceed the width — and
     * that is precisely the misalignment that makes a report look right and be
     * wrong.
     */
    const spans = new Map<number, number>();
    for (const merge of narrowed.merges) {
      if (merge.row === 0) spans.set(merge.col, merge.colSpan);
    }
    const covered = [...spans.values()].reduce((sum, span) => sum + span, 0);
    expect(covered).toBe(narrowed.rows[1].length);
    // The same table, one column narrower than before.
    expect(covered).toBe(full.rows[1].length - 1);
  });

  it("drops a whole band when its every column is hidden", () => {
    const narrowed = buildActivityGrid(
      input({
        hiddenColumns: ["status:Will not come", "status:Admitted"],
      }),
    );
    const labels = narrowed.rows[0].map((v) => (v === null ? "" : String(v)));
    expect(labels.join(" ")).not.toContain("CLOSED");
    // The surviving band is untouched.
    expect(narrowed.columns.map((c) => c.key)).toContain("status:Session scheduled");
  });

  /**
   * The row total counts what is SHOWN. A figure that included columns the
   * reader cannot see would be a sum of something else, and this table's whole
   * contract is that a row total equals the cells beside it.
   */
  it("recomputes the totals over the surviving columns", () => {
    const full = buildActivityGrid(input());
    const narrowed = buildActivityGrid(
      input({ hiddenColumns: ["status:Admitted"] }),
    );
    // Asha: 1 + 2 + 3 = 6 with everything; 1 + 3 = 4 without Admitted.
    expect(full.totals?.perRow[0]).toBe(6);
    expect(narrowed.totals?.perRow[0]).toBe(4);
    expect(narrowed.totals?.grand).toBe(
      (narrowed.totals?.perRow ?? []).reduce((a, b) => a + b, 0),
    );
  });

  /** An absent or empty set must cost nothing at all. */
  it("is byte-for-byte the old grid when nothing is hidden", () => {
    const none = buildActivityGrid(input({ hiddenColumns: [] }));
    const absent = buildActivityGrid(input());
    expect(JSON.stringify(none)).toBe(JSON.stringify(absent));
  });

  /** A key nobody declared is simply not found — never an empty grid. */
  it("ignores a key that matches no column", () => {
    const narrowed = buildActivityGrid(
      input({ hiddenColumns: ["status:Nonexistent", "nonsense"] }),
    );
    expect(JSON.stringify(narrowed)).toBe(JSON.stringify(buildActivityGrid(input())));
  });
});

/* ------------------------------------------------------------------ */

describe("the picker never reaches the export, or the query", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

  /**
   * ⚠ THE GUARD THAT MATTERS MOST IN THIS FILE.
   *
   * The .xlsx is the client's own template, with formulas and pivots written
   * against column positions. One reader folding a column away on screen must
   * never reshape it — so the export path must not mention the flag at all.
   * The byte-identity test in activity-export/activity-grid-bands is the other
   * half of this and is unchanged by the feature.
   */
  it("never passes hiddenColumns from the export path", () => {
    const sheet = read("src/lib/exports/activity-export.ts");
    expect(sheet).not.toContain("hiddenColumns");
  });

  /**
   * Display only. A hidden column is still selected, still returned under the
   * same RLS, and still in the row the browser already holds — the picker is a
   * fold, not a filter. If it ever reached a query it would become a
   * permission, and the permission would be the browser's.
   */
  it("keeps the storage layer out of every data module", () => {
    for (const path of [
      "src/lib/admin-workspace.ts",
      "src/lib/institutes.ts",
      "src/lib/institute-status-report.ts",
      "src/lib/exports/activity-export.ts",
    ]) {
      expect(read(path), path).not.toContain("table-view");
    }
  });

  /**
   * ⚠ WHAT IS STORED IS WHAT IS HIDDEN, NEVER WHAT IS SHOWN.
   *
   * Columns get added — the status bands come from a vocabulary an admin
   * extends from Settings. Store the shown set and a new column is absent from
   * every stored list, so it is invisible to everybody who ever opened the
   * picker, for ever, with nothing on screen to say so. This is the assertion
   * that stops that being "simplified" into the other shape.
   */
  it("stores the hidden set, so a new column is shown by default", () => {
    const store = read("src/lib/table-view.ts");
    expect(store).toContain("shows: (key: string) => !hidden.has(key)");
    // Written only when something IS hidden; the default leaves no key behind.
    expect(store).toContain("removeItem");
  });

  /** Every access wrapped — localStorage throws outright in some browsers. */
  it("wraps every storage access", () => {
    const store = read("src/lib/table-view.ts");
    const accesses = store.match(/window\.localStorage/g) ?? [];
    expect(accesses.length).toBeGreaterThan(0);
    expect((store.match(/catch\s*{/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  /**
   * useSyncExternalStore, not useState + useEffect. The tables are
   * server-rendered: reading storage during render is a hydration mismatch, and
   * dates.ts records what #418 cost this app once already.
   */
  it("reads storage through useSyncExternalStore with a server snapshot", () => {
    const store = read("src/lib/table-view.ts");
    expect(store).toContain("useSyncExternalStore");
    expect(store).toContain("getServerSnapshot");
  });

  /** The "+" must say what it does; a bare glyph announces as "plus button". */
  it("labels the trigger for a screen reader", () => {
    const picker = read("src/components/ui/view-picker.tsx");
    expect(picker).toContain("aria-label");
    expect(picker).toContain("PopoverTrigger");
  });
});

/* ------------------------------------------------------------------ */

describe("cohortHref survived the move out of the server-only module", () => {
  it("still builds the link the pipeline report's cells have always drawn", () => {
    expect(cohortHref("abc", "Will not come")).toBe(
      "/institutes?owner=abc&status=Will+not+come",
    );
  });
});
