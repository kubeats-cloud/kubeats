import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One member editor, two doors.
 *
 * The addendum asks for the EXISTING Edit form (name, campus, role) on each
 * Team-tab row and forbids a second form. That is a source-level property:
 * both surfaces must mount `MemberEditDialog`, and only that component may
 * import the `updateMember` action — a second copy would show up here as a
 * second import.
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), "utf8");

const dialog = () => read("components/settings/member-edit-dialog.tsx");

describe("the one member edit form", () => {
  it("carries name, campus and the role dropdown", () => {
    const form = dialog();
    expect(form).toContain('name="name"');
    expect(form).toContain('name="campus_id"');
    expect(form).toContain('name="role"');
    expect(form).toContain('id="edit-role"');
    for (const role of ["rep", "team_lead"]) {
      expect(form).toContain(`<SelectItem value="${role}">`);
    }
  });

  it("is the only place that submits updateMember", () => {
    expect(dialog()).toContain("updateMember");
    const settings = read("components/settings/team-panel.tsx");
    expect(settings).not.toContain("updateMember");
    expect(settings).toContain("<MemberEditDialog");
  });

  it("is opened from Settings through the shared component", () => {
    const settings = read("components/settings/team-panel.tsx");
    expect(settings).toContain(
      'from "@/components/settings/member-edit-dialog"',
    );
    expect(settings).toContain("member={editing}");
    expect(settings).toContain("campuses={campuses}");
  });
});

describe("the Team tab's rows open it", () => {
  it("mounts the same dialog from the admin list", () => {
    const list = read("components/dashboard/team-rep-search.tsx");
    expect(list).toContain('from "@/components/settings/member-edit-dialog"');
    expect(list).toContain("<MemberEditDialog");
    // The trigger is per row, but there is one dialog for the list.
    expect(list).toContain("renderAction={(memberId) =>");
  });

  it("renders a row action only when the caller supplies one", () => {
    const snapshot = read("components/dashboard/team-snapshot.tsx");
    expect(snapshot).toContain("renderAction?: (memberId: string) => ReactNode");
    // Both presentations: the mobile card and the desktop row.
    expect(snapshot).toContain("renderAction?.(row.id)");
    expect(snapshot).toContain("{renderAction(row.id)}");;
  });

  it("gives the admin page the account records and campuses", () => {
    const page = read("app/(app)/team/page.tsx");
    expect(page).toContain("listTeamMembers()");
    expect(page).toContain("listCampuses()");
    expect(page).toContain("editableMembers={editableMembers}");
    expect(page).toContain("campuses={campuses}");
    // Both reads are inside the admin branch, so a team lead requests neither.
    expect(page).toMatch(/gate\.isAdmin\s*\?\s*settled<TeamMember\[\]>/);
    expect(page).toMatch(/gate\.isAdmin\s*\?\s*settled<Campus\[\]>/);
  });

  it("keeps the team lead's table free of an edit action", () => {
    const page = read("app/(app)/team/page.tsx");
    const leadBranch = page.slice(page.indexOf(") : ("));
    expect(leadBranch).toContain("<TeamSnapshot");
    expect(leadBranch).not.toContain("renderAction");
    expect(leadBranch).not.toContain("MemberEditDialog");
  });
});
