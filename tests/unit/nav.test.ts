import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  AUTH_PATHS,
  PUBLIC_PATHS,
  REP_NAV,
  TEAM_LEAD_NAV,
  STAFF_PATHS,
  ADMIN_ONLY_PATHS,
  isStaffOnlyPath,
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
    const hrefs = navItemsFor("rep").map((i) => i.href);
    expect(hrefs).toContain("/log");
    expect(hrefs).toContain("/pending");
  });

  it("gives an admin the workspace and none of the fieldwork", () => {
    const hrefs = navItemsFor("admin").map((i) => i.href);
    expect(hrefs).toContain("/review");
    expect(hrefs).toContain("/assign");
    expect(hrefs).toContain("/team");
    expect(hrefs).not.toContain("/log");
    // Out of the BAR, not out of reach: an admin gets to Pending from the
    // Overview's "Go to" list, the same way they reach /report and /data.
    // Six tabs is the constraint here, not permission.
    expect(hrefs).not.toContain("/pending");
  });

  /**
   * The middle tier's bar is the admin's minus the one thing that has no team
   * dimension. Settings holds the status vocabulary, the purposes and the
   * location tree, all shared by the whole company — a team lead editing them
   * would write across every other team, which is the opposite of "their team
   * only".
   */
  it("gives a team lead the workspace without Settings", () => {
    const hrefs = navItemsFor("team_lead").map((i) => i.href);
    expect(hrefs).toContain("/review");
    expect(hrefs).toContain("/assign");
    expect(hrefs).toContain("/team");
    expect(hrefs).not.toContain("/settings");
    // Not a field role either: no Log Visit, and the proxy refuses it too.
    expect(hrefs).not.toContain("/log");
  });

  it("never shows a rep an admin or staff screen", () => {
    for (const item of navItemsFor("rep")) {
      expect(isAdminOnlyPath(item.href), item.href).toBe(false);
      expect(isStaffOnlyPath(item.href), item.href).toBe(false);
    }
  });

  it("never shows an admin a rep-only screen", () => {
    for (const item of navItemsFor("admin")) {
      expect(isRepOnlyPath(item.href), item.href).toBe(false);
    }
  });

  /**
   * ⚠ EVERY TAB A TEAM LEAD IS GIVEN MUST BE ONE THEY CAN ACTUALLY REACH.
   *
   * This is the assertion that catches the bar and the gate disagreeing — a tab
   * that redirects the moment it is tapped, which is how the old boolean
   * `navItemsFor` would have failed: it had no third answer, so a team lead
   * would have been handed REP_NAV including "Log Visit", a screen the proxy
   * now turns them away from.
   */
  it("gives a team lead nothing the proxy would turn them away from", () => {
    for (const item of navItemsFor("team_lead")) {
      expect(isAdminOnlyPath(item.href), item.href).toBe(false);
      expect(isRepOnlyPath(item.href), item.href).toBe(false);
    }
  });

  it("keeps every bar small enough to sit in a phone's thumb bar", () => {
    expect(REP_NAV.length).toBeLessThanOrEqual(6);
    expect(ADMIN_NAV.length).toBeLessThanOrEqual(6);
    expect(TEAM_LEAD_NAV.length).toBeLessThanOrEqual(6);
  });
});

/* ------------------------------------------------------------------ */

/**
 * The split between the two path lists (H1).
 *
 * THE LINE IS NOT SENIORITY, IT IS WHETHER THE THING HAS A TEAM DIMENSION.
 * Everything in STAFF_PATHS returns rows, and rows belong to somebody, so RLS
 * can narrow them to one team. Everything in ADMIN_ONLY_PATHS manages something
 * the whole company shares and cannot be narrowed at all.
 */
describe("the admin / staff path split", () => {
  it("keeps the three un-scopable surfaces admin-only", () => {
    for (const path of ["/settings", "/data", "/materials/manage"]) {
      expect(isAdminOnlyPath(path), path).toBe(true);
      expect(isStaffOnlyPath(path), path).toBe(false);
    }
  });

  it("opens the three row-shaped workspaces to staff", () => {
    for (const path of ["/review", "/assign", "/team"]) {
      expect(isStaffOnlyPath(path), path).toBe(true);
      expect(isAdminOnlyPath(path), path).toBe(false);
    }
  });

  /** The lists must not overlap, or the proxy's two rules would contradict. */
  it("never puts a path in both lists", () => {
    for (const path of [...STAFF_PATHS, ...ADMIN_ONLY_PATHS]) {
      expect(
        isStaffOnlyPath(path) && isAdminOnlyPath(path),
        `${path} is in both lists`,
      ).toBe(false);
    }
  });

  /**
   * The pipeline report moved from ADMIN_ONLY_PATTERNS to STAFF_PATTERNS, and
   * the anchoring that kept the shared registry out of it must survive the
   * move — `/institutes/x/reporting` is not `/institutes/report`.
   */
  it("moves the pipeline report to staff without widening it", () => {
    expect(isStaffOnlyPath("/institutes/report")).toBe(true);
    expect(isStaffOnlyPath("/institutes/report/anything")).toBe(true);
    expect(isAdminOnlyPath("/institutes/report")).toBe(false);

    expect(isStaffOnlyPath("/institutes")).toBe(false);
    expect(isStaffOnlyPath("/institutes/abc-123")).toBe(false);
    expect(isStaffOnlyPath("/institutes/abc/reporting")).toBe(false);
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

  /**
   * ⚠ ONE LIST BECAME TWO (H1), AND A REP IS TURNED AWAY FROM BOTH.
   *
   * That is the invariant this preserves: before the split a rep was refused
   * all five of these by `isAdminOnlyPath`; now three answer `isStaffOnlyPath`
   * instead, and a gate that checked only the first would let a rep into
   * Review. The proxy checks both, so this asserts both.
   */
  it("catches the workspace routes and their children, in whichever list", () => {
    for (const path of ["/review", "/assign", "/team", "/data", "/settings"]) {
      const gated = (p: string) => isAdminOnlyPath(p) || isStaffOnlyPath(p);
      expect(gated(path), path).toBe(true);
      expect(gated(`${path}/anything`), path).toBe(true);
    }
  });

  /*
   * THE HIERARCHY IS ADMIN-ONLY, AND IT IS GATED BY PREFIX.
   *
   * `/team/hierarchy` is not listed in ADMIN_ONLY_PATHS and does not need to
   * be: `matches()` is prefix-based and `/team` is already there, so the whole
   * subtree is covered — the same way `/team/report` has always been. Adding
   * the child as its own entry would be a second, redundant answer to a
   * question the list already answers, which is the kind of duplication the
   * rest of this file's comments exist to prevent.
   *
   * What is NOT redundant is this assertion. The guarantee the feature needs is
   * "a rep cannot reach the hierarchy", and that guarantee currently rests on
   * `/team` staying on the list. If someone ever takes it off — to make the
   * week snapshot shared, say — this fails and names what else goes with it.
   * `profiles.created_by` is a record and not a permission, but who created
   * whom is still the team's business and not the field's.
   */
  it("keeps the hierarchy behind the workspace gate, through its parent", () => {
    // Staff rather than admin since H1 — /team moved, and the subtree with it.
    // A rep is still refused, which is the guarantee this test exists for; a
    // team lead now reaches it and RLS decides what they see in it.
    expect(isStaffOnlyPath("/team/hierarchy")).toBe(true);
    expect(isRepOnlyPath("/team/hierarchy")).toBe(false);
    // The parent is what provides it. Said out loud so the failure above is
    // self-explanatory rather than mysterious.
    expect(isStaffOnlyPath("/team")).toBe(true);
    // And it is not in either bar: six tabs, and this is read a few times a year.
    expect(ADMIN_NAV.map((i) => i.href)).not.toContain("/team/hierarchy");
    expect(TEAM_LEAD_NAV.map((i) => i.href)).not.toContain("/team/hierarchy");
  });

  /*
   * ⚠ THE INSTITUTE EDITOR IS NO LONGER EDGE-GATED (B1), AND THAT IS THE POINT
   * OF THIS TEST.
   *
   * It WAS in `ADMIN_ONLY_PATTERNS`, and it had to come out: a rep may now
   * correct an institute they own, once (migration 0036), and this list is
   * static regexes matched before any database read — it cannot express "admin,
   * OR the owner who still has an edit left", because the allowance lives in a
   * column and the edge has no row to consult.
   *
   * The cost is one layer at the edge. What still stands: the page's own server
   * check, `updateInstitute()`'s gate, `institutes_update` (owner-scoped on
   * both halves since 0028), and `guard_rep_institute_edit()` raising FO030.
   *
   * This test is pinned the other way round so the entry cannot come back by
   * habit — re-adding it would silently break the feature for every rep, with
   * a 307 and no explanation.
   */
  it("no longer edge-gates the institute editor, so an owning rep can reach it", () => {
    const id = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
    expect(isAdminOnlyPath(`/institutes/${id}/edit`)).toBe(false);
    expect(isRepOnlyPath(`/institutes/${id}/edit`)).toBe(false);
    // And the registry either side of it stays shared, as it always was.
    expect(isAdminOnlyPath("/institutes")).toBe(false);
    expect(isAdminOnlyPath(`/institutes/${id}`)).toBe(false);
    expect(isAdminOnlyPath("/institutes/new")).toBe(false);
  });

  it("keeps exactly one pattern — the pipeline report — after B1 and H1", () => {
    const id = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
    // Still exactly one gated leaf under /institutes; it answers the STAFF
    // matcher now rather than the admin one, because a report about rows
    // narrows to a team the moment RLS does.
    expect(isStaffOnlyPath("/institutes/report")).toBe(true);
    expect(isAdminOnlyPath("/institutes/report")).toBe(false);
    // ...and nothing else under /institutes is gated by either.
    for (const path of [
      "/institutes",
      "/institutes/new",
      `/institutes/${id}`,
      `/institutes/${id}/edit`,
      `/institutes/${id}/edit/anything`,
    ]) {
      expect(isAdminOnlyPath(path), path).toBe(false);
      expect(isStaffOnlyPath(path), path).toBe(false);
    }
  });

  /*
   * THE PIPELINE REPORT, the second leaf of the same shape.
   *
   * `/institutes/report` is an admin's report of the WHOLE TEAM's pipeline
   * hanging off a registry every rep can open. RLS would empty it for a rep,
   * but "arrives and sees nothing" is not the same as "never arrives", and the
   * first is how a screen gets mistaken for broken.
   */
  it("gates the pipeline report, which hangs off the shared registry", () => {
    // Staff, not admin, since H1 — see the split suite above.
    expect(isStaffOnlyPath("/institutes/report")).toBe(true);
    expect(isRepOnlyPath("/institutes/report")).toBe(false);

    // The registry around it stays shared.
    expect(isAdminOnlyPath("/institutes")).toBe(false);
    expect(isStaffOnlyPath("/institutes")).toBe(false);
    expect(isAdminOnlyPath("/institutes/new")).toBe(false);
    expect(isStaffOnlyPath("/institutes/new")).toBe(false);

    // Anchored at both ends, like every other pattern here. The anchoring is
    // the half that had to survive the move from ADMIN_ONLY_PATTERNS to
    // STAFF_PATTERNS, so it is asserted against the matcher that now owns it.
    expect(isStaffOnlyPath("/institutes/reporting")).toBe(false);
    expect(isStaffOnlyPath("/institutes/report-card")).toBe(false);
    expect(isStaffOnlyPath("/institutes/report/anything")).toBe(true);
    expect(isStaffOnlyPath("/report")).toBe(false);

    /*
     * AND IT MUST NOT SWALLOW AN INSTITUTE DETAIL PAGE. Next resolves the
     * static segment first, so /institutes/report is the report — but an id
     * that is not the literal word must stay a rep's to open.
     */
    const id = "8b1a9953-4c22-4d1f-9b1a-99534c224d1f";
    expect(isAdminOnlyPath(`/institutes/${id}`)).toBe(false);
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
