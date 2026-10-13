import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { previewWindow } from "@/lib/list-preview";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("previewWindow", () => {
  const rows = ["a", "b", "c", "d", "e"];

  it("shows the whole list when no limit is asked for", () => {
    const window = previewWindow(rows, undefined, false);
    expect(window.canToggle).toBe(false);
    expect(window.visible).toBe(rows);
  });

  it("shows the whole list when it already fits", () => {
    const window = previewWindow(rows, 5, false);
    expect(window.canToggle).toBe(false);
    expect(window.visible).toBe(rows);
  });

  it("caps the preview and returns every row, unchanged, once expanded", () => {
    const closed = previewWindow(rows, 3, false);
    expect(closed.canToggle).toBe(true);
    expect(closed.visible).toEqual(["a", "b", "c"]);

    const open = previewWindow(rows, 3, true);
    expect(open.visible).toBe(rows);
    expect(open.visible).toHaveLength(rows.length);
  });
});

describe("the member hub is the only screen that previews these two lists", () => {
  const hub = read("src/app/(app)/team/[memberId]/page.tsx");
  const pending = read("src/app/(app)/pending/page.tsx");
  const report = read("src/app/(app)/report/page.tsx");

  it("passes a preview limit into Follow-ups owed and Field presence", () => {
    expect(hub).toContain("preview={FOLLOW_UPS_SHOWN}");
    expect(hub).toContain("presencePreview={PRESENCE_SHOWN}");
    expect(hub).toContain("const FOLLOW_UPS_SHOWN = 3");
    expect(hub).toContain("const PRESENCE_SHOWN = 3");
  });

  it("leaves Pending and the activity report showing every row", () => {
    expect(pending).not.toContain("preview=");
    expect(report).not.toContain("presencePreview");
  });
});
