import { cn } from "@/lib/utils";

/**
 * The bounded scroll box every table in the app renders inside.
 *
 * WHY A BOUNDED BOX, NOT PAGE-SCROLL STICKY. A `position: sticky` header is
 * positioned against its nearest scrollport. Every table here needs horizontal
 * scrolling, and `overflow-x: auto` makes the wrapper a scrollport in BOTH axes
 * (the other axis computes to `auto`), even when it never scrolls vertically.
 * The header then sticks to the wrapper's own top edge and scrolls away with the
 * page. Capping this box's height makes the wrapper genuinely scroll vertically,
 * so the header sticks where a reader expects it — and it needs no JavaScript.
 *
 * WHY ONE COMPONENT. The header rules (two sticky rows, the corner cell, the
 * z-index ladder) are identical for every table. Keeping them in this one frame
 * means a new table inherits them by being wrapped, rather than by copying five
 * utility classes and eventually drifting.
 *
 * HEIGHT. `min(70vh, 100dvh - 18rem)`: 18rem reserves the top bar, page heading,
 * filters and the Activity tab's sticky toolbar, so on the Activity screens the
 * box never slides under the toolbar far enough to hide its own header. The 70vh
 * cap stops a tall monitor from producing an absurdly tall table.
 *
 * `tone` only chooses the header's opaque background. The previous tints were
 * translucent (`bg-muted/60`, `bg-secondary/40`), which lets scrolled rows show
 * through a sticky header; the CSS mixes each tint against the card colour so
 * the result is visually the same but fully opaque.
 *
 * `stickyFirstColumn` is for tables whose body's first cell is already sticky
 * horizontally: it pins the corner header on both axes at a z-index above both
 * header rows. Tables without a sticky first column leave it off.
 */
export type TableFrameTone = "muted" | "secondary" | "secondary-soft" | "card";

export function TableFrame({
  children,
  tone = "muted",
  stickyFirstColumn = false,
  framed = true,
  className,
  maxHeight,
}: {
  children: React.ReactNode;
  /** Header surface. Matches the tint the table used before the frame existed. */
  tone?: TableFrameTone;
  /** Pin the first header cell to the left edge as well as the top. */
  stickyFirstColumn?: boolean;
  /** The table's own border. Off inside a Card, which already draws one. */
  framed?: boolean;
  className?: string;
  /** Override the default max-height, as the (currently unused) compact grid does. */
  maxHeight?: string;
}) {
  return (
    <div
      className={cn(
        "table-frame",
        framed && "border-border rounded-lg border",
        className,
      )}
      data-tone={tone}
      data-sticky-first-column={stickyFirstColumn ? "" : undefined}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  );
}
