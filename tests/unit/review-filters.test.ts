import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VISIT_STATUS_NONE } from "@/lib/admin-workspace";

/**
 * THE TWO STATUS FILTERS MUST NEVER BE MERGED.
 *
 * `?status=` asks about the INSTITUTE as it stands now; `?visitStatus=` asks
 * what a VISIT decided on the day. They read alike, they take the same
 * vocabulary, and they return different sets — so the failure mode is not a
 * crash but a screen that quietly answers the other question and shows a
 * number the badge did not promise.
 *
 * `listTeamVisits` is a PostgREST query builder, so there is nothing to call
 * without a database. The query is asserted as text instead — the same call
 * `use-server-exports.test.ts` and the open-loops guard make, and for the same
 * reason: a filter that silently stops filtering is exactly what nobody
 * notices.
 */

const src = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), "utf8");

describe("the two status filters stay distinct", () => {
  const lib = src("lib/admin-workspace.ts");

  it("keys visitStatus on the visit's own column", () => {
    expect(lib).toContain('query.eq("status_set_to", filters.visitStatus)');
  });

  it("keys instituteStatus on the embedded institute, dotted", () => {
    expect(lib).toContain('query.eq("institutes.status", filters.instituteStatus)');
  });

  /** The whole point: neither may be written in terms of the other. */
  it("never feeds one filter from the other's value", () => {
    expect(lib).not.toContain('eq("status_set_to", filters.instituteStatus)');
    expect(lib).not.toContain('eq("institutes.status", filters.visitStatus)');
  });

  it("supports the none sentinel for a visit with no status", () => {
    expect(VISIT_STATUS_NONE).toBe("__none__");
    expect(lib).toContain('query.is("status_set_to", null)');
  });
});

describe("the lifecycle filter agrees with the open-loops counter", () => {
  const lib = src("lib/admin-workspace.ts");

  /**
   * "Set" means STILL OPEN. Since Stage 3 a closed loop keeps
   * `lifecycle_status = 'Set'` and only gains a `closed_at`, so filtering on
   * the lifecycle alone would list closed work as open — the exact bug the
   * three counters shipped with.
   */
  it("requires closed_at IS NULL for Set, not the lifecycle alone", () => {
    expect(lib).toContain(
      'query.eq("lifecycle_status", "Set").is("closed_at", null)',
    );
  });

  it("uses the same predicate the open-loops tile counts", () => {
    expect(lib).toContain(
      'countOf((q) => q.eq("lifecycle_status", "Set").is("closed_at", null))',
    );
  });

  it("treats Done as its own rows", () => {
    expect(lib).toContain('query.eq("lifecycle_status", "Done")');
  });
});

describe("the review row carries what the hubs need", () => {
  const lib = src("lib/admin-workspace.ts");

  it("selects both ids", () => {
    expect(lib).toContain("member, institute_id");
    expect(lib).toContain("memberId: row.member");
    expect(lib).toContain("instituteId: row.institute_id");
  });

  it("carries them on an assignment row too", () => {
    expect(lib).toContain("memberId: row.member");
    expect(lib).toContain("instituteId: row.institute_id");
  });
});

describe("the status badge links to the VISIT filter", () => {
  const review = src("components/admin/visit-review.tsx");

  /** ?status= here would silently answer the institute question instead. */
  it("uses ?visitStatus= on the visit's own status cell", () => {
    expect(review).toContain("/review?visitStatus=");
    expect(review).not.toContain("/review?status=");
  });

  it("offers both controls, separately labelled", () => {
    expect(review).toContain("Institute status now");
    expect(review).toContain("Status set by this visit");
  });

  it("counts the new params as active filters", () => {
    const block = review.slice(review.indexOf("const activeCount"));
    expect(block.slice(0, 260)).toContain('"visitStatus"');
    expect(block.slice(0, 260)).toContain('"lifecycle"');
  });
});

describe("CountLink", () => {
  const cl = src("components/ui/count-link.tsx");
  const grid = src("components/report/activity-grid-table.tsx");

  it("renders a zero as plain text with no href", () => {
    const zero = cl.slice(cl.indexOf("if (value === 0)"), cl.indexOf("if (mdOnly)"));
    expect(zero).toContain("<span");
    expect(zero).not.toContain("href");
  });

  it("shares its styling with the report grid rather than copying it", () => {
    expect(grid).toContain("COUNT_LINK_CLASS");
    expect(grid).toContain("COUNT_ZERO_CLASS");
    // The literal must live in one file only.
    expect(grid).not.toContain("decoration-dotted underline-offset-4");
  });

  it("keeps count links off phones and name links on", () => {
    expect(cl).toContain('"hidden md:inline"');
    expect(grid).toContain('cn("hidden md:inline", COUNT_LINK_CLASS)');
  });
});
