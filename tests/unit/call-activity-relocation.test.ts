import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The per-rep Call Activity status-count summary moved off Review and into the
 * Activity tab's Call Activity card.
 *
 * Same testing shape as `activity-tab.test.ts`: read the real source and
 * assert the structural invariants, because this feature is wiring between
 * existing query/table/export pieces and the project has no DOM test harness.
 */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const review = read("src/app/(app)/review/page.tsx");
const visitReview = read("src/components/admin/visit-review.tsx");
const reviewDetail = read("src/app/(app)/review/[id]/page.tsx");
const activityPage = read("src/app/(app)/activity/page.tsx");
const callBox = read("src/components/activity/call-activity-box.tsx");
const filters = read("src/components/report/call-activity-filters.tsx");

describe("Review no longer renders the Call Activity summary", () => {
  it("drops the summary table, its filter bar, and its Excel button", () => {
    expect(review).not.toContain("Call Activity Report");
    expect(review).not.toContain("<CallActivityFilters");
    expect(review).not.toContain("/api/export/call-activity");
    expect(review).not.toContain("getCallActivityReport(");
    expect(review).not.toContain("parseCallActivityFilters(");
    expect(review).not.toContain("parseCallActivitySort(");
    expect(review).not.toContain("callSort");
    expect(review).not.toContain("callFrom");
    expect(review).not.toContain("CustomisableGrid");
  });

  it("keeps the Call/Visit report list, its labels and its review filters", () => {
    expect(review).toContain("<VisitReview");
    expect(review).toContain("listTeamVisits(");
    expect(review).toContain("listCallReports(");
    expect(review).toContain("Call Reports and Log Visit Reports");
    for (const key of [
      "member",
      "institute",
      "activity",
      "from",
      "to",
      "reported",
      "visitStatus",
      "lifecycle",
      "category",
    ]) {
      expect(review, `Review must keep its "${key}" filter`).toContain(key);
    }
  });

  it("keeps admin correct-a-call editing reachable", () => {
    expect(visitReview).toContain("Open full Call Report");
    expect(reviewDetail).toContain("CallReportEdit");
  });
});

describe("Activity → Call Activity is the summary's new home", () => {
  it("fetches the same query the summary used", () => {
    expect(activityPage).toContain("getCallActivityReport(");
    expect(activityPage).toContain("parseCallActivityFilters(");
    expect(activityPage).toContain("parseCallActivitySort(");
  });

  it("renders the same grid, totals and per-status columns", () => {
    expect(callBox).toContain("<CallActivityFilters");
    expect(callBox).toContain('viewKey="call-activity-report"');
    expect(callBox).toContain("showGroupTotals");
    expect(callBox).toContain("linkReps");
    expect(callBox).toContain("totalsRow(");
    expect(callBox).toContain("columns.closed");
    expect(callBox).toContain("columns.open");
  });

  it("downloads from the existing call-activity export route, from applied filters", () => {
    expect(callBox).toContain("/api/export/call-activity?");
    expect(callBox).not.toContain("/api/export/activity?");
    expect(callBox).not.toContain("/api/export/pipeline");
    expect(callBox).toContain("filters.from");
    expect(callBox).toContain("filters.institute");
    expect(callBox).toContain("filters.status");
  });

  it("keeps the filter bar's Apply/Clear, and Clear resets every call filter", () => {
    expect(filters).toContain("Apply");
    expect(filters).toContain("Clear");
    for (const key of [
      "callFrom",
      "callTo",
      "callMember",
      "callInstitute",
      "callStatus",
    ]) {
      expect(filters, `Clear must reset ${key}`).toContain(key);
    }
    expect(filters).toMatch(/set\("callFrom", next\.from\)/);
    expect(filters).toMatch(/set\("callTo", next\.to\)/);
  });
});
