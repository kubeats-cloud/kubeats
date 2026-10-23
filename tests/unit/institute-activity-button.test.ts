import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("src/app/(app)/institutes/page.tsx", "utf8");

function headerAction() {
  const start = page.indexOf("action={");
  return page.slice(start, page.indexOf("}\n      />", start));
}

describe("the Institute Activity button beside Register", () => {
  it("is granted to staff, which is an admin or a team lead", () => {
    expect(page).toContain("isStaff");
    expect(page).toContain("const staff = isStaff(user);");
    expect(page).toContain("{staff && !activityView && (");
  });

  it("sits in the header action next to Register and opens the staff report", () => {
    const action = headerAction();
    expect(action).toContain("Institute Activity");
    expect(action).toContain('href="/institutes?view=activity"');
    expect(action).toContain("Register");
    expect(action.indexOf("Institute Activity")).toBeLessThan(
      action.indexOf("Register"),
    );
  });

  it("is not shown to a rep, whose branch has the download instead", () => {
    expect(headerAction()).not.toContain("isRep");
    expect(page).toContain(") : !isRep ? (");
  });
});
