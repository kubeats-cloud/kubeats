import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The client's spec puts the two halves of 0069 in two different places: the
 * In-Field/In-Office/On-Leave TOGGLE at the top of the Rep Dashboard, and the
 * HISTORY in the rep's reporting section. The toggle was first built on
 * /report; this holds the corrected placement without rendering either page.
 *
 * Same shape as `call-activity-relocation.test.ts`: read the real source and
 * assert the structural invariants, because the project has no DOM harness.
 */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const dashboard = read("src/app/(app)/page.tsx");
const report = read("src/app/(app)/report/page.tsx");
const teamReport = read("src/app/(app)/team/report/page.tsx");

describe("the daily-status toggle lives on the Rep Dashboard", () => {
  it("renders it, and reads today's value, on the Dashboard", () => {
    expect(dashboard).toContain("<DailyStatusToggle");
    expect(dashboard).toContain("getMyTodayStatus");
  });

  it("puts it inside the rep-only branch, above Today", () => {
    const toggle = dashboard.indexOf("<DailyStatusToggle");
    const repBranch = dashboard.indexOf("{!staff && (");
    const staffBranch = dashboard.indexOf("{staff ? (");
    const today = dashboard.indexOf("<SectionTitle>Today</SectionTitle>");

    expect(repBranch).toBeGreaterThan(-1);
    expect(staffBranch).toBeGreaterThan(repBranch);
    expect(today).toBeGreaterThan(repBranch);
    // Inside `{!staff && ( ... )}`: after its opening and before the staff
    // branch — an admin or team lead never reaches the control.
    expect(toggle).toBeGreaterThan(repBranch);
    expect(toggle).toBeLessThan(staffBranch);
    // "At the top of the Rep Dashboard": above the existing Today section.
    expect(toggle).toBeLessThan(today);
  });
});

describe("the toggle is off the Report page", () => {
  it("no longer renders it or fetches today's value there", () => {
    expect(report).not.toContain("DailyStatusToggle");
    expect(report).not.toContain("getMyTodayStatus");
  });

  it("keeps the history report exactly where it was", () => {
    expect(report).toContain("<DailyStatusHistory");
    expect(report).toContain("getDailyStatusReport");
  });
});

describe("the staff report is untouched", () => {
  it("still renders the team's daily-status table", () => {
    expect(teamReport).toContain("<DailyStatusReportTable");
    expect(teamReport).toContain("getDailyStatusReport");
  });
});
