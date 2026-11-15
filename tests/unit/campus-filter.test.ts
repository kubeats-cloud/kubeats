import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCampusFilter, type Campus } from "@/lib/campus-display";

/**
 * The two changes behind this file.
 *
 * PART A — a team lead's "Open the full report" left them on /pending/[id],
 * whose guard is `mine || isAdmin`, so it answered "Page not found". Staff
 * (admin AND team lead) now go to /review/[id], the same destination the admin
 * already used; a rep keeps /pending/[id].
 *
 * PART B — one campus control across the data screens, narrowing the QUERY
 * within what RLS already allows. These assertions are about the wiring that
 * makes that true: the control exists once, it hides when there is nothing to
 * choose, and every screen's data layer actually received the filter.
 *
 * READ AT SOURCE LEVEL for Part A and for the query wiring: the page needs a
 * request context and the queries need a database, neither of which this suite
 * provides. `resolveCampusFilter` is exercised directly because it is pure.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const CAMPUSES: Campus[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "IQ City Campus",
    city: "Durgapur",
    short_name: "IQC",
    active: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "UID Campus",
    city: "Ahmedabad",
    short_name: "UID",
    active: true,
  },
];

describe("the team lead's full report goes where the admin's does", () => {
  const source = read("src/app/(app)/institutes/[id]/page.tsx");

  it("sends staff — admin and team lead — to the Review report", () => {
    expect(source).toContain("isStaff(user)");
    expect(source).toMatch(/\/review\/\$\{visit\.id\}/);
  });

  it("keeps the rep's own reader for a rep", () => {
    expect(source).toMatch(/\/pending\/\$\{visit\.id\}/);
  });

  it("no longer branches that link on admin alone", () => {
    // THE REGRESSION. `/pending/[id]` refuses anyone who is neither the owner
    // nor an admin, so an `admin ?` here compiles, looks role-aware, and 404s
    // every team lead who taps it.
    expect(source).not.toMatch(/admin\s*\?\s*`\/review/);
  });
});

describe("resolveCampusFilter keeps a filter the reader can actually clear", () => {
  it("passes an id through when it is in the permitted list", () => {
    expect(resolveCampusFilter(CAMPUSES, CAMPUSES[1].id)).toBe(CAMPUSES[1].id);
  });

  it("drops an id the reader cannot choose between", () => {
    expect(resolveCampusFilter([CAMPUSES[0]], CAMPUSES[1].id)).toBeUndefined();
  });

  it("treats absent as every campus", () => {
    expect(resolveCampusFilter(CAMPUSES, undefined)).toBeUndefined();
    expect(resolveCampusFilter([], "anything")).toBeUndefined();
  });
});

describe("one control, hidden when there is nothing to choose", () => {
  const source = read("src/components/campus-filter.tsx");

  it("hides at one campus or fewer", () => {
    expect(source).toContain("campuses.length <= 1");
    expect(source).toMatch(/return null/);
  });

  it("offers All campuses", () => {
    expect(source).toContain("All campuses");
  });

  it("can be submitted with a server form as well as drive the URL", () => {
    // Activity's filters are a <form action>, the rest write the URL. One
    // component serves both; a second component would be the duplication this
    // task was told to avoid.
    expect(source).toContain("name?: string");
    expect(source).toContain("<select");
    expect(source).toContain("router.push");
  });
});

describe("the campuses a reader may pick from are theirs", () => {
  const source = read("src/lib/campuses.ts");

  it("an admin gets the whole list", () => {
    expect(source).toContain("if (isAdmin(user)) return listCampuses(true)");
  });

  it("everyone else gets the campus on their own profile", () => {
    expect(source).toContain('from("profiles")');
    expect(source).toContain("campus_id");
  });
});

describe("every table's data layer received the filter", () => {
  it("Review — visits narrow through the institute embed's campus", () => {
    const source = read("src/lib/admin-workspace.ts");
    expect(source).toContain("filters.instituteStatus || filters.campus");
    expect(source).toContain('query.eq("institutes.campus_id", filters.campus)');
  });

  it("Review — calls narrow through their always-inner institute embed", () => {
    expect(read("src/lib/call-reports.ts")).toContain(
      'query.eq("institutes.campus_id",filters.campus)',
    );
  });

  it("Institutes — the registry read filters the view column", () => {
    expect(read("src/lib/registry-page.ts")).toContain(
      "q.eq('campus_id',params.campus)",
    );
  });

  it("Team — the roster is narrowed, not the week's rows hidden", () => {
    const source = read("src/lib/week-summary.ts");
    expect(source).toContain("fetchAllReps(supabase, campus)");
    expect(source).toContain('query.eq("campus_id", campus)');
  });

  it("Activity — Rep Activity narrows the rep list", () => {
    const source = read("src/lib/exports/activity-export.ts");
    expect(source).toContain("readRows(range, memberId, options.campus)");
    expect(source).toContain('profileQuery.eq("campus_id", campus)');
  });

  it("Activity — Pipeline narrows institutes, reps and the denominator", () => {
    const source = read("src/lib/institute-status-report.ts");
    expect(source).toContain("listReps(query.campus)");
    expect(source).toContain("countAllInstitutes(query.campus)");
    expect(source).toContain("query.campus,");
  });

  it("Activity — both card exports carry the same campus as the screen", () => {
    expect(read("src/components/activity/rep-activity-box.tsx")).toContain(
      'exportParams.set("campus", campus)',
    );
    expect(read("src/components/activity/pipeline-box.tsx")).toContain(
      'params.set("campus", campus)',
    );
  });

  it("a live route still serves the filtered page's own workbook", () => {
    expect(read("src/lib/institute-activity-report.ts")).toContain(
      "p_campus: query.campus || null",
    );
  });
});

/**
 * The one report that CANNOT take the filter yet, recorded so the next reader
 * does not assume it was forgotten. `call_activity_report()` (0073) has no
 * campus parameter, and hiding rows after it returns would corrupt its paging
 * and totals — the filter needs a database change, which this task excluded.
 */
describe("Call Activity's missing campus filter is a database limit, not an oversight", () => {
  it("the RPC still has no campus argument", () => {
    const migration = read("supabase/migrations/0073_call_read_paths.sql");
    const fn = migration.slice(migration.indexOf("function public.call_activity_report("));
    const signature = fn.slice(0, fn.indexOf(")"));
    expect(signature).not.toContain("p_campus");
  });

  it("the Activity page says so where the other cards' keys are resolved", () => {
    expect(read("src/app/(app)/activity/page.tsx")).toContain(
      "CALL ACTIVITY IS DELIBERATELY ABSENT",
    );
  });
});
