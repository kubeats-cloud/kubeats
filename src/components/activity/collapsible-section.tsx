"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Minimise/expand for one report's table — the bar above it (cards, filters,
 * Download Excel) is a sibling, outside `children`, and stays visible either
 * way. "Don't show more than one large table at once" is enforced by
 * `ActivityTabs` hiding the other three cards' panels entirely; this is the
 * second, independent control the brief also asks for — collapsing the
 * table of the report that IS showing, without losing its filter bar.
 */
export function CollapsibleSection({
  label,
  children,
}: {
  /** What the table is, for the toggle's own label — "the Pipeline table". */
  label: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        className="mb-2 h-9"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronDownIcon className="size-4" aria-hidden />
        ) : (
          <ChevronUpIcon className="size-4" aria-hidden />
        )}
        {collapsed ? `Show ${label}` : `Minimise ${label}`}
      </Button>
      <div hidden={collapsed}>{children}</div>
    </div>
  );
}
