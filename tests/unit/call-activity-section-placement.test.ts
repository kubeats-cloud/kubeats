import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Placement rule (0064): the Call Activity Report is its own section on
 * Review, below the Call/Visit report list, with its own heading — and
 * visible to both admin and team lead (requireStaff() already gates the
 * whole page to those two roles; this section adds no narrower gate, unlike
 * the admin-only edit card on the Call Report detail page, 0063).
 */
const page = readFileSync(
  fileURLToPath(new URL("../../src/app/(app)/review/page.tsx", import.meta.url)),
  "utf8",
);

describe("the Call Activity Report section on Review", () => {
  it("sits below the existing register, not above or inside it", () => {
    const visitReviewIndex = page.indexOf("<VisitReview");
    const headingIndex = page.indexOf("Call Activity Report");
    expect(visitReviewIndex).toBeGreaterThan(-1);
    expect(headingIndex).toBeGreaterThan(visitReviewIndex);
  });

  it("is not wrapped in an isAdmin-only check — a team lead sees it too", () => {
    const headingIndex = page.indexOf("Call Activity Report");
    const nearby = page.slice(Math.max(0, headingIndex - 400), headingIndex);
    expect(nearby).not.toContain("gate.isAdmin &&");
  });

  it("uses its own query params, not the register's", () => {
    expect(page).toContain("callSort");
    expect(page).toContain("callDir");
    expect(page).toContain("callPage");
  });

  it("reuses the Rep Activity Report's grid component", () => {
    expect(page).toContain("<CustomisableGrid");
    expect(page).toContain("showGroupTotals");
  });
});
