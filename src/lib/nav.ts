/**
 * Deliberately free of any React import.
 *
 * The server layout decides which items a user gets and hands the result to a
 * client component, so everything in here has to survive serialisation across
 * that boundary. An icon *component* does not — React rejects it with
 * "Functions cannot be passed directly to Client Components". So an item names
 * its icon and the nav components resolve the name on their own side.
 */
export type NavIconName =
  | "dashboard"
  | "institutes"
  | "log"
  | "pending"
  | "weekly"
  | "settings"
  | "review"
  | "assign"
  | "team"
  | "data"
  | "materials"
  | "report";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

/**
 * Two apps, one codebase.
 *
 * A rep's job is fieldwork: plan the day, stand at a gate, log what happened.
 * An admin's job is supervision: read what the team did, allocate the next
 * round, and keep the shared lists straight. Those are different tools, and
 * giving an admin a "Log Visit" tab was giving them a button they should never
 * press — the meeting gate, the photo and the closing report all exist to
 * record a person being somewhere, which an admin at a desk was not.
 *
 * So the navigation is two lists rather than one list with a hidden item.
 */
export const REP_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/institutes", label: "Institutes", icon: "institutes" },
  { href: "/log", label: "Log Visit", icon: "log" },
  { href: "/pending", label: "Pending", icon: "pending" },
  // Label and route agree again. Stage 2 read "This week" here, because the
  // screen had become a read-only account and a tab called "Targets" would have
  // named something the app no longer had. The client's spec put the weekly
  // commitment back, so the tab names the thing a rep goes there to DO — set
  // the eight numbers — rather than the report they get back.
  { href: "/targets", label: "Targets", icon: "weekly" },
  { href: "/materials", label: "Materials", icon: "materials" },
];

/**
 * Six, not seven. `/data` is deliberately not in the bar: it holds the photo
 * flush, which is destructive and used a few times a year, and a bar item is
 * for the things you reach for daily. It is one tap from Settings and from
 * Overview, which is the right distance for a tool that deletes things.
 *
 * `/report` is out of both bars for the same reason, and the nav test enforces
 * the six. It is reached from Targets — the screen about what you are aiming
 * for is the natural place to ask what you actually did — and from the admin
 * Overview. A seventh tab would have cost every other tab width on the phones
 * this app is actually used on.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "dashboard" },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/assign", label: "Assign", icon: "assign" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/institutes", label: "Institutes", icon: "institutes" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

/**
 * Reachable without a session. Everything else redirects to /login.
 *
 * It lives here rather than in proxy.ts for the reason the two lists below
 * already do: this file is the single place every route-visibility question is
 * answered, so a screen cannot be public in one place and gated in another.
 */
export const PUBLIC_PATHS = ["/login", "/privacy"] as const;

/**
 * The subset of PUBLIC_PATHS a SIGNED-IN user is bounced off.
 *
 * These were one list until /privacy arrived, and splitting them is the whole
 * point. A privacy notice has to be readable by a stranger who has not signed
 * in AND by a rep who wants to know what is recorded about them; bouncing the
 * second to the dashboard answers a fair question with a shrug. /login is the
 * only path where "you are already in" is a reason to send someone away.
 *
 * So: every AUTH_PATH must be a PUBLIC_PATH, but not the reverse. The nav test
 * asserts that containment, because an AUTH_PATH that is not public would be a
 * path nobody could reach in either state.
 */
export const AUTH_PATHS = ["/login"] as const;

/**
 * The second-factor code screen, and the reason it is not at /login/verify.
 *
 * `matches()` below is PREFIX-based — `pathname.startsWith(`${path}/`)` — so
 * "/login/verify" would be an AUTH_PATH, and the proxy bounces signed-in users
 * off those. An admin who had just given their password would be redirected to
 * "/", the MFA gate would redirect them back to the code screen, and the auth
 * rule would bounce them again: a loop, out of two rules that are each correct
 * on their own. Same shape as the robots.txt matcher trap documented in
 * proxy.ts's matcher.
 *
 * Top-level, therefore. It is NOT public — a signed-out visitor is sent to
 * /login like anywhere else — and NOT an auth path, because being signed in is
 * the whole precondition for being here. `nav.test.ts` pins all three.
 */
export const MFA_VERIFY_PATH = "/verify";

/**
 * The routes a rep may reach and an admin may not.
 *
 * Hiding a tab is a convenience, never a boundary — `proxy.ts` turns an admin
 * away from these with a real redirect, and each page checks again on the
 * server. This list is the single place all three read from.
 *
 * `/pending` WAS HERE AND IS NOT ANY MORE, and the reason is worth keeping.
 * Both pending screens were written for an admin from the start: the index
 * renders "Every institute across the team still waiting on a follow-up" with
 * `readOnly`, which is the only branch that offers stage 5b's "Assign this
 * follow-up", and `/pending/[id]` ends its ownership check with
 * `if (!mine && !isAdmin(user)) notFound()`. This list was the one thing
 * standing between an admin and code already written to serve them — so the
 * whole feature redirected to `/` and could never be used, and the institute
 * page's "Open the full report" link was dead for the only role that sees it.
 *
 * `/log` stays, and for the reason the block above gives: logging a visit
 * records a person being somewhere, which an admin at a desk was not. Reading
 * what is still owed across the team is supervision, which is their job.
 *
 * Being reachable is not the same as being in the bar. `/pending` is NOT in
 * `ADMIN_NAV` — it is reached from the Overview's "Go to" list, the same
 * distance as `/report` and `/data`, and for the same reason: six tabs.
 */
export const REP_ONLY_PATHS = ["/log"] as const;

/** The mirror: admin workspace routes a rep may not reach. */
export const ADMIN_ONLY_PATHS = [
  "/review",
  "/assign",
  "/team",
  "/data",
  "/settings",
  // Only the management half. /materials itself is shared — an admin browses
  // the same library a rep does, and reaches this from a link on it.
  "/materials/manage",
] as const;

function matches(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isRepOnlyPath(pathname: string): boolean {
  return matches(pathname, REP_ONLY_PATHS);
}

export function isAdminOnlyPath(pathname: string): boolean {
  return matches(pathname, ADMIN_ONLY_PATHS);
}

export function isPublicPath(pathname: string): boolean {
  return matches(pathname, PUBLIC_PATHS);
}

export function isAuthPath(pathname: string): boolean {
  return matches(pathname, AUTH_PATHS);
}

/**
 * `showAdmin` should come from `isAdmin()`, which additionally requires the
 * profile row to have actually loaded — so a failed lookup degrades to rep
 * navigation rather than revealing the admin workspace.
 */
export function navItemsFor(showAdmin: boolean): NavItem[] {
  return showAdmin ? ADMIN_NAV : REP_NAV;
}

/** Dashboard only matches exactly; every other tab matches its subtree. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
