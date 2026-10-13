"use client";

import { Button } from "@/components/ui/button";

/**
 * The one control both hub previews share: reveal the list already loaded,
 * or fold it back to the short view. It does not fetch.
 */
export function PreviewToggle({
  expanded,
  total,
  onToggle,
  listLabel,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
  /** What the list is, so the button says which records it reveals. */
  listLabel: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="mt-3 h-11 w-full"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? "Show less" : `View all ${total} ${listLabel}`}
    </Button>
  );
}
