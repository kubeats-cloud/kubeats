import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REP_ACTIVITY_EXPORT_MAX_DAYS,
  rangeLengthInDays,
  repActivityExportRangeProblem,
} from "@/lib/validation/export";

describe("the rep's 31-day download cap", () => {
  it("counts both ends, so a calendar month of 31 days is allowed", () => {
    expect(REP_ACTIVITY_EXPORT_MAX_DAYS).toBe(31);
    expect(rangeLengthInDays("2026-10-01", "2026-10-31")).toBe(31);
    expect(
      repActivityExportRangeProblem("2026-10-01", "2026-10-31"),
    ).toBeNull();
  });

  it("allows a single day", () => {
    expect(rangeLengthInDays("2026-10-24", "2026-10-24")).toBe(1);
    expect(
      repActivityExportRangeProblem("2026-10-24", "2026-10-24"),
    ).toBeNull();
  });

  it("refuses a 32nd day, in the same sentence the route answers with", () => {
    expect(
      repActivityExportRangeProblem("2026-10-01", "2026-11-01"),
    ).toBe("Choose a range of 31 days or fewer.");
  });

  it("refuses an inverted range", () => {
    expect(
      repActivityExportRangeProblem("2026-10-31", "2026-10-01"),
    ).toBe("The start date has to be on or before the end date.");
  });

  it("refuses a range open at one end, because the cap cannot be checked", () => {
    expect(repActivityExportRangeProblem("", "2026-10-31")).toBe(
      "Choose both a start and an end date.",
    );
    expect(repActivityExportRangeProblem("2026-10-01", "")).toBe(
      "Choose both a start and an end date.",
    );
  });
});

describe("the rep export route", () => {
  const route = readFileSync(
    "src/app/api/export/institute-activity/route.ts",
    "utf8",
  );

  it("admits only the matching role for each view and scopes rep data in SQL/RLS", () => {
    expect(route).toContain("getCurrentUser()");
    expect(route).toContain("requireStaff");
    expect(route).toContain('user.role !== "rep"');
    expect(route).toContain('rawView === "rep"');
    expect(route).toContain("view,");
    expect(route).toContain("buildInstituteActivityExport");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("applies the route's shared complete-range and 31-day guard", () => {
    expect(route).toContain("instituteActivityExportRangeProblem");
    expect(route).toContain("pipelineRangeSchema.safeParse");
  });
});

describe("the control on the rep's Institutes tab", () => {
  const page = readFileSync("src/app/(app)/institutes/page.tsx", "utf8");
  const control = readFileSync(
    "src/components/report/download-activity.tsx",
    "utf8",
  );

  it("is rendered only inside the rep branch", () => {
    expect(page).toContain('import { DownloadActivity } from "@/components/report/download-activity"');
    const repBranch = page.indexOf(") : !isRep ? (");
    expect(repBranch).toBeGreaterThan(-1);
    expect(page.indexOf("<DownloadActivity")).toBeGreaterThan(repBranch);
    expect(page.indexOf("<DownloadActivity")).toBeLessThan(
      page.indexOf("<RepInstituteSearch"),
    );
  });

  it("mounts with the table's range, falling back to this month", () => {
    expect(page).toContain("activityDownloadRange");
    expect(page).toContain("defaultExportRange()");
    expect(page).toContain("sort={repActivitySort}");
  });

  it("calls the existing institute-wise export route and shows the cap", () => {
    expect(control).toContain("/api/export/institute-activity");
    expect(control).toContain("Download Activity (Excel)");
    expect(control).toContain("repActivityExportRangeProblem");
    expect(control).toContain('view: "rep"');
    expect(control).toContain('htmlFor="rep-export-start"');
    expect(control).toContain('htmlFor="rep-export-end"');
  });
});
