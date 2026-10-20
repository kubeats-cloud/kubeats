import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { institutesMatchingQuery } from "@/lib/rep-institute-search";
import type { InstituteActivityRow } from "@/lib/institute-activity-counts";

function row(overrides: Partial<InstituteActivityRow> & { id: string }): InstituteActivityRow {
  return {
    name: "Some Institute",
    type: "school",
    city: null,
    area: null,
    state: null,
    status: null,
    byActivity: {
      meeting: { open: 0, closed: 0 },
      session: { open: 0, closed: 0 },
      campus_visit: { open: 0, closed: 0 },
      olympiad: { open: 0, closed: 0 },
      application: { open: 0, closed: 0 },
      admission: { open: 0, closed: 0 },
    },
    totalActivities: 0,
    meetingsCompleted: 0,
    followUpsOwned: 0,
    followUpsPending: 0,
    totalVisits: 0,
    lastCheckinAt: null,
    lastCheckinArea: null,
    lastCheckoutAt: null,
    lastCheckoutArea: null,
    ...overrides,
  };
}

const rows = [
  row({ id: "a", name: "Gandhinagar Public School", city: "Gandhinagar" }),
  row({ id: "b", name: "Ahmedabad Coaching Centre", city: "Ahmedabad", area: "Navrangpura" }),
  row({ id: "c", name: "Surat Consultants", city: "Surat" }),
];

describe("institutesMatchingQuery", () => {
  it("returns every row when the query is empty or only spaces", () => {
    expect(institutesMatchingQuery(rows, "")).toEqual(rows);
    expect(institutesMatchingQuery(rows, "   ")).toEqual(rows);
  });

  it("matches a partial name without caring about case", () => {
    expect(institutesMatchingQuery(rows, "gandhinagar public").map((r) => r.id)).toEqual(["a"]);
    expect(institutesMatchingQuery(rows, "AHMEDABAD").map((r) => r.id)).toEqual(["b"]);
  });

  it("matches by city or area too", () => {
    expect(institutesMatchingQuery(rows, "surat").map((r) => r.id)).toEqual(["c"]);
    expect(institutesMatchingQuery(rows, "navrangpura").map((r) => r.id)).toEqual(["b"]);
  });

  it("matches nothing when no row contains the query", () => {
    expect(institutesMatchingQuery(rows, "zzz")).toEqual([]);
  });
});

describe("R1 consolidated table placement", () => {
  const page = readFileSync("src/app/(app)/institutes/page.tsx", "utf8");

  it("shows the registry browser only to non-reps, and the one table only to reps", () => {
    expect(page).toContain("{!isRep && (");
    expect(page).toContain("<InstitutesBrowser");
    expect(page).toContain("{isRep && (");
    expect(page).toContain("<RepInstituteSearch");
    // The old two-section rep layout (registry + a separate "Activity
    // summary") must not come back.
    expect(page).not.toContain("Activity summary");
  });
});
