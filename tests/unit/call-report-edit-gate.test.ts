import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #0063 — the Call Report edit card is an admin's, never a team lead's or a
 * rep's.
 *
 * NO DOM ENVIRONMENT HERE (vitest.config.mts documents the split), so this
 * reads the two source files rather than rendering them: the page must gate
 * the card on `requireStaff()`'s own `isAdmin` flag (the same split
 * `ReassignOwner` draws on an institute's page, see reassign-candidates
 * .test.ts), and the server action it posts to must call `requireAdmin()` —
 * the strictly admin-only gate — rather than `requireStaff()`, which would
 * let a team lead's request reach the RPC.
 */

const page = readFileSync(
  fileURLToPath(new URL("../../src/app/(app)/review/[id]/page.tsx", import.meta.url)),
  "utf8",
);

const action = readFileSync(
  fileURLToPath(new URL("../../src/lib/call-report-actions.ts", import.meta.url)),
  "utf8",
);

describe("the Call Report edit card is admin-only", () => {
  it("is only rendered when requireStaff()'s isAdmin flag is true", () => {
    expect(page).toContain("gate.isAdmin &&");
    expect(page).toContain("<CallReportEdit");
  });

  it("the page does not render CallReportEdit unconditionally", () => {
    // The regression this guards: moving the component outside the
    // `gate.isAdmin &&` block would hand every team lead the control.
    const editIndex = page.indexOf("<CallReportEdit");
    const gateIndex = page.indexOf("gate.isAdmin &&");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(editIndex).toBeGreaterThan(gateIndex);
  });
});

describe("adminUpdateCallReport() uses the strict admin gate", () => {
  it("calls requireAdmin(), not requireStaff()", () => {
    const fnStart = action.indexOf("export async function adminUpdateCallReport");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = action.slice(fnStart);
    expect(fnBody).toContain("requireAdmin()");
  });

  it("imports requireAdmin from the same module as the reassign action", () => {
    expect(action).toContain('import { requireAdmin } from "@/lib/admin";');
  });
});
