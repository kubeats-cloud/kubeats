import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  REP_NAV,
  isActive,
  isAdminOnlyPath,
  isRepOnlyPath,
  navItemsFor,
} from "@/lib/nav";

/**
 * The role split.
 *
 * These helpers are the single source the navigation, `proxy.ts` and each
 * page's own guard all read from, so a screen cannot appear in one role's bar
 * and stay reachable by the other. That makes them worth testing directly:
 * everything else about the split is downstream of what is asserted here.
 */

describe("navItemsFor", () => {
  it("gives a rep the fieldwork screens", () => {
    const hrefs = navItemsFor(false).map((i) => i.href);
    expect(hrefs).toContain("/log");
    expect(hrefs).toContain("/pending");
  });

  it("gives an admin the workspace and none of the fieldwork", () => {
    const hrefs = navItemsFor(true).map((i) => i.href);
    expect(hrefs).toContain("/review");
    expect(hrefs).toContain("/assign");
    expect(hrefs).toContain("/team");
    expect(hrefs).not.toContain("/log");
    expect(hrefs).not.toContain("/pending");
  });

  it("never shows a rep an admin screen", () => {
    for (const item of navItemsFor(false)) {
      expect(isAdminOnlyPath(item.href), item.href).toBe(false);
    }
  });

  it("never shows an admin a rep-only screen", () => {
    for (const item of navItemsFor(true)) {
      expect(isRepOnlyPath(item.href), item.href).toBe(false);
    }
  });

  it("keeps both bars small enough to sit in a phone's thumb bar", () => {
    expect(REP_NAV.length).toBeLessThanOrEqual(6);
    expect(ADMIN_NAV.length).toBeLessThanOrEqual(6);
  });
});

describe("path guards", () => {
  it("catches the rep-only routes and their children", () => {
    expect(isRepOnlyPath("/log")).toBe(true);
    expect(isRepOnlyPath("/pending")).toBe(true);
    expect(isRepOnlyPath("/pending/8b1a9953-4c22-4d1f-9b1a-99534c224d1f")).toBe(true);
  });

  it("catches the admin-only routes and their children", () => {
    for (const path of ["/review", "/assign", "/team", "/data", "/settings"]) {
      expect(isAdminOnlyPath(path), path).toBe(true);
      expect(isAdminOnlyPath(`${path}/anything`), path).toBe(true);
    }
  });

  it("does not catch a route that merely starts with the same letters", () => {
    // "/reviewer" is not "/review", and a prefix match without the boundary
    // would quietly gate a route nobody meant to gate.
    expect(isAdminOnlyPath("/reviewer")).toBe(false);
    expect(isRepOnlyPath("/logbook")).toBe(false);
  });

  it("leaves the shared screens open to both", () => {
    for (const path of ["/", "/institutes", "/institutes/new", "/weekly"]) {
      expect(isAdminOnlyPath(path), path).toBe(false);
      expect(isRepOnlyPath(path), path).toBe(false);
    }
  });
});

describe("isActive", () => {
  it("matches the dashboard only exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/review", "/")).toBe(false);
  });

  it("matches a subtree for every other tab", () => {
    expect(isActive("/review/abc", "/review")).toBe(true);
  });
});
