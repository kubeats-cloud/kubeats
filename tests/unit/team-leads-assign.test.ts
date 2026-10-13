import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Admin 4: Settings' "Who created whom" became "Team Leads Assign", and the
 * screen behind it shows teams (`team_lead_id`) only. The `created_by` chart is
 * retired from the UI; the assignment path is unchanged.
 */

const path = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(path(p), "utf8");
const tsCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("Team Leads Assign", () => {
  it("labels the Settings link Team Leads Assign", () => {
    const panel = tsCode("src/components/settings/team-panel.tsx");
    expect(panel).toContain("Team Leads Assign");
    expect(panel).not.toContain("Who created whom");
    expect(panel).toContain('href="/team/hierarchy"');
  });

  it("labels the Team and member-hub buttons the same way", () => {
    for (const p of ["src/app/(app)/team/page.tsx", "src/app/(app)/team/[memberId]/page.tsx"]) {
      const code = tsCode(p);
      expect(code, p).toMatch(/href="\/team\/hierarchy">\s*<NetworkIcon[^>]*\/>\s*Team Leads Assign/);
      expect(code, p).not.toMatch(/\bHierarchy\s*<\/Link>/);
    }
  });

  it("renders the team structure and not the created_by chart", () => {
    const page = tsCode("src/app/(app)/team/hierarchy/page.tsx");
    expect(page).toContain("<TeamStructure");
    expect(page).not.toContain("HierarchyChart");
    expect(page).toContain('title="Team Leads Assign"');
    expect(existsSync(path("src/components/admin/hierarchy-chart.tsx"))).toBe(false);
  });

  it("still assigns through the existing action", () => {
    const structure = tsCode("src/components/admin/team-structure.tsx");
    expect(structure).toMatch(/useActionState\(\s*assignRepToTeam/);
    expect(structure).toContain("r.teamLeadId === lead.id");
    expect(structure).toContain("Nobody on this team yet.");
  });
});
