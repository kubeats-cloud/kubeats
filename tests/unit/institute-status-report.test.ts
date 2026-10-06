import { describe, expect, it } from "vitest";

import {
  NO_STATUS_KEY,
  UNASSIGNED_KEY,
  UNASSIGNED_LABEL,
  cohortHref,
  comparePipelineRows,
} from "@/lib/institute-status-report";
import {
  DEFAULT_PIPELINE_SORT,
  parsePipelineSort,
  pipelineHref,
  pipelineRangeSchema,
  rangeIsActive,
  sortHref,
} from "@/lib/validation/pipeline-report";
import {
  SORT_BY_REP,
  SORT_BY_TOTAL,
  type RepRow,
  type StatusColumn,
} from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";

/**
 * The pipeline report's own rules, without a database.
 *
 * THIS MODULE HAD NO TEST AT ALL before C1, and the reconciliation requirement
 * is what makes that a gap rather than an omission: the report now prints a
 * grand total beside a header figure and the two have to agree, so the rules
 * that decide which rows and columns exist are load-bearing arithmetic.
 *
 * What is covered here is everything that is a pure function of its inputs:
 * the sort comparator and its pinning rule, the range schema, and the URL
 * builders. What is NOT here is `getInstituteStatusModel()` itself — it reads
 * three tables through RLS, so proving the owner tally and the orphan guard
 * against a real database is the integration suite's job, and the
 * `institute_status_report` block there does it.
 */

const unsetColumn: StatusColumn = {
  status: NO_STATUS_KEY,
  label: "No status yet",
  retired: false,
};

function row(name: string, statuses: Record<string, number>, id = name): RepRow {
  return { id, name, activities: { ...ZERO_COUNTS }, statuses };
}

describe("the sort comparator", () => {
  const asha = row("Asha Rao", { "Session done": 1, "Session scheduled": 5 });
  const bhavin = row("Bhavin Shah", { "Session done": 4 });
  const chetna = row("Chetna Iyer", { "Session done": 4 });

  const asc = { key: SORT_BY_REP, dir: "asc" } as const;
  const desc = { key: SORT_BY_REP, dir: "desc" } as const;

  it("defaults to rep name A–Z, which is today's order", () => {
    expect(DEFAULT_PIPELINE_SORT).toEqual({ key: "rep", dir: "asc" });
    const sorted = [chetna, asha, bhavin].sort((a, b) =>
      comparePipelineRows(a, b, DEFAULT_PIPELINE_SORT, unsetColumn),
    );
    expect(sorted.map((r) => r.name)).toEqual([
      "Asha Rao",
      "Bhavin Shah",
      "Chetna Iyer",
    ]);
  });

  it("reverses the name order on desc", () => {
    const sorted = [asha, chetna, bhavin].sort((a, b) =>
      comparePipelineRows(a, b, desc, unsetColumn),
    );
    expect(sorted.map((r) => r.name)).toEqual([
      "Chetna Iyer",
      "Bhavin Shah",
      "Asha Rao",
    ]);
  });

  it("orders by a status column's own count, descending", () => {
    const sorted = [asha, bhavin, chetna].sort((a, b) =>
      comparePipelineRows(
        a,
        b,
        { key: "Session done", dir: "desc" },
        unsetColumn,
      ),
    );
    // Bhavin and Chetna both hold 4; Asha holds 1 and goes last.
    expect(sorted.map((r) => r.name)).toEqual([
      "Bhavin Shah",
      "Chetna Iyer",
      "Asha Rao",
    ]);
  });

  it("treats an absent status as zero rather than dropping the row", () => {
    const sorted = [asha, bhavin].sort((a, b) =>
      comparePipelineRows(
        a,
        b,
        { key: "Session scheduled", dir: "desc" },
        unsetColumn,
      ),
    );
    // Bhavin has no "Session scheduled" key at all.
    expect(sorted.map((r) => r.name)).toEqual(["Asha Rao", "Bhavin Shah"]);
  });

  /**
   * STABILITY. Without a tie-break two reps on the same count come back in
   * whatever order the array happened to be in, so two renders of identical
   * data could differ and a sorted link would not be a stable thing to send
   * somebody.
   */
  it("breaks every tie by name, ascending, in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const sorted = [chetna, bhavin].sort((a, b) =>
        comparePipelineRows(a, b, { key: "Session done", dir }, unsetColumn),
      );
      expect(sorted.map((r) => r.name)).toEqual(["Bhavin Shah", "Chetna Iyer"]);
    }
  });

  it("sorts by the row total, which is every status cell summed", () => {
    const sorted = [bhavin, asha].sort((a, b) =>
      comparePipelineRows(a, b, { key: SORT_BY_TOTAL, dir: "desc" }, unsetColumn),
    );
    // Asha 1 + 5 = 6 beats Bhavin's 4.
    expect(sorted.map((r) => r.name)).toEqual(["Asha Rao", "Bhavin Shah"]);
  });

  /**
   * The row total must count exactly the cells the grid draws. With no NO
   * STATUS band — which is what a date range produces — a null-status count
   * must not be folded in, or the TOTAL column would disagree with the cells
   * to its left and the grand total would not reconcile.
   */
  it("excludes the null-status count from the total when that band is gone", () => {
    const mixed = row("Dev Shah", { "Session done": 2, [NO_STATUS_KEY]: 7 });
    const withBand = comparePipelineRows(
      mixed,
      row("Zed", { "Session done": 9 }),
      { key: SORT_BY_TOTAL, dir: "desc" },
      unsetColumn,
    );
    // 2 + 7 = 9 ties with 9, so it falls through to the name.
    expect(withBand).toBeLessThan(0);

    const withoutBand = comparePipelineRows(
      mixed,
      row("Zed", { "Session done": 9 }),
      { key: SORT_BY_TOTAL, dir: "desc" },
      null,
    );
    // Now 2 against 9, so Zed wins outright and Dev sorts after.
    expect(withoutBand).toBeGreaterThan(0);
  });

  it("is unaffected by the activity counts, which this report never draws", () => {
    const loud: RepRow = {
      id: "a",
      name: "Asha Rao",
      activities: { ...ZERO_COUNTS, meetings: 999, admission: 999 },
      statuses: { "Session done": 1 },
    };
    const quiet = row("Bhavin Shah", { "Session done": 4 });
    expect(
      comparePipelineRows(loud, quiet, { key: SORT_BY_TOTAL, dir: "desc" }, unsetColumn),
    ).toBeGreaterThan(0);
  });

  it("orders by name with no regard to case-only differences collapsing", () => {
    // localeCompare, so "ashok" sorts beside "Asha" rather than after "Zed".
    const sorted = [row("Zed Khan", {}), row("ashok Rao", {})].sort((a, b) =>
      comparePipelineRows(a, b, asc, unsetColumn),
    );
    expect(sorted.map((r) => r.name)).toEqual(["ashok Rao", "Zed Khan"]);
  });
});

describe("the sort parameters", () => {
  const allowed = ["rep", "Session done", "Session scheduled", NO_STATUS_KEY, "total"];

  it("accepts a known key and direction", () => {
    expect(parsePipelineSort("Session done", "desc", allowed)).toEqual({
      key: "Session done",
      dir: "desc",
    });
  });

  it("accepts an explicit rep-descending, which is not the default", () => {
    expect(parsePipelineSort("rep", "desc", allowed)).toEqual({
      key: "rep",
      dir: "desc",
    });
  });

  /**
   * LENIENT ON PURPOSE, and deliberately unlike /team/report's range, which
   * hard-errors. A wrong sort shows the right numbers in a different order;
   * a wrong range shows wrong numbers. Only the second has to be refused.
   *
   * The case that makes it matter: an admin renames a status in Settings, and
   * every saved link sorted by the old name would otherwise become an error
   * page.
   */
  it("falls back to the default for an unknown key, taking the direction with it", () => {
    for (const bad of ["Renamed since", "", "garbage", undefined]) {
      expect(parsePipelineSort(bad, "desc", allowed)).toEqual(DEFAULT_PIPELINE_SORT);
    }
  });

  it("falls back to the default direction for an unknown dir", () => {
    expect(parsePipelineSort("Session done", "sideways", allowed)).toEqual({
      key: "Session done",
      dir: "asc",
    });
    expect(parsePipelineSort("Session done", undefined, allowed)).toEqual({
      key: "Session done",
      dir: "asc",
    });
  });

  it("refuses a key that is not a column on this render", () => {
    // The NO STATUS band is dropped while a range is active, so its sentinel
    // leaves `allowed` and a link naming it stops sorting by nothing.
    const noUnset = allowed.filter((k) => k !== NO_STATUS_KEY);
    expect(parsePipelineSort(NO_STATUS_KEY, "desc", noUnset)).toEqual(
      DEFAULT_PIPELINE_SORT,
    );
  });
});

describe("the range schema", () => {
  it("accepts no range at all, which is the report's default state", () => {
    const parsed = pipelineRangeSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(rangeIsActive(parsed.data!)).toBe(false);
  });

  it("treats a blank string as no bound", () => {
    const parsed = pipelineRangeSchema.safeParse({ from: "", to: "   " });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ from: undefined, to: undefined });
    expect(rangeIsActive(parsed.data!)).toBe(false);
  });

  it("accepts one bound without the other", () => {
    expect(pipelineRangeSchema.safeParse({ from: "2026-04-01" }).success).toBe(true);
    expect(pipelineRangeSchema.safeParse({ to: "2026-06-30" }).success).toBe(true);
    expect(rangeIsActive({ from: "2026-04-01" })).toBe(true);
    expect(rangeIsActive({ to: "2026-06-30" })).toBe(true);
  });

  it("refuses an inverted range with a sentence", () => {
    const parsed = pipelineRangeSchema.safeParse({
      from: "2026-06-30",
      to: "2026-04-01",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      "The start date has to be on or before the end date.",
    );
  });

  it("accepts a single-day range", () => {
    expect(
      pipelineRangeSchema.safeParse({ from: "2026-10-06", to: "2026-10-06" })
        .success,
    ).toBe(true);
  });

  /** Ten characters in the right shape is not the same as a day. */
  it("refuses a date that is not a real day", () => {
    for (const bad of ["2026-02-31", "2026-13-01", "2026-00-10"]) {
      const parsed = pipelineRangeSchema.safeParse({ from: bad });
      expect(parsed.success, bad).toBe(false);
    }
  });

  it("refuses a malformed date", () => {
    for (const bad of ["06-10-2026", "2026/10/06", "Oct 2026"]) {
      expect(pipelineRangeSchema.safeParse({ from: bad }).success, bad).toBe(false);
    }
  });

  /**
   * NO `MAX_RANGE_DAYS` CAP, unlike `exportRangeSchema`. That cap stops a
   * ten-year export being built row by row; this filter only narrows a read
   * the screen was going to do in full anyway, so a wide range is cheaper than
   * a narrow one rather than more expensive.
   */
  it("puts no upper bound on how wide a range may be", () => {
    expect(
      pipelineRangeSchema.safeParse({ from: "2015-01-01", to: "2030-12-31" })
        .success,
    ).toBe(true);
  });
});

describe("the URL the controls build", () => {
  const noRange = {};

  it("writes nothing at all for the default state", () => {
    expect(pipelineHref({ range: noRange, sort: DEFAULT_PIPELINE_SORT })).toBe(
      "/institutes/report",
    );
  });

  it("omits the default sort, so the shortest link is the shareable one", () => {
    expect(
      pipelineHref({ range: { from: "2026-04-01" }, sort: DEFAULT_PIPELINE_SORT }),
    ).toBe("/institutes/report?from=2026-04-01");
  });

  it("carries both parameter sets together", () => {
    const href = pipelineHref({
      range: { from: "2026-04-01", to: "2026-06-30" },
      sort: { key: "Session done", dir: "desc" },
    });
    expect(href).toBe(
      "/institutes/report?from=2026-04-01&to=2026-06-30&sort=Session+done&dir=desc",
    );
  });

  /**
   * THE COMPOSITION REQUIREMENT. A sort link that dropped the range would
   * silently widen the report the moment somebody sorted it, which reads as
   * the numbers changing for no reason.
   */
  it("keeps the range when a header is clicked", () => {
    const range = { from: "2026-04-01", to: "2026-06-30" };
    const href = sortHref("Session done", DEFAULT_PIPELINE_SORT, range);
    expect(href).toContain("from=2026-04-01");
    expect(href).toContain("to=2026-06-30");
    expect(href).toContain("sort=Session+done");
  });

  it("reverses the active column and leaves the others at their useful default", () => {
    // A count column opens descending — "who has the most" is the question a
    // reader taps a count to ask.
    expect(sortHref("Session done", DEFAULT_PIPELINE_SORT, noRange)).toContain(
      "dir=desc",
    );
    // The name column opens ascending, which is also the report's default.
    expect(
      sortHref(SORT_BY_REP, { key: "Session done", dir: "desc" }, noRange),
    ).toBe("/institutes/report");

    // And the active column flips.
    expect(
      sortHref("Session done", { key: "Session done", dir: "desc" }, noRange),
    ).toContain("dir=asc");
    expect(
      sortHref("Session done", { key: "Session done", dir: "asc" }, noRange),
    ).toContain("dir=desc");
  });

  it("round-trips: every link it builds parses back to the same state", () => {
    const states = [
      { range: {}, sort: DEFAULT_PIPELINE_SORT },
      { range: { from: "2026-04-01" }, sort: { key: "total", dir: "desc" as const } },
      {
        range: { from: "2026-04-01", to: "2026-06-30" },
        sort: { key: "Session done", dir: "asc" as const },
      },
    ];
    const allowed = ["rep", "Session done", "total"];

    for (const state of states) {
      const url = new URL(pipelineHref(state), "https://example.test");
      const range = pipelineRangeSchema.parse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      });
      const sort = parsePipelineSort(
        url.searchParams.get("sort") ?? undefined,
        url.searchParams.get("dir") ?? undefined,
        allowed,
      );
      expect({ range: { ...range }, sort }).toEqual({
        range: { from: state.range.from, to: state.range.to },
        sort: state.sort,
      });
    }
  });
});

describe("the cohort link a count opens", () => {
  it("names the owner and the status, as /institutes understands them", () => {
    expect(cohortHref("rep-1", "Session done")).toBe(
      "/institutes?owner=rep-1&status=Session+done",
    );
  });

  it("carries both sentinels through unchanged", () => {
    expect(cohortHref(UNASSIGNED_KEY, NO_STATUS_KEY)).toBe(
      "/institutes?owner=__unassigned__&status=__none__",
    );
  });

  it("keeps the Unassigned label out of the URL — the sentinel is the key", () => {
    expect(cohortHref(UNASSIGNED_KEY, NO_STATUS_KEY)).not.toContain(
      UNASSIGNED_LABEL,
    );
  });
});
