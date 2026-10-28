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

/**
 * Part 3 — the filter bar: above the table, its own query params, server-
 * side (a navigation, never a client-side row filter).
 */
describe("the Call Activity Report's filter bar", () => {
  it("sits above the table, below the heading", () => {
    const headingIndex = page.indexOf("Call Activity Report");
    const filtersIndex = page.indexOf("<CallActivityFilters");
    const gridIndex = page.indexOf("<CustomisableGrid");
    expect(headingIndex).toBeGreaterThan(-1);
    expect(filtersIndex).toBeGreaterThan(headingIndex);
    expect(gridIndex).toBeGreaterThan(filtersIndex);
  });

  it("reads all five of its own query params, none shared with the register above", () => {
    for (const key of ["callFrom", "callTo", "callMember", "callInstitute", "callStatus"]) {
      expect(page).toContain(key);
    }
  });

  it("validates filters against the live catalogue before calling the RPC", () => {
    expect(page).toContain("parseCallActivityFilters(");
  });
});

describe("CallActivityFilters component", () => {
  const component = readFileSync(
    fileURLToPath(
      new URL("../../src/components/report/call-activity-filters.tsx", import.meta.url),
    ),
    "utf8",
  );

  it("is a client component with Apply and Clear, not an instant-apply filter", () => {
    expect(component).toContain('"use client"');
    expect(component).toMatch(/>\s*Apply\s*</);
    expect(component).toContain("Clear");
    // The regression this guards: VisitReview's own Selects call `apply()`
    // directly from onValueChange. This filter bar must not.
    expect(component).not.toMatch(/onValueChange=\{\(v\)\s*=>\s*apply\(/);
  });

  it("filters Institute with a name-contains text box, not a Select of every institute", () => {
    const field = component.slice(
      component.indexOf('label="Institute"'),
      component.indexOf('label="Call Status"'),
    );
    expect(field).toContain("<Input");
    expect(field).not.toContain("<Select");
  });

  it("navigates via router.push rather than filtering rows it already has", () => {
    expect(component).toContain("router.push(");
    // `.filter(` legitimately appears once, counting non-empty draft values
    // for the "Clear N filters" label — never applied to `reps` or `rows`.
    expect(component).not.toMatch(/\breps\.filter\(|\brows\.filter\(/);
  });
});
