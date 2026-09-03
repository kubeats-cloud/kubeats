"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2Icon,
  ClockIcon,
  LayoutDashboardIcon,
  PlusIcon,
  SettingsIcon,
  TargetIcon,
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
};

/**
 * Primary navigation, pinned to the bottom because this app is used one-handed
 * while standing up — the bottom of the screen is the part a thumb reaches.
 *
 * Every target is at least 44px in both directions, and the bar carries
 * safe-area padding so the last row of labels is not sitting under an iPhone's
 * home indicator.
 *
 * `items` arrives already filtered by role from the server. Nothing here
 * decides who sees what.
 */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-border bg-card fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = ICONS[item.icon];

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-md px-1 py-2 transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="text-[11px] leading-none font-medium">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
