import { describe, expect, it } from "vitest";
import {
  parseCallActivityFilters,
  parseCallActivitySort,
  totalsRow,
} from "@/lib/call-activity-report";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";

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

describe("parseCallActivityFilters — sane fallbacks, never a crash", () => {
  const VALID_STATUS = "Session scheduled";

  it("empty: nothing in the URL means nothing is filtered, and no notice", () => {
    const { filters, notices } = parseCallActivityFilters({}, SEED_STATUS_CATALOGUE);
    expect(filters).toEqual({
      from: undefined,
      to: undefined,
      member: undefined,
      institute: undefined,
      status: undefined,
    });
    expect(notices).toEqual([]);
  });

  it("an invalid From date is dropped, with a notice, and does not block To", () => {
    const { filters, notices } = parseCallActivityFilters(
      { from: "not-a-date", to: "2026-10-20" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBe("2026-10-20");
    expect(notices).toContain("That From date was not valid, so it was ignored.");
  });

  it("an invalid To date is dropped the same way", () => {
    const { filters, notices } = parseCallActivityFilters(
      { to: "2026-13-40" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.to).toBeUndefined();
    expect(notices).toContain("That To date was not valid, so it was ignored.");
  });

  it("From after To drops BOTH dates, with one explaining notice", () => {
    const { filters, notices } = parseCallActivityFilters(
      { from: "2026-10-20", to: "2026-10-01" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    expect(notices).toContain(
      "The To date must not be before the From date, so the date range was ignored.",
    );
  });

  it("a valid range the right way round is kept exactly, with no notice", () => {
    const { filters, notices } = parseCallActivityFilters(
      { from: "2026-10-01", to: "2026-10-20" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.from).toBe("2026-10-01");
    expect(filters.to).toBe("2026-10-20");
    expect(notices).toEqual([]);
  });

  it("an unknown status id is dropped, with a notice", () => {
    const { filters, notices } = parseCallActivityFilters(
      { status: "Made up status" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.status).toBeUndefined();
    expect(notices).toContain("That status is no longer available, so it was ignored.");
  });

  it("a status in the live catalogue is kept, with no notice", () => {
    const { filters, notices } = parseCallActivityFilters(
      { status: VALID_STATUS },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.status).toBe(VALID_STATUS);
    expect(notices).toEqual([]);
  });

  it("a malformed representative id is dropped, with a notice", () => {
    const { filters, notices } = parseCallActivityFilters(
      { member: "not-a-uuid" },
      SEED_STATUS_CATALOGUE,
    );
    expect(filters.member).toBeUndefined();
    expect(notices).toContain("That representative could not be identified, so it was ignored.");
  });

  it("a well-formed representative id passes through untouched", () => {
    const id = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
    const { filters, notices } = parseCallActivityFilters({ member: id }, SEED_STATUS_CATALOGUE);
    expect(filters.member).toBe(id);
    expect(notices).toEqual([]);
  });

  it("the institute text is trimmed, and blank-after-trim means absent", () => {
    expect(
      parseCallActivityFilters({ institute: "  Greenfield  " }, SEED_STATUS_CATALOGUE).filters
        .institute,
    ).toBe("Greenfield");
    expect(
      parseCallActivityFilters({ institute: "   " }, SEED_STATUS_CATALOGUE).filters.institute,
    ).toBeUndefined();
  });

  it("never throws, for any combination of bad input at once", () => {
    expect(() =>
      parseCallActivityFilters(
        {
          from: "nope",
          to: "nope",
          member: "nope",
          status: "nope",
          institute: "  ",
        },
        SEED_STATUS_CATALOGUE,
      ),
    ).not.toThrow();
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
