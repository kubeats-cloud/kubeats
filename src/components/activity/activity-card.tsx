"use client";

import { cn } from "@/lib/utils";

/**
 * One of the four switch-cards at the top of the Activity tab.
 *
 * A PLAIN BUTTON WITH onClick, NOT A LINK. `ActivityTabs` swaps the report
 * below by setting local React state — there is no navigation to express as
 * an `href`, which is the whole point: a card click costs no round trip.
 */
export function ActivityCard({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "min-h-[44px] min-w-[8rem] flex-1 rounded-lg border p-3 text-left transition-colors sm:flex-none",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-accent/40",
      )}
    >
      <p
        className={cn(
          "text-sm font-semibold",
          active ? "text-primary" : "text-foreground",
        )}
      >
        {label}
      </p>
      <p className="text-muted-foreground text-xs">{description}</p>
    </button>
  );
}
