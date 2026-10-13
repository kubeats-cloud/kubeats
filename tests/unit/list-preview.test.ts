import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { previewNamedList, previewWindow } from "@/lib/list-preview";

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

describe("previewNamedList — Settings Team, search then cap", () => {
  const people = [
    { name: "Anita Rao", email: "anita@example.com" },
    { name: "Bharat Singh", email: "bharat@ku.edu" },
    { name: "Chitra Nair", email: "chitra.nair@example.com" },
    { name: "Deepak Shah", email: "deepak@example.com" },
    { name: "Esha Patel", email: "esha@ku.edu" },
    { name: "Farhan Ali", email: "farhan@example.com" },
    { name: "Gauri Iyer", email: "gauri@example.com" },
    { name: "Harsh Mehta", email: "harsh@ku.edu" },
    { name: "Isha Khan", email: "isha@example.com" },
    { name: "Jatin Bose", email: "jatin@example.com" },
    { name: "Kavya Menon", email: "kavya@ku.edu" },
    { name: "Lalit Verma", email: "lalit@example.com" },
  ];

  it("filters by name, case-insensitively", () => {
    const window = previewNamedList(people, "anitA", false);
    expect(window.matched.map((p) => p.name)).toEqual(["Anita Rao"]);
    expect(window.visible).toEqual(window.matched);
    expect(window.canToggle).toBe(false);
  });

  it("filters by email, case-insensitively", () => {
    const window = previewNamedList(people, "KU.EDU", false);
    expect(window.matched.map((p) => p.email)).toEqual([
      "bharat@ku.edu",
      "esha@ku.edu",
      "harsh@ku.edu",
      "kavya@ku.edu",
    ]);
  });

  it("caps an unfiltered list at ten and View all returns every row", () => {
    const closed = previewNamedList(people, "", false);
    expect(closed.matched).toBe(people);
    expect(closed.canToggle).toBe(true);
    expect(closed.visible).toHaveLength(10);
    expect(closed.visible).toEqual(people.slice(0, 10));

    const open = previewNamedList(people, "", true);
    expect(open.visible).toBe(people);
    expect(open.visible).toHaveLength(people.length);
  });

  it("caps search matches the same way: ten until View all shows every match", () => {
    const closed = previewNamedList(people, "example.com", false);
    expect(closed.matched).toHaveLength(8);
    expect(closed.canToggle).toBe(false);
    expect(closed.visible).toEqual(closed.matched);

    const many = [
      ...people,
      { name: "Mira Das", email: "mira@example.com" },
      { name: "Neel Roy", email: "neel@example.com" },
      { name: "Omar Qureshi", email: "omar@example.com" },
    ];
    const capped = previewNamedList(many, "example.com", false);
    expect(capped.matched).toHaveLength(11);
    expect(capped.canToggle).toBe(true);
    expect(capped.visible).toHaveLength(10);

    const revealed = previewNamedList(many, "example.com", true);
    expect(revealed.visible).toEqual(revealed.matched);
    expect(revealed.visible).toHaveLength(11);
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
