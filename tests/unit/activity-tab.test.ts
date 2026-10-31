import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Activity tab: Rep Activity, Call Activity, Pipeline by Rep and
 * Institute-Wise Activity, consolidated into one admin screen as four
 * switchable cards over one report region.
 *
 * Same testing shape as `call-activity-relocation.test.ts`: the
 * codebase's existing convention for a feature made of mostly wiring is to
 * read the real source and assert its structural invariants, rather than
 * mount a DOM (no React Testing Library in this project).
 */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const activityTabs = read("src/components/activity/activity-tabs.tsx");
const activityTabsMeta = read("src/components/activity/activity-tabs-meta.ts");
const activityPage = read("src/app/(app)/activity/page.tsx");
const repBox = read("src/components/activity/rep-activity-box.tsx");
const callBox = read("src/components/activity/call-activity-box.tsx");
const pipelineBox = read("src/components/activity/pipeline-box.tsx");
const instituteBox = read("src/components/activity/institute-activity-box.tsx");
const toolbar = read("src/components/activity/activity-toolbar.tsx");
const collapsible = read("src/components/activity/collapsible-section.tsx");
const pipelineExportRoute = read("src/app/api/export/pipeline/route.ts");
const pipelineExportLib = read("src/lib/exports/pipeline-export.ts");

describe("ActivityTabs: card switching is local state, not navigation", () => {
  it("has no router import and never calls router.push/replace", () => {
    expect(activityTabs).not.toMatch(/from ["']next\/navigation["']/);
    expect(activityTabs).not.toMatch(/router\.(push|replace)\(/);
  });

  it("switches the visible report with useState, not a fetch", () => {
    expect(activityTabs).toContain("useState<ActivityTabKey>(initialTab)");
    expect(activityTabs).toMatch(/onClick=\{\(\)\s*=>\s*setTab\(card\.key\)\}/);
    expect(activityTabs).not.toContain("fetch(");
  });

  it("renders all four panels and hides the other three with `hidden`, never unmounting them", () => {
    expect(activityTabs).toContain("hidden={tab !== card.key}");
  });

  it("Rep Activity is the default tab", () => {
    expect(activityTabsMeta).toContain('DEFAULT_ACTIVITY_TAB: ActivityTabKey = "rep"');
    expect(activityTabs).toContain("DEFAULT_ACTIVITY_TAB");
  });

  it("each card carries its own report key and label", () => {
    for (const [key, label] of [
      ["rep", "Rep Activity"],
      ["call", "Call Activity"],
      ["pipeline", "Pipeline by Rep"],
      ["institute", "Institute-Wise Activity"],
    ]) {
      expect(activityTabsMeta).toContain(`key: "${key}"`);
      expect(activityTabsMeta).toContain(`label: "${label}"`);
    }
  });

  it("keeps tab data out of the `use client` module, so the server page can read it", () => {
    // Regression: importing ACTIVITY_TABS from activity-tabs.tsx made it a
    // client reference on the server, and ACTIVITY_TABS.some() threw during
    // SSR. Plain data must stay in a module with no directive.
    expect(activityTabs).toMatch(/^"use client";/);
    const firstCodeLine = activityTabsMeta
      .split("\n")
      .map((line) => line.trim())
      .find(
        (line) =>
          line !== "" && !line.startsWith("*") && !line.startsWith("/*"),
      );
    expect(firstCodeLine ?? "").not.toMatch(/^["']use (client|server)["']/);
    expect(activityPage).not.toContain("ACTIVITY_TABS.some");
    expect(activityPage).toContain('from "@/components/activity/activity-tabs-meta"');
  });
});

describe("the Activity page: fetches all four reports, defaults to Rep Activity", () => {
  it("seeds ActivityTabs from ?tab=, falling back to the default", () => {
    expect(activityPage).toContain("initialTab={initialTab}");
    expect(activityPage).toContain("DEFAULT_ACTIVITY_TAB");
  });

  it("gates admin-only, distinct from the four reports' own staff gate", () => {
    expect(activityPage).toContain("const gate = await requireAdmin();");
    expect(activityPage).not.toContain("await requireStaff()");
  });

  it("reuses the same model functions the four standalone screens use — no new counting", () => {
    expect(activityPage).toContain("getActivityReportModel(");
    expect(activityPage).toContain("getCallActivityReport(");
    expect(activityPage).toContain("getInstituteStatusModel(");
    expect(activityPage).toContain("getInstituteStatusActivityModel(");
  });

  it("uses four disjoint sets of query-param names, so one report's range cannot bleed into another", () => {
    // Rep Activity: bare start/end. Call Activity: callFrom/callTo/...
    // Pipeline: pipeFrom/pipeTo/pipeSort/pipeDir. Institute-Wise: bare
    // from/to/sort/dir/page/member/campus/q. None of the four sets share a
    // key with another.
    const sets: Record<string, string[]> = {
      rep: ["start", "end"],
      call: ["callFrom", "callTo", "callMember", "callInstitute", "callStatus", "callSort", "callDir", "callPage"],
      pipeline: ["pipeFrom", "pipeTo", "pipeSort", "pipeDir"],
      institute: ["from", "to", "sort", "dir", "page", "member", "campus", "q"],
    };
    for (const [name, keys] of Object.entries(sets)) {
      for (const key of keys) {
        expect(activityPage, `${name}'s own key "${key}" must appear`).toContain(key);
      }
    }
    const names = Object.keys(sets);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const overlap = sets[names[i]].filter((k) => sets[names[j]].includes(k));
        expect(overlap, `${names[i]} and ${names[j]} must not share a param name`).toEqual([]);
      }
    }
  });

  it("feeds each model its own applied range, never a shared one", () => {
    expect(activityPage).toMatch(
      /getActivityReportModel\(\{\s*start: repRange\.start,\s*end: repRange\.end\s*\}/,
    );
    expect(activityPage).toContain("getCallActivityReport(callFilters, callSort, callPage)");
    expect(activityPage).toMatch(
      /getInstituteStatusModel\(\{\s*range: pipelineParsed\.data/,
    );
    expect(activityPage).toMatch(
      /getInstituteStatusActivityModel\(\{\s*range: instituteRange/,
    );
  });
});

describe("each report's Download Excel calls its own export route, never another's", () => {
  it("Rep Activity → /api/export/activity only", () => {
    expect(repBox).toContain("/api/export/activity?");
    expect(repBox).not.toContain("/api/export/call-activity");
    expect(repBox).not.toContain("/api/export/pipeline");
    expect(repBox).not.toContain("/api/export/institute-activity");
  });

  it("Call Activity → /api/export/call-activity only", () => {
    expect(callBox).toContain("/api/export/call-activity?");
    expect(callBox).not.toContain("/api/export/activity?");
    expect(callBox).not.toContain("/api/export/pipeline");
    expect(callBox).not.toContain("/api/export/institute-activity");
  });

  it("Pipeline by Rep → its own new /api/export/pipeline only", () => {
    expect(pipelineBox).toContain("/api/export/pipeline?");
    expect(pipelineBox).not.toContain("/api/export/activity?");
    expect(pipelineBox).not.toContain("/api/export/call-activity");
    expect(pipelineBox).not.toContain("/api/export/institute-activity");
  });

  it("Institute-Wise Activity → the existing /api/export/institute-activity only", () => {
    expect(instituteBox).toContain("instituteActivityExportHref(");
    expect(instituteBox).not.toContain("/api/export/activity?");
    expect(instituteBox).not.toContain("/api/export/call-activity");
    expect(instituteBox).not.toContain("/api/export/pipeline");
  });
});

describe("Clear is offered on every report, and never invents a date range", () => {
  it("Pipeline and Institute-Wise Activity pass `optional` to RangeControls", () => {
    expect(pipelineBox).toMatch(/<RangeControls[\s\S]*?optional/);
    expect(instituteBox).toMatch(/<RangeControls[\s\S]*?optional/);
  });

  it("Rep Activity asks for Clear explicitly, while keeping its mandatory default range", () => {
    const rangeControlsCall = repBox.slice(
      repBox.indexOf("<RangeControls"),
      repBox.indexOf("/>", repBox.indexOf("<RangeControls")),
    );
    expect(rangeControlsCall).toContain("clearable");
    // Not `optional`: /team/report's contract is a mandatory range defaulting
    // to this month. Clear here navigates back to that default.
    expect(rangeControlsCall).not.toContain("optional");
  });

  it("RangeControls only renders Clear when asked, so /team/report is unchanged", () => {
    expect(repBox).toContain("clearable");
    expect(read("src/components/report/range-controls.tsx")).toContain(
      "(optional || clearable)",
    );
  });

  it("gives each of the four date inputs its own id, since all four render on one page", () => {
    // RangeControls defaults to idPrefix "range"; four of them on one page
    // would mean four #range-start inputs and broken label associations.
    expect(repBox).toContain('idPrefix="rep-range"');
    expect(pipelineBox).toContain('idPrefix="pipe-range"');
    expect(instituteBox).toContain('idPrefix="institute-range"');
  });

  it("Call Activity's Clear removes every call filter and its own dates", () => {
    expect(callBox).toContain("<CallActivityFilters");
    expect(read("src/components/report/call-activity-filters.tsx")).toContain(
      "function clear()",
    );
  });
});

describe("each report has a persistent toolbar: filters left, Download Excel right", () => {
  it.each([
    ["Rep Activity", repBox],
    ["Call Activity", callBox],
    ["Pipeline by Rep", pipelineBox],
    ["Institute-Wise Activity", instituteBox],
  ])("%s uses the shared sticky toolbar", (_name, source) => {
    expect(source).toContain("<ActivityToolbar");
  });

  it("the toolbar sticks below the top bar and stays out of the collapsible area", () => {
    expect(toolbar).toContain("sticky");
    expect(toolbar).toContain("top-14");
    expect(toolbar).toContain("md:top-16");
  });

  it("Download Excel sits inside the toolbar, above CollapsibleSection", () => {
    for (const source of [repBox, pipelineBox, instituteBox]) {
      expect(source.indexOf("<ActivityToolbar")).toBeLessThan(
        source.indexOf("<DownloadButton"),
      );
      expect(source.indexOf("<DownloadButton")).toBeLessThan(
        source.indexOf("<CollapsibleSection"),
      );
    }
    // Call Activity passes its download into the filter bar's `actions` slot,
    // which is still above the collapsible table.
    expect(callBox.indexOf("actions={")).toBeLessThan(
      callBox.indexOf("<CollapsibleSection"),
    );
  });
});

describe("collapse/minimise keeps the cards and toolbar, hiding only the table", () => {
  it("CollapsibleSection toggles a `hidden` region and reports aria-expanded", () => {
    expect(collapsible).toContain("useState(false)");
    expect(collapsible).toContain("hidden={collapsed}");
    expect(collapsible).toContain("aria-expanded={!collapsed}");
  });

  it("every report wraps only its table in the collapsible region", () => {
    for (const source of [repBox, callBox, pipelineBox, instituteBox]) {
      expect(source).toMatch(/<CollapsibleSection[\s\S]*?<CustomisableGrid|<CollapsibleSection[\s\S]*?<InstituteStatusActivityTable/);
    }
  });
});

describe("Pipeline by Rep's export is new and explicitly reuses the on-screen query", () => {
  it("the route gates the same way the screen does, and refuses a bad range", () => {
    expect(pipelineExportRoute).toContain("requireStaff()");
    expect(pipelineExportRoute).toContain("pipelineRangeSchema");
  });

  it("the builder calls getInstituteStatusModel() — the same function /institutes/report renders from", () => {
    expect(pipelineExportLib).toContain("getInstituteStatusModel(");
    expect(pipelineExportLib).toContain("activitySheet(");
    expect(pipelineExportLib).toContain("buildWorkbook(");
  });
});

describe("every outgoing link restates its own tab, never trusting a stale ?tab=", () => {
  it("Rep, Pipeline and Institute boxes set tab explicitly via extraParams built by the page", () => {
    expect(activityPage).toContain('tab: "rep"');
    expect(activityPage).toContain('tab: "pipeline"');
    expect(activityPage).toContain('tab: "institute"');
  });

  it("Call Activity forces tab via its own extraParams prop rather than trusting useSearchParams()", () => {
    expect(callBox).toContain('extraParams={{ tab: "call" }}');
    expect(callBox).toContain('params.set("tab", "call")');
  });
});
