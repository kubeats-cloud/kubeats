"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Minimise/expand for one region — the bar above it (cards, filters, Download
 * Excel) is a sibling, outside `children`, and stays visible either way. "Don't
 * show more than one large table at once" is enforced by `ActivityTabs` hiding
 * the other three cards' panels entirely; this is the second, independent
 * control the brief also asks for — collapsing the table of the report that IS
 * showing, without losing its filter bar.
 *
 * Settings reuses it for the overflow of a long list: the first few rows are
 * rendered outside, and the rest live in one of these, folded by default.
 */
export function CollapsibleSection({
  label,
  defaultCollapsed = false,
  showLabel,
  hideLabel,
  children,
}: {
  /** What the region is, for the toggle's own label — "the Pipeline table". */
  label: string;
  /** Start folded. Only a caller that renders a preview above it asks for this. */
  defaultCollapsed?: boolean;
  /** Wording for the two states, when "Show/Minimise {label}" does not fit. */
  showLabel?: string;
  hideLabel?: string;
  children: React.ReactNode;
}) {
  // One bit of state either way; `defaultCollapsed` decides only how it reads
  // at first, so the component stays uncontrolled and no effect has to chase a
  // changing prop.
  const [toggled, setToggled] = useState(false);
  const collapsed = defaultCollapsed ? !toggled : toggled;

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        className="mb-2 h-9"
        onClick={() => setToggled((value) => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronDownIcon className="size-4" aria-hidden />
        ) : (
          <ChevronUpIcon className="size-4" aria-hidden />
        )}
        {collapsed
          ? showLabel ?? `Show ${label}`
          : hideLabel ?? `Minimise ${label}`}
      </Button>
      <div hidden={collapsed}>{children}</div>
    </div>
  );
}
