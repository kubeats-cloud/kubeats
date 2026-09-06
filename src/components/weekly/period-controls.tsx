import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PERIOD_LABELS,
  PERIOD_NOUN,
  formatPeriodRange,
  periodLabel,
  periodStartOf,
  shiftPeriod,
  type Period,
} from "@/lib/periods";
import { cn } from "@/lib/utils";

/**
 * Picking a period, and stepping through it.
 *
 * Links rather than buttons, and the period and its start both live in the
 * URL: a rep can bookmark or share one, the back button behaves, and the page
 * keeps working before any JavaScript arrives — which on a phone at the back of
 * a school is not hypothetical. It is the same reasoning as WeekNavigator,
 * which still serves /team unchanged.
 *
 * Switching period keeps you on the same date rather than jumping to today.
 * Looking at last week and tapping Monthly should show the month that week sits
 * in, not this one.
 */
export function PeriodControls({
  period,
  periodStart,
  options,
  member,
  basePath = "/targets",
}: {
  period: Period;
  periodStart: string;
  /**
   * Which periods this screen offers. Targets takes TARGET_PERIODS (no yearly,
   * because the table has no such row); the activity report takes
   * REPORT_PERIODS (no weekly). One control, two vocabularies.
   */
  options: readonly Period[];
  /** Carried through so an admin drilling into a rep stays on that rep. */
  member?: string;
  basePath?: string;
}) {
  const href = (nextPeriod: Period, nextStart: string) => {
    const params = new URLSearchParams({
      period: nextPeriod,
      start: nextStart,
    });
    if (member) params.set("member", member);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="bg-card border-border flex gap-1 rounded-lg border p-1">
        {options.map((option) => (
          <Button
            key={option}
            asChild
            variant={option === period ? "default" : "ghost"}
            className={cn("h-10 flex-1")}
          >
            <Link
              href={href(option, periodStartOf(option, periodStart))}
              aria-current={option === period ? "page" : undefined}
            >
              {PERIOD_LABELS[option]}
            </Link>
          </Button>
        ))}
      </div>

      <div className="bg-card border-border flex items-center justify-between gap-2 rounded-lg border p-2">
        <Button asChild variant="ghost" className="size-11 shrink-0">
          <Link
            href={href(period, shiftPeriod(period, periodStart, -1))}
            aria-label={`Previous ${PERIOD_NOUN[period]}`}
          >
            <ChevronLeftIcon className="size-5" aria-hidden />
          </Link>
        </Button>

        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold">
            {formatPeriodRange(period, periodStart)}
          </p>
          <p className="text-muted-foreground text-xs">
            {periodLabel(period, periodStart)}
            {period === "weekly" ? " · Monday to Saturday" : ""}
          </p>
        </div>

        <Button asChild variant="ghost" className="size-11 shrink-0">
          <Link
            href={href(period, shiftPeriod(period, periodStart, 1))}
            aria-label={`Next ${PERIOD_NOUN[period]}`}
          >
            <ChevronRightIcon className="size-5" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
