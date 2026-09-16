import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  AUTH_PATHS,
  PUBLIC_PATHS,
  REP_NAV,
  isActive,
  isAdminOnlyPath,
  isAuthPath,
  isPublicPath,
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
    // Out of the BAR, not out of reach: an admin gets to Pending from the
    // Overview's "Go to" list, the same way they reach /report and /data.
    // Six tabs is the constraint here, not permission.
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
    expect(isRepOnlyPath("/log/anything")).toBe(true);
  });

  /*
   * STAGE 5B'S REACHABILITY, PINNED.
   *
   * `/pending` was rep-only, and both of its pages were written to serve an
   * admin — the team-wide read-only list with "Assign this follow-up" on it,
   * and the report reader that ends its ownership check with
   * `!mine && !isAdmin(user)`. The gate was the only thing in the way, so the
   * feature redirected to `/` and could not be used at all. Putting it back on
   * this list would break it again silently, which is why this is a test and
   * not a comment.
   */
  it("leaves Pending open to an admin, index and report alike", () => {
    expect(isRepOnlyPath("/pending")).toBe(false);
    expect(isRepOnlyPath("/pending/8b1a9953-4c22-4d1f-9b1a-99534c224d1f")).toBe(false);
    // Shared, not handed over: a rep must still reach it.
    expect(isAdminOnlyPath("/pending")).toBe(false);
    expect(isAdminOnlyPath("/pending/8b1a9953-4c22-4d1f-9b1a-99534c224d1f")).toBe(false);
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
    for (const path of ["/", "/institutes", "/institutes/new", "/weekly", "/pending"]) {
      expect(isAdminOnlyPath(path), path).toBe(false);
      expect(isRepOnlyPath(path), path).toBe(false);
    }
  });
});

describe("the signed-out surface", () => {
  it("lets a stranger reach only the login and privacy screens", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    // Everything else is behind the gate. /targets is named explicitly because
    // it is the screen that most recently changed shape.
    for (const path of ["/", "/targets", "/log", "/team", "/institutes", "/settings"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("bounces a signed-in user off login but NOT off privacy", () => {
    // THE WHOLE REASON THESE ARE TWO LISTS. A rep who wants to know what is
    // recorded about them must be able to read /privacy while signed in;
    // sending them to the dashboard would answer a fair question with a shrug.
    expect(isAuthPath("/login")).toBe(true);
    expect(isAuthPath("/privacy")).toBe(false);
  });

  it("keeps every auth path inside the public set", () => {
    // An AUTH_PATH that was not also public would be unreachable in both
    // states: redirected to /login when signed out, redirected to / when in.
    for (const path of AUTH_PATHS) {
      expect(PUBLIC_PATHS as readonly string[], path).toContain(path);
    }
  });

  it("never exposes a role-gated route as public", () => {
    for (const path of PUBLIC_PATHS) {
      expect(isAdminOnlyPath(path), path).toBe(false);
      expect(isRepOnlyPath(path), path).toBe(false);
    }
  });

  it("matches children of a public path, not merely look-alikes", () => {
    expect(isPublicPath("/privacy/cookies")).toBe(true);
    // The boundary check, same trap the role guards document.
    expect(isPublicPath("/privacy-policy-elsewhere")).toBe(false);
    expect(isPublicPath("/loginz")).toBe(false);
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
