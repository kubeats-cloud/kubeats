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
 * The routes a rep may reach and an admin may not.
 *
 * Hiding a tab is a convenience, never a boundary — `proxy.ts` turns an admin
 * away from these with a real redirect, and each page checks again on the
 * server. This list is the single place all three read from.
 */
export const REP_ONLY_PATHS = ["/log", "/pending"] as const;

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
