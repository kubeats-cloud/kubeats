import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE STICKY HEADER IS ONE MECHANISM, SO IT IS TESTED AS ONE.
 *
 * A `position: sticky` header sticks to its nearest scrollport, not to the
 * page. Every table here needs horizontal scrolling, and `overflow-x: auto`
 * makes the wrapper a scrollport on both axes — so a header wrapped the old
 * way stuck to a box that never scrolled vertically and slid away with the page.
 * That was invisible in review and visible only to a reader halfway down a
 * long table.
 *
 * `TableFrame` is the fix: a bounded-height scroll box, so the box itself
 * scrolls and the header sticks inside it. These tests guard the three things
 * that make it work and are easy to undo by accident:
 *
 *   1. the height cap that turns the wrapper into a vertical scrollport;
 *   2. the z ladder — header below the Activity toolbar, corner above both rows;
 *   3. adoption — every live table renders through the frame, so a new table
 *      cannot quietly ship the old, inert behaviour.
 */

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

const read = (path: string) =>
  readFileSync(join(SRC, path), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * `institute-activity-table.tsx` is not imported anywhere; the Overview table
 * that replaced it is `InstituteStatusActivityTable`. It is listed here rather
 * than deleted or rewritten, because this change is about the headers readers
 * actually see.
 */
const DEAD_TABLE = "components/report/institute-activity-table.tsx";

const TABLES = [
  "app/(app)/assign/page.tsx",
  "app/(app)/missed/page.tsx",
  "app/(app)/pending/follow-ups/page.tsx",
  "components/admin/visit-review.tsx",
  "components/dashboard/team-snapshot.tsx",
  "components/institutes/institutes-browser.tsx",
  "components/report/activity-grid-table.tsx",
  "components/report/daily-status-history.tsx",
  "components/report/daily-status-report-table.tsx",
  "components/report/institute-presence-table.tsx",
  "components/report/institute-status-activity-table.tsx",
  "components/report/rep-institute-table.tsx",
  "components/settings/team-panel.tsx",
  "components/weekly/admin-target-roster.tsx",
].sort();

describe("TableFrame — the bounded scroll box that makes a header stick", () => {
  const css = read("app/globals.css");
  const start = css.indexOf(".table-frame {");
  const block = css.slice(start, css.indexOf("\n  }", start));

  it("caps the box's height — without that the wrapper never scrolls vertically", () => {
    expect(block).toContain("position: relative");
    expect(block).toContain("overflow: auto");
    expect(block).toContain(
      "max-height: max(18rem, min(70vh, calc(100dvh - 18rem)))",
    );
    // Chained scrolling in a long report would trap the page under the cursor.
    expect(block).toContain("overscroll-behavior: contain");
  });

  it("sticks every header cell, with an opaque background", () => {
    const rule = css.slice(css.indexOf(".table-frame thead th {"));
    expect(rule.slice(0, 160)).toContain("position: sticky");
    expect(rule.slice(0, 160)).toContain("top: 0");
    expect(rule.slice(0, 160)).toContain("background-color: var(--tf-head-bg)");

    /*
     * The old tints were translucent (`bg-muted/60`), which lets scrolled rows
     * show through a stuck header. The tone backgrounds are mixed against the
     * card colour so they stay opaque while looking the same.
     */
    expect(block).toContain(
      "--tf-head-bg: color-mix(in oklab, var(--muted) 60%, var(--card))",
    );
    expect(css).toContain(".table-frame[data-tone=\"secondary\"]");
    expect(css).toContain(".table-frame[data-tone=\"secondary-soft\"]");
    expect(css).toContain(".table-frame[data-tone=\"card\"]");
  });

  it("pins the second header row at the first row's constrained height", () => {
    expect(block).toContain("--tf-head-row-1-h: 2rem");
    expect(block).toContain(
      "--tf-head-row-2-top: calc(var(--tf-head-row-1-h) + 0.5px)",
    );
    expect(css).toContain(
      ".table-frame thead tr.table-head-row-1 > th {",
    );
    expect(css).toContain("white-space: nowrap");
    expect(css).toContain(".table-frame thead tr.table-head-row-2 th");
  });

  it("puts the header below the Activity toolbar and the corner above both rows", () => {
    const z = (token: string) => {
      const match = block.match(new RegExp(`${token}:\\s*(\\d+)`));
      if (!match) throw new Error(`${token} is missing from .table-frame`);
      return Number(match[1]);
    };

    // Body first column < sub-column header < band header < corner.
    expect(z("--tf-col-z")).toBeLessThan(z("--tf-head-row-2-z"));
    expect(z("--tf-head-row-2-z")).toBeLessThan(z("--tf-head-row-1-z"));
    expect(z("--tf-head-row-1-z")).toBeLessThan(z("--tf-corner-z"));

    // The toolbar is z-20 and the top bar z-30; a header must lose to both.
    expect(z("--tf-corner-z")).toBeLessThan(20);
    expect(read("components/activity/activity-toolbar.tsx")).toContain("z-20");
    expect(read("components/layout/top-bar.tsx")).toContain("z-30");
  });

  it("pins only the first header cell of the first row — not the second row's label", () => {
    // Row 2's first cell is a sub-column ("Closed", "In-Field"), not column A.
    expect(css).toContain(
      ".table-frame[data-sticky-first-column] thead tr:first-child > th:first-child",
    );
  });

  it("leaves the height override open, as the compact dashboard card needs", () => {
    const frame = read("components/ui/table-frame.tsx");
    expect(frame).toContain("export function TableFrame");
    expect(frame).toContain("maxHeight?: string");
    expect(frame).toContain("data-tone={tone}");
    expect(frame).toContain("data-sticky-first-column");
  });
});

describe("every live table renders inside the frame", () => {
  it("finds every <table> in src, and all but the unused module are on the list", () => {
    const found = tsxFiles(SRC)
      .filter((file) => readFileSync(file, "utf8").includes("<table"))
      .map((file) => relative(SRC, file).replace(/\\/g, "/"))
      .filter((file) => file !== DEAD_TABLE)
      .sort();

    expect(found).toEqual(TABLES);
  });

  it.each(TABLES)("%s wraps its table and keeps no inert header classes", (path) => {
    const source = read(path);
    expect(source).toMatch(/from ['"]@\/components\/ui\/table-frame['"]/);
    expect(source).toContain("<TableFrame");
    expect(source).toContain("</TableFrame>");

    /*
     * The old pattern: a bare `overflow-x-auto` wrapper with a `sticky top-0`
     * header inside it. `top-0` there sticks to a box that never scrolls
     * vertically, so it did nothing — which is the bug, and which would come
     * back if both patterns were left side by side.
     */
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("sticky top-0");
  });

  it("keeps the sticky first column where it was, on the frame's own flag", () => {
    for (const path of [
      "components/report/activity-grid-table.tsx",
      "components/report/institute-status-activity-table.tsx",
      "components/report/institute-presence-table.tsx",
      "components/report/daily-status-report-table.tsx",
      "components/report/rep-institute-table.tsx",
      "components/weekly/admin-target-roster.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toMatch(/<TableFrame[^>]*stickyFirstColumn/);
      expect(source, path).toContain("sticky left-0");
    }
  });
});

describe("the grouped header in the shared grid", () => {
  const grid = read("components/report/activity-grid-table.tsx");

  it("marks both header rows so the second can pin below the first", () => {
    expect(grid).toContain("table-head-row-1");
    expect(grid).toContain("table-head-row-2");
  });

  it("keeps column A spanning both rows, with the frame owning its paint", () => {
    expect(grid).toContain("rowSpan={index === 0 ? 2 : 1}");
    // The corner used to carry its own sticky/z/background; it no longer does.
    expect(grid).not.toContain('cn(sticky, "bg-secondary")');
  });

  it("reaches all six grid instances through the one component", () => {
    expect(read("components/report/customisable-grid.tsx")).toContain(
      "<ActivityGridTable",
    );
    for (const page of [
      "app/(app)/page.tsx",
      "app/(app)/team/report/page.tsx",
      "app/(app)/institutes/report/page.tsx",
      "components/activity/rep-activity-box.tsx",
      "components/activity/call-activity-box.tsx",
      "components/activity/pipeline-box.tsx",
    ]) {
      expect(read(page), page).toContain("<CustomisableGrid");
    }
  });
});
