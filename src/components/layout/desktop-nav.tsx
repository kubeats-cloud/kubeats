"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2Icon,
  ClipboardCheckIcon,
  ClockIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  TargetIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { isActive, type NavIconName, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Names arrive from the server; the components stay on this side. */
const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  institutes: Building2Icon,
  log: PlusIcon,
  pending: ClockIcon,
  weekly: TargetIcon,
  settings: SettingsIcon,
  // The admin workspace. Each one names what the screen is for rather than
  // decorating it: a checked clipboard for reading the team's work, a paper
  // plane for handing work out, people for the team, a database for the tools
  // that touch stored data.
  review: ClipboardCheckIcon,
  assign: SendIcon,
  team: UsersIcon,
  data: DatabaseIcon,
};

/**
 * The same navigation as the bottom bar, laid out for a mouse.
 *
 * A thumb-reachable bar pinned to the bottom of a 27-inch monitor is a phone
 * layout someone forgot to finish — and admins live on desktops. So the two
 * swap at `md`: this appears, the bottom bar hides, and neither is ever on
 * screen at the same time as the other.
 *
 * The active tab is marked by the flame, which is the only place the gradient
 * appears in the header now that the bar itself is white.
 */
export function DesktopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = ICONS[item.icon];

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                )}
              >
                <Icon
                  className={cn("size-4", active ? "text-primary" : "")}
                  strokeWidth={active ? 2.25 : 2}
                  aria-hidden
                />
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="brand-rule absolute inset-x-2 -bottom-[13px] h-0.5 rounded-full"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
