import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { repsMatchingName } from "@/lib/team-rep-search";

const reps = [
  { name: "Meera Shah" },
  { name: "Arun Desai" },
  { name: "anita nair" },
];

describe("repsMatchingName", () => {
  it("returns every rep when the query is empty or only spaces", () => {
    expect(repsMatchingName(reps, "")).toEqual(reps);
    expect(repsMatchingName(reps, "   ")).toEqual(reps);
  });

  it("matches a partial name without caring about case", () => {
    expect(repsMatchingName(reps, "sha").map((rep) => rep.name)).toEqual([
      "Meera Shah",
    ]);
    expect(repsMatchingName(reps, "MEERA").map((rep) => rep.name)).toEqual([
      "Meera Shah",
    ]);
    expect(repsMatchingName(reps, "AnI").map((rep) => rep.name)).toEqual([
      "anita nair",
    ]);
  });

  it("matches nothing when no rep's name contains the query", () => {
    expect(repsMatchingName(reps, "zzz")).toEqual([]);
  });
});

describe("Admin Team search placement", () => {
  const page = readFileSync("src/app/(app)/team/page.tsx", "utf8");
  const search = readFileSync(
    "src/components/dashboard/team-rep-search.tsx",
    "utf8",
  );

  it("shows the search only for an admin, and keeps requireStaff", () => {
    expect(page).toContain("requireStaff");
    expect(page).not.toContain("requireAdmin");
    expect(page).toContain("gate.isAdmin && team.ok");
    expect(page).toContain("<AdminTeamWeek");
    expect(page).toContain("<TeamSnapshot");
  });

  it("uses the exact empty-state sentence and the loaded team rows", () => {
    expect(search).toContain('title="No Rep found"');
    expect(search).toContain("repsMatchingName(members, query)");
  });
});
