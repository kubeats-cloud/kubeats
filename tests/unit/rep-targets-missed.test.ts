import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { remaining } from "@/lib/validation/weekly";

describe("D3 — Remaining when no target is set", () => {
  const form = readFileSync("src/components/weekly/targets-form.tsx", "utf8");

  it("shows an em dash instead of 0 when the target is blank", () => {
    expect(form).toContain('{target > 0 ? remaining(done, target) : "—"}');
    expect(form).not.toContain("Remaining: {remaining(done, target)}");
  });

  it("keeps the arithmetic for a target that was set", () => {
    expect(remaining(2, 5)).toBe(3);
    expect(remaining(7, 5)).toBe(0);
  });
});

describe("D4 — the missed record is labelled as a 30-day window", () => {
  const page = readFileSync("src/app/(app)/missed/page.tsx", "utf8");
  const pending = readFileSync("src/app/(app)/pending/page.tsx", "utf8");

  it("names the page and its browser tab for the last 30 days", () => {
    expect(page).toContain(
      'export const metadata = { title: "Missed in the last 30 days" };',
    );
    expect(page).toContain('title="Missed in the last 30 days"');
    expect(page).not.toContain('title="Missed follow-ups"');
  });

  it("uses the same label on the Pending link that opens it", () => {
    expect(pending).toContain("Missed in the last 30 days");
    expect(pending).not.toContain("Missed follow-ups");
  });
});
