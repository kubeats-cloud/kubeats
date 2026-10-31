import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Settings reorg, part 1: a compact Purposes card, a compact Locations card,
 * and the Target Status vocabulary promoted onto Settings.
 *
 * Same testing shape as the activity and settings-mutation suites: this
 * project has no DOM environment on purpose (vitest.config.mts documents the
 * split), so a change made mostly of wiring is asserted against the real
 * source. The database half — that both Target Status placements read the same
 * table — is integration's question.
 */
function read(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

const collapsible = read("src/components/activity/collapsible-section.tsx");
const purposes = read("src/components/settings/purposes-panel.tsx");
const locations = read("src/components/settings/locations-panel.tsx");
const settingsPage = read("src/app/(app)/settings/page.tsx");
const targetActions = read("src/lib/target-status-actions.ts");
const statusesPanel = read("src/components/settings/statuses-panel.tsx");

describe("CollapsibleSection gains a folded-by-default mode", () => {
  it("keeps the contract the Activity tab was built on", () => {
    expect(collapsible).toContain("useState(false)");
    expect(collapsible).toContain("hidden={collapsed}");
    expect(collapsible).toContain("aria-expanded={!collapsed}");
  });

  it("still starts open unless a caller asks otherwise", () => {
    expect(collapsible).toContain("defaultCollapsed = false");
  });

  it("lets a caller say what the two states are called", () => {
    expect(collapsible).toContain("showLabel");
    expect(collapsible).toContain("hideLabel");
  });
});

describe("Purposes previews three rows and folds the rest", () => {
  it("slices the loaded list rather than dropping or re-querying rows", () => {
    expect(purposes).toContain("const PURPOSES_PREVIEW = 3");
    expect(purposes).toContain("purposes.slice(0, PURPOSES_PREVIEW)");
    expect(purposes).toContain("purposes.slice(PURPOSES_PREVIEW)");
  });

  it("puts the remainder in a folded CollapsibleSection", () => {
    expect(purposes).toMatch(
      /<CollapsibleSection[\s\S]*?defaultCollapsed[\s\S]*?showLabel=\{`View all \$\{purposes\.length\} purposes`\}[\s\S]*?hideLabel="Show less"/,
    );
  });

  it("keeps retire and restore on every row, wherever the row sits", () => {
    expect(purposes).toContain("setRetireState(");
    expect(purposes).toContain("await setPurposeActive(");
    expect(purposes).toContain('"Retire"');
    expect(purposes).toContain("Restore");
  });

  it("keeps the add form, captured before it clears itself", () => {
    const capture = purposes.indexOf("new FormData(event.currentTarget)");
    const dispatch = purposes.indexOf("formAction(formData)");
    expect(dispatch).toBeGreaterThan(capture);
    expect(purposes.lastIndexOf('setActivity("")')).toBeGreaterThan(capture);
  });
});

describe("Locations folds a long area list and leaves the drill-down alone", () => {
  it("previews three areas and folds the rest", () => {
    expect(locations).toContain("const AREAS_PREVIEW = 3");
    expect(locations).toContain("city.areas.slice(0, AREAS_PREVIEW)");
    expect(locations).toContain("city.areas.slice(AREAS_PREVIEW)");
    expect(locations).toMatch(/<CollapsibleSection[\s\S]*?defaultCollapsed/);
  });

  it("keeps State, City and Area pickers and all three add rows", () => {
    for (const marker of [
      'id="state-picker"',
      'id="city-picker"',
      "addState",
      "addCity",
      "addArea",
    ]) {
      expect(locations).toContain(marker);
    }
  });

  it("keeps a Remove button on every area, folded or not", () => {
    expect(locations).toContain('<RemoveButton kind="area"');
  });

  it("resets the fold when the selected city changes", () => {
    expect(locations).toContain("key={city.id}");
  });
});

describe("Settings: Purposes has its own section, Target Status is added", () => {
  it("labels the purposes section 'Add a Purpose' and leaves Shared lists behind", () => {
    const heading = settingsPage.indexOf(">Add a Purpose<");
    const panel = settingsPage.indexOf("<PurposesPanel");
    expect(heading).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(heading);
    expect(settingsPage).not.toContain(">Shared lists<");
  });

  it("renders the same TargetStatusesPanel component the Targets tab uses", () => {
    expect(settingsPage).toContain(
      'from "@/components/weekly/target-statuses-panel"',
    );
    expect(settingsPage).toContain("<TargetStatusesPanel");
    expect(settingsPage).toContain("canAdd");
    expect(settingsPage).toContain(
      "statuses={targetStatuses.ok ? targetStatuses.statuses : []}",
    );
  });

  it("loads the same reader rather than a second query", () => {
    expect(settingsPage).toContain("listTargetStatusRows()");
    expect(settingsPage).toContain('"settings:target-statuses"');
  });

  it("says a failed load failed, instead of showing an empty vocabulary", () => {
    expect(settingsPage).toContain("Target statuses could not be loaded.");
  });
});

describe("a Target Status write refreshes both screens that show it", () => {
  it("revalidates /targets and /settings from add and from re-scope", () => {
    const targets = targetActions.match(/revalidatePath\("\/targets"\)/g) ?? [];
    const settings = targetActions.match(/revalidatePath\("\/settings"\)/g) ?? [];
    expect(targets).toHaveLength(2);
    expect(settings).toHaveLength(2);
  });
});

describe("Status Management (institute_statuses) is out of scope in this part", () => {
  it("still folds its own details element, not the shared primitive", () => {
    expect(statusesPanel).toContain("<details");
    expect(statusesPanel).not.toContain("CollapsibleSection");
  });
});
