import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isPending } from "@/lib/activity-report";

/**
 * An open loop is "Set" AND NOT YET CLOSED. Both halves, in all three places.
 *
 * WHAT WENT WRONG. Stage 3 stopped closing a loop by flipping the row. A
 * session set in week 1 and held in week 3 became TWO visits: the completing
 * row carries `closes_visit_id`, and the ORIGINAL keeps
 * `lifecycle_status = 'Set'` for ever so week 1 keeps its Sessions Set and
 * week 3 earns its Sessions Done. From that moment `closed_at` was the only
 * field that said a loop had been closed.
 *
 * Two counters never got the second half, and both are the kind that fails
 * silently: they still returned a number, the number was still plausible, and
 * it could only ever RISE. The /report card printed it under the label "Open
 * loops (Set, not yet Done)", which is precisely what it did not compute.
 *
 * WHY THE SOURCE IS READ AND NOT JUST THE PREDICATE. `isPending()` is pure and
 * can be proved here; the Overview tile is a PostgREST query builder, so there
 * is nothing to call without a database. A count that can only rise is exactly
 * the sort of thing nobody notices, so the query is asserted as text rather
 * than left to a comment — the same call `use-server-exports.test.ts` makes.
 */

const src = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/lib/${path}`, import.meta.url)), "utf8");

describe("isPending — the /report Pending and open-loops figure", () => {
  it("counts a Set that nothing has closed", () => {
    expect(isPending({ lifecycle_status: "Set", closed_at: null })).toBe(true);
  });

  /** The regression. Before the fix this returned true and the figure only grew. */
  it("does NOT count a Set that a later visit has closed", () => {
    expect(
      isPending({ lifecycle_status: "Set", closed_at: "2026-03-11T09:30:00Z" }),
    ).toBe(false);
  });

  it("does not count a Done, closed or not", () => {
    expect(isPending({ lifecycle_status: "Done", closed_at: null })).toBe(false);
    expect(
      isPending({ lifecycle_status: "Done", closed_at: "2026-03-11T09:30:00Z" }),
    ).toBe(false);
  });

  /** A one-shot — meeting, olympiad, application — carries no lifecycle at all. */
  it("does not count an activity with no lifecycle", () => {
    expect(isPending({ lifecycle_status: null, closed_at: null })).toBe(false);
  });

  /**
   * The arithmetic the report actually does: `completed = total - pending`.
   * A closed Set has to land in completed, not in pending.
   */
  it("puts a closed Set on the completed side of the split", () => {
    const visits = [
      { lifecycle_status: "Set", closed_at: null },
      { lifecycle_status: "Set", closed_at: "2026-03-11T09:30:00Z" },
      { lifecycle_status: "Done", closed_at: null },
      { lifecycle_status: null, closed_at: null },
    ];
    const pending = visits.filter(isPending).length;

    expect(pending).toBe(1);
    expect(visits.length - pending).toBe(3);
  });

  /** The predicate is useless if the column is never fetched. */
  it("selects closed_at, or the predicate would read undefined", () => {
    const text = src("activity-report.ts");
    const select = text.match(/"date, activity, lifecycle_status[^"]*"/);

    expect(select).not.toBeNull();
    expect(select![0]).toContain("closed_at");
  });
});

describe("the Overview open-loops tile", () => {
  it('asks for closed_at IS NULL alongside lifecycle_status = "Set"', () => {
    const text = src("admin-workspace.ts");

    expect(text).toContain(
      'countOf((q) => q.eq("lifecycle_status", "Set").is("closed_at", null))',
    );
    // And never the bare form the bug shipped as.
    expect(text).not.toMatch(/countOf\(\(q\) => q\.eq\("lifecycle_status", "Set"\)\)/);
  });
});

describe("listReps", () => {
  /**
   * The picker and the activity grid have to agree on who exists. `readRows()`
   * in activity-export.ts selects `role = 'rep'`, so an admin offered here was
   * a selection that rendered an empty report with nothing to explain it.
   */
  it("asks only for reps", () => {
    const text = src("closing-report.ts");
    const body = text.slice(text.indexOf("export async function listReps"));

    expect(body).toContain('.eq("role", "rep")');
  });
});
