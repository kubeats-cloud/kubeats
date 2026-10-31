import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * /api/export/activity — admin OR team lead, never a rep.
 *
 * Used to gate on `requireAdmin()`, which refused a team lead a download of
 * the exact table they could already see on screen (the Overview's rep
 * activity report and /team/report both render for `requireStaff()`). Widened
 * to `requireStaff()`, the same gate `/api/export/call-activity` and
 * `/api/export/institute-activity` already use.
 *
 * NO DOM, NO SUPABASE HERE (vitest.config.mts documents the split), so this
 * reads the source rather than calling the route. "A team lead's file
 * contains only their own reps" is RLS/`supervises()`'s property (visits,
 * daily_plans and profiles have been supervises()-scoped since migration
 * 0042) — this file only proves the route does not reach around it.
 */

const route = readFileSync(
  fileURLToPath(new URL("../../src/app/api/export/activity/route.ts", import.meta.url)),
  "utf8",
);

describe("/api/export/activity", () => {
  it("gates on requireStaff(), not requireAdmin() — a rep is refused, a team lead is not", () => {
    expect(route).toContain("const gate = await requireStaff();");
    expect(route).not.toMatch(/import\s*\{[^}]*requireAdmin[^}]*\}\s*from\s*"@\/lib\/admin"/);
  });

  it("answers a failed gate with 403", () => {
    const gateCheck = route.slice(route.indexOf("const gate"), route.indexOf("const params"));
    expect(gateCheck).toContain("status: 403");
  });

  it("never widens the key the queries run under", () => {
    // The gate failing open must still leave RLS as the only thing deciding
    // rows — never an elevated key that would hand a team lead the whole
    // company's numbers instead of their own reps'.
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
