import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addWeeks, formatWeekRange, weekLabel } from "@/lib/weeks";

/**
 * Prev/next week, as links rather than buttons.
 *
 * The week is in the URL, so a rep can bookmark or share one, the back button
 * behaves, and the page keeps working before any JavaScript arrives — which on
 * a phone at the back of a school is not a hypothetical.
 */
export function WeekNavigator({
  weekStart,
  member,
  basePath = "/targets",
}: {
  weekStart: string;
  /** Carried through so an admin drilling into a rep stays on that rep. */
  member?: string;
  /**
   * The route the arrows stay on. Defaults to /targets because that is where
   * most of them live, but /team renders this too and reads ?week= itself —
   * hardcoding one route here used to walk an admin off Team on the first click.
   */
  basePath?: string;
}) {
  const href = (week: string) => {
    const params = new URLSearchParams({ week });
    if (member) params.set("member", member);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="bg-card border-border mb-4 flex items-center justify-between gap-2 rounded-lg border p-2">
      <Button asChild variant="ghost" className="size-11 shrink-0">
        <Link href={href(addWeeks(weekStart, -1))} aria-label="Previous week">
          <ChevronLeftIcon className="size-5" aria-hidden />
        </Link>
      </Button>

      <div className="min-w-0 text-center">
        <p className="truncate text-sm font-semibold">{formatWeekRange(weekStart)}</p>
        <p className="text-muted-foreground text-xs">
          {weekLabel(weekStart)} · Monday to Saturday
        </p>
      </div>

      <Button asChild variant="ghost" className="size-11 shrink-0">
        <Link href={href(addWeeks(weekStart, 1))} aria-label="Next week">
          <ChevronRightIcon className="size-5" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
