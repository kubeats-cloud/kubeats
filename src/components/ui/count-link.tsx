import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A count that is also a door.
 *
 * ONE DEFINITION, TWO CALLERS. The report grid already styled its cells this
 * way inline; that styling now lives here and the grid imports it, so the
 * dense little counts in `activity-grid-table.tsx` and the looser ones on the
 * Overview and Review cannot drift into two different-looking affordances.
 *
 * THE AFFORDANCE, and why it is this one. In a table of forty numbers a
 * permanent underline on every linked figure reads as a link farm and the eye
 * stops separating them; no affordance at all leaves the drill-down
 * undiscoverable. Dotted at rest and solid + primary on hover is the middle:
 * visible when looked at, quiet when scanned past.
 *
 * ZERO IS NEVER A LINK. A zero has nothing behind it, and a link that lands on
 * an empty list is a broken promise rather than a drill-down — so it renders
 * as muted plain text with no href and no tab stop. That is a rule about
 * TRUTH, not taste: the count and the page it opens must agree, and for zero
 * the only honest page is none.
 */

/** The link's own look, shared with the report grid's cells. */
export const COUNT_LINK_CLASS =
  "decoration-muted-foreground/40 hover:text-primary focus-visible:ring-ring rounded-sm underline decoration-dotted underline-offset-4 hover:decoration-solid focus-visible:ring-2 focus-visible:outline-none";

/** What a zero looks like: present, readable, and not a control. */
export const COUNT_ZERO_CLASS = "text-muted-foreground/60";

export function CountLink({
  value,
  href,
  label,
  className,
  mdOnly = false,
}: {
  value: number;
  /** Where the rows behind the count live. Ignored when `value` is 0. */
  href: string;
  /**
   * REQUIRED, and typed so it cannot be forgotten.
   *
   * The visible text is a bare numeral. "3" tells a screen-reader user
   * nothing about what they are about to open, and this is the one control in
   * the app whose label carries all of its meaning.
   */
  label: string;
  className?: string;
  /**
   * Link only from `md` up.
   *
   * For counts living in a dense grid cell: a 26px-tall cell cannot reach the
   * 44px tap target the rest of the app holds to, so on a phone the number
   * stays plain text and the row's NAME is the way in. Name links are never
   * md-only — they are full-width rows and fine under a thumb.
   */
  mdOnly?: boolean;
}) {
  if (value === 0) {
    return <span className={cn(COUNT_ZERO_CLASS, className)}>0</span>;
  }

  if (mdOnly) {
    return (
      <>
        {/* Two renderings of one number, one visible at a time. `hidden`
            removes the link from the tab order and the accessibility tree
            below md, rather than merely hiding it from sight. */}
        <span className={cn("md:hidden", className)}>{value}</span>
        <Link
          href={href}
          aria-label={label}
          className={cn("hidden md:inline", COUNT_LINK_CLASS, className)}
        >
          {value}
        </Link>
      </>
    );
  }

  return (
    <Link href={href} aria-label={label} className={cn(COUNT_LINK_CLASS, className)}>
      {value}
    </Link>
  );
}
