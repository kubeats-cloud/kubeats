import { describe, expect, it } from "vitest";
import { parseCallActivitySort, totalsRow } from "@/lib/call-activity-report";

describe("parseCallActivitySort", () => {
  it("defaults to rep ascending with nothing in the URL", () => {
    expect(parseCallActivitySort(undefined, undefined)).toEqual({ key: "rep", dir: "asc" });
  });

  it("defaults an unrecognised key's direction to descending, not ascending", () => {
    // Matches nextSortDirection()'s own rule: only "rep" starts ascending —
    // a count column sorted for the first time should show the biggest
    // number first, not the smallest.
    expect(parseCallActivitySort("open_total", undefined)).toEqual({
      key: "open_total",
      dir: "desc",
    });
  });

  it("passes through any key — the RPC's own CASE is the validator", () => {
    expect(parseCallActivitySort("status:Not Interested", "asc")).toEqual({
      key: "status:Not Interested",
      dir: "asc",
    });
  });

  it("falls back to a valid direction when the URL's is junk", () => {
    expect(parseCallActivitySort("total", "sideways")).toEqual({
      key: "total",
      dir: "desc",
    });
  });
});

describe("totalsRow", () => {
  it("builds a single RepRow whose statuses are the server's full-population sums", () => {
    const row = totalsRow({
      byStatus: { "First meeting done": 7, "Will not come": 3 },
      openTotal: 7,
      closedTotal: 3,
      total: 10,
    });
    expect(row.statuses).toEqual({ "First meeting done": 7, "Will not come": 3 });
    expect(row.name).toBe("");
  });
});
