/**
 * The bar above one report's table: the report's own From/To + Apply/Clear
 * on the left and its Download Excel on the right.
 *
 * STICKY UNDER THE TOP BAR, which is `sticky top-0 z-30` at 3.5rem tall on a
 * phone and 4rem from `md` up. Sticking at those offsets keeps the controls
 * reachable while a long table scrolls, without the two headers overlapping.
 *
 * OUTSIDE `CollapsibleSection`, deliberately: collapsing a report hides its
 * table, never the controls that produced it.
 */
export function ActivityToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background/95 sticky top-14 z-20 mb-4 -mx-1 px-1 py-2 backdrop-blur md:top-16">
      {children}
    </div>
  );
}
