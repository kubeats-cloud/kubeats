/**
 * Deliberately free of any React import.
 *
 * The server layout decides which items a user gets and hands the result to a
 * client component, so everything in here has to survive serialisation across
 * that boundary. An icon *component* does not — React rejects it with
 * "Functions cannot be passed directly to Client Components". So an item names
 * its icon and BottomNav resolves the name to a component on its own side.
 */
export type NavIconName =
  | "dashboard"
  | "institutes"
  | "log"
  | "pending"
  | "weekly"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  /** Hidden from reps, and the route itself is guarded server-side as well. */
  adminOnly?: boolean;
}

/**
 * The primary navigation. Which screens exist and what they are called follows
 * the validated prototype; how they look does not.
 *
 * Order matters — it is the order of the bottom bar, left to right.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/institutes", label: "Institutes", icon: "institutes" },
  { href: "/log", label: "Log Visit", icon: "log" },
  { href: "/pending", label: "Pending", icon: "pending" },
  { href: "/weekly", label: "Weekly", icon: "weekly" },
  { href: "/settings", label: "Settings", icon: "settings", adminOnly: true },
];

/**
 * Hiding a tab is a convenience, never a security boundary — the admin routes
 * check the caller's role on the server too. `showAdmin` should come from
 * `isAdmin()`, which additionally requires the profile row to have actually
 * loaded, so a failed lookup can never reveal admin navigation.
 */
export function navItemsFor(showAdmin: boolean): NavItem[] {
  return showAdmin ? NAV_ITEMS : NAV_ITEMS.filter((item) => !item.adminOnly);
}

/** Dashboard only matches exactly; every other tab matches its subtree. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
