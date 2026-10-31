import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * /api/export/call-activity (Part 4) — admin OR team lead, never a rep; a
 * team lead's file contains only their own reps.
 *
 * NO DOM, NO SUPABASE HERE (vitest.config.mts documents the split), so this
 * reads the source rather than calling the route: the gate must be
 * `requireStaff()` (the SAME permission the on-screen table already has,
 * Part 2), not `requireAdmin()`. `/api/export/activity` and
 * `/api/export/institute-activity` now use the same `requireStaff()` gate —
 * see activity-export-route.test.ts for that route's own assertion. "A team
 * lead sees only their own reps" is proven at the SQL level
 * (tests/integration/rules.test.ts's call_activity_report() Team Lead
 * scoping block, and the rehearsal-DB check in this part's evidence) because
 * that is RLS/`supervises()`'s property, not this route's — this file only
 * proves the route does not reach around it.
 */

const route = readFileSync(
  fileURLToPath(new URL("../../src/app/api/export/call-activity/route.ts", import.meta.url)),
  "utf8",
);

const exportBuilder = readFileSync(
  fileURLToPath(new URL("../../src/lib/exports/call-activity-export.ts", import.meta.url)),
  "utf8",
);

describe("/api/export/call-activity", () => {
  it("gates on requireStaff(), not requireAdmin() — a rep is refused, a team lead is not", () => {
    expect(route).toContain("const gate = await requireStaff();");
    // Not merely "the string doesn't appear" (the header comment names the
    // OTHER route's gate for contrast) — the IMPORT line is the real check.
    expect(route).not.toMatch(/import\s*\{[^}]*requireAdmin[^}]*\}\s*from\s*"@\/lib\/admin"/);
  });

  it("answers a failed gate with 403, the same convention /api/export/activity uses", () => {
    const gateCheck = route.slice(route.indexOf("const gate"), route.indexOf("const params"));
    expect(gateCheck).toContain("status: 403");
  });

  it("is its own route, never importing the Visit/Activity export's builder", () => {
    expect(route).not.toMatch(/from\s*"@\/lib\/exports\/activity-export"/);
    expect(route).toContain('from "@/lib/exports/call-activity-export"');
  });

  it("validates filters against the live catalogue before building the file", () => {
    expect(route).toContain("listStatusCatalogue()");
    expect(route).toContain("parseCallActivityFilters(");
  });
});

describe("buildCallActivityExport()", () => {
  it("calls the SAME RPC the on-screen table uses — never a second, unscoped query", () => {
    expect(exportBuilder).toContain('rpc("call_activity_report"');
  });

  it("asks for every row in one call (p_page: 0), never loops over per-call data", () => {
    expect(exportBuilder).toContain("p_page: 0");
    expect(exportBuilder).not.toMatch(/for\s*\([\s\S]*p_page/);
  });

  it("reuses shapeRpcPayload() rather than re-deriving reps/columns itself", () => {
    expect(exportBuilder).toContain("shapeRpcPayload(");
  });
});
