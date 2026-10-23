import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_PAGE_SIZE,
  SORT_BY_REP,
  SORT_BY_TOTAL,
  activitySortKeys,
  buildActivityGrid,
  pageReps,
  sortRepRows,
  type RepRow,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import {
  repActivityHref,
  repStatusReviewHref,
} from "@/lib/rep-activity-links";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import {
  DEFAULT_PIPELINE_SORT,
  nextSortDirection,
  parsePipelineSort,
} from "@/lib/validation/pipeline-report";
import { exportRangeSchema } from "@/lib/validation/export";
import { monthEndOf, monthStartOf } from "@/lib/periods";
import { todayISO } from "@/lib/dates";

/**
 * The rep-wise Activity report at the end of the admin Overview.
 *
 * The numbers themselves are the Team report's, by construction: the page
 * calls `getActivityReportModel()` and renders `CustomisableGrid`. What this
 * file guards is the part a second wiring could still get wrong — the default
 * month, the sort, who may reach it, and that the download is ordered like the
 * table rather than independently.
 */

const rep = (name: string, statuses: Record<string, number>): RepRow => ({
  name,
  activities: { ...ZERO_COUNTS },
  statuses,
});

const columns: StatusColumns = {
  closed: [
    { status: "Closed A", label: "Closed A", retired: false },
    { status: "Closed B", label: "Closed B", retired: false },
  ],
  open: [{ status: "Open A", label: "Open A", retired: false }],
};

const page = () =>
  readFileSync(
    fileURLToPath(new URL("../../src/app/(app)/page.tsx", import.meta.url)),
    "utf8",
  );

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("the default period is the current month", () => {
  it("resolves an unparameterised report the same way the export does", () => {
    const parsed = exportRangeSchema.parse({});
    expect(parsed.start).toBe(monthStartOf(todayISO()));
    expect(parsed.end).toBe(monthEndOf(parsed.start));
  });
});

describe("sorting the rep report", () => {
  const rows = [
    rep("Bilal", { "Closed A": 1 }),
    rep("asha", { "Closed A": 3, "Open A": 1 }),
    rep("Chitra", { "Closed A": 3 }),
  ];

  it("sorts by name in both directions, case-insensitively", () => {
    expect(sortRepRows(rows, { key: SORT_BY_REP, dir: "asc" }).map((r) => r.name))
      .toEqual(["asha", "Bilal", "Chitra"]);
    expect(sortRepRows(rows, { key: SORT_BY_REP, dir: "desc" }).map((r) => r.name))
      .toEqual(["Chitra", "Bilal", "asha"]);
  });

  it("sorts by a status column, with ties broken by name", () => {
    expect(sortRepRows(rows, { key: "Closed A", dir: "desc" }).map((r) => r.name))
      .toEqual(["asha", "Chitra", "Bilal"]);
    expect(sortRepRows(rows, { key: "Closed A", dir: "asc" }).map((r) => r.name))
      .toEqual(["Bilal", "asha", "Chitra"]);
  });

  it("sorts by TOTAL, which is the status cells and not the activity band", () => {
    // asha 4, Chitra 3, Bilal 1.
    expect(sortRepRows(rows, { key: SORT_BY_TOTAL, dir: "desc" }).map((r) => r.name))
      .toEqual(["asha", "Chitra", "Bilal"]);
  });

  it("treats an unknown key as an all-zero column, never as a crash", () => {
    expect(sortRepRows(rows, { key: "Ghost status", dir: "desc" }).map((r) => r.name))
      .toEqual(["asha", "Bilal", "Chitra"]);
  });

  it("accepts exactly the keys the grid can emit", () => {
    const grid = buildActivityGrid({
      reps: [rep("Asha", {})],
      columns,
      showActivities: false,
    });
    expect(activitySortKeys(columns)).toEqual(
      grid.sortKeys.filter((key): key is string => key !== null),
    );
  });

  it("falls back to the default for a stale URL, and reverses the active column", () => {
    const allowed = activitySortKeys(columns);
    expect(parsePipelineSort("Open A", "desc", allowed)).toEqual({
      key: "Open A",
      dir: "desc",
    });
    expect(parsePipelineSort("Retired status", "desc", allowed)).toEqual(
      DEFAULT_PIPELINE_SORT,
    );

    expect(nextSortDirection("Open A", { key: "Open A", dir: "asc" })).toBe("desc");
    expect(nextSortDirection("Open A", { key: SORT_BY_REP, dir: "asc" })).toBe("desc");
    expect(nextSortDirection(SORT_BY_REP, { key: "Open A", dir: "desc" })).toBe("asc");
  });
});

describe("the Overview section uses the Team report's model and grid", () => {
  it("renders the shared grid, controls and export at the end of the page", () => {
    const text = page();
    expect(text).toContain("getActivityReportModel(repRange");
    expect(text).toContain("<CustomisableGrid");
    expect(text).toContain('viewKey="overview-activity-report"');
    expect(text).toContain("showActivities={false}");
    expect(text).toContain("sortHrefs={repSortHrefs}");
    expect(text).toContain("<ExportExcel");
    expect(text).toContain("sort={repActivitySort}");

    // Inside the admin branch (which is before the rep branch's "This week"
    // heading). The institute-wise table remains on the Institutes route.
    expect(text).not.toContain("<InstituteActivityTable");
    expect(text.indexOf("<CustomisableGrid")).toBeLessThan(text.indexOf("This week"));

    // The drill-downs and the paged footer, on the Overview only.
    expect(text).toContain("linkReps");
    expect(text).toContain("reviewRange={repRange}");
    expect(text).toContain("totalsReps={activityReport.model.reps}");
    expect(text).toContain("pageReps(activityReport.model.reps");
    expect(text).toContain("repPageHref");
  });

  it("fetches only for an admin, and never for a team lead or rep", () => {
    const text = page();
    expect(text).toContain('if (user.role === "team_lead") redirect("/team");');

    const call = text.indexOf("getActivityReportModel(repRange");
    expect(call).toBeGreaterThan(-1);
    // The call sits immediately behind the admin-and-range guard in the
    // Promise.all; a rep or team lead never reaches it.
    expect(text.slice(call - 160, call)).toContain("admin && repRange");
    expect((text.match(/<CustomisableGrid/g) ?? []).length).toBe(1);
    expect((text.match(/<ExportExcel/g) ?? []).length).toBe(1);
    // And the page never uses an elevated key to widen the rows RLS returns.
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("reuses the catalogue already loaded for the page", () => {
    // The report model would otherwise read the vocabulary a second time.
    expect(page()).toContain("catalogue: loaded");
    expect(read("src/lib/exports/activity-export.ts")).toContain(
      "options.catalogue ? Promise.resolve(options.catalogue) : listStatusCatalogue()",
    );
  });
});

describe("the drill-downs land on the same rows", () => {
  it("sends a rep's name to their existing hub", () => {
    expect(repActivityHref("rep-1")).toBe("/team/rep-1");
  });

  it("sends a count to Review filtered by rep, visit status and dates", () => {
    const href = repStatusReviewHref({
      memberId: "rep-1",
      status: "First meeting done",
      range: { start: "2026-10-01", end: "2026-10-31" },
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/review");
    expect(url.searchParams.get("member")).toBe("rep-1");
    // The VISIT's status, not the institute's: the cell counts
    // `visits.status_set_to`, which is what `?visitStatus=` filters.
    expect(url.searchParams.get("visitStatus")).toBe("First meeting done");
    expect(url.searchParams.get("status")).toBeNull();
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-31");
  });

  it("is wired into the shared grid, and only when asked", () => {
    const grid = read("src/components/report/customisable-grid.tsx");
    expect(grid).toContain("repHrefFor: linkReps");
    expect(grid).toContain("repStatusReviewHref");
    expect(grid).toContain("reviewRange");

    // The table draws the name link from the model's id, which readRows must
    // actually carry — a `RepRow` without one is silently not a door.
    expect(read("src/lib/exports/activity-export.ts")).toContain("id: person.id");
    expect(read("src/components/report/activity-grid-table.tsx")).toContain(
      "data.repHrefFor?.(data.reps[r])",
    );
  });

  it("is exactly the filter set listTeamVisits already implements", () => {
    const workspace = read("src/lib/admin-workspace.ts");
    for (const filter of [
      'filters.member',
      'filters.visitStatus',
      'filters.from',
      'filters.to',
    ]) {
      expect(workspace, filter).toContain(filter);
    }
    // No new Review filter was needed, and none was added.
    expect(read("src/app/(app)/review/page.tsx")).toContain(
      "visitStatus: first(searchParams.visitStatus)",
    );
  });

  it("leaves the Team report's grid plain", () => {
    const team = read("src/app/(app)/team/report/page.tsx");
    expect(team).toContain("<CustomisableGrid");
    expect(team).not.toContain("linkReps");
    expect(team).not.toContain("reviewRange");
    expect(team).not.toContain("totalsReps");
  });
});

describe("fifty reps a page", () => {
  const reps = Array.from({ length: ACTIVITY_PAGE_SIZE * 2 + 7 }, (_, i) =>
    rep(`Rep ${String(i + 1).padStart(3, "0")}`, { "Closed A": i }),
  );

  it("caps the rendered body and keeps the rest reachable", () => {
    const first = pageReps(reps, 1);
    expect(first.reps).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(3);

    const last = pageReps(reps, 3);
    expect(last.reps).toHaveLength(7);
    expect(last.page).toBe(3);
  });

  it("clamps a stale or nonsense page to one that exists", () => {
    expect(pageReps(reps, 99).page).toBe(3);
    expect(pageReps(reps, 0).page).toBe(1);
    expect(pageReps(reps, -4).page).toBe(1);
    expect(pageReps(reps, Number.NaN).page).toBe(1);
  });

  it("keeps 'All reps' meaning all reps in the footer", () => {
    const page = pageReps(reps, 1);
    const paged = buildActivityGrid({
      reps: page.reps,
      totalsFrom: reps,
      columns,
    });
    const whole = buildActivityGrid({ reps, columns });

    expect(paged.rows).toHaveLength(2 + ACTIVITY_PAGE_SIZE);
    // The visible body's own figures are the page's...
    expect(paged.totals?.perRow).toHaveLength(ACTIVITY_PAGE_SIZE);
    // ...but the bottom row is the full report's arithmetic.
    expect(paged.totals?.perColumn).toEqual(whole.totals?.perColumn);
    expect(paged.totals?.grand).toBe(whole.totals?.grand);
  });

  it("is not applied to the export", () => {
    expect(read("src/lib/exports/activity-export.ts")).not.toContain("pageReps");
    const route = read("src/app/api/export/activity/route.ts");
    expect(route).toContain("buildActivityExport(");
    expect(route).toContain("member ?? null");
    expect(route).toContain("sort,");
  });
});

describe("the Excel download follows the table", () => {
  it("carries the sort on the export link", () => {
    expect(read("src/components/report/export-excel.tsx")).toContain(
      'params.set("sort", sort.key)',
    );
  });

  it("passes the sort through the endpoint to the same model", () => {
    const route = read("src/app/api/export/activity/route.ts");
    expect(route).toContain('params.get("sort")');
    expect(route).toContain('params.get("dir")');
    expect(route).toContain("buildActivityExport(");
    expect(route).toContain("member ?? null");

    const model = read("src/lib/exports/activity-export.ts");
    expect(model).toContain("activitySortKeys(columns)");
    // The rows are enriched with the 12 cell counts before they are sorted,
    // so the sort runs over the same array the grid draws.
    expect(model).toContain("sortRepRows(withActivityStatuses, sort)");
  });
});
