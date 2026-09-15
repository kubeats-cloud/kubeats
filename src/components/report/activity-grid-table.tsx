import { buildActivityGrid, type GridInput } from "@/lib/exports/activity-grid";
import { cn } from "@/lib/utils";

/**
 * The activity report, on screen.
 *
 * RENDERS THE EXACT ROWS THE .xlsx CONTAINS. `buildActivityGrid()` returns the
 * grid and its merges, and this draws them; `buildWorkbook()` takes the same
 * two arrays and writes them. So the table and the download are two renderings
 * of one array, not two reports that agree by inspection — there is no code
 * path here that counts anything, picks a column, or decides an order, which
 * means there is no path by which what an admin reads on screen can differ from
 * what they hand to somebody as a file.
 *
 * That is also why this component takes `GridInput` rather than a shape of its
 * own: giving the table its own props would be the seam the two could drift
 * through.
 *
 * ONE COMPONENT, TWO SIZES. `compact` is the dashboard card — smaller type,
 * tighter cells, a capped height — and is a presentation flag only. Every
 * column is present in both; the compact one scrolls to reach the wide end
 * rather than hiding anything, because a status column that is invisible on the
 * dashboard is one an admin will not know to look for.
 *
 * HORIZONTAL SCROLL IS THE POINT, NOT A FALLBACK. The status bands are
 * generated from the vocabulary, so the table is as wide as the client's
 * process is — there is no width at which it is guaranteed to fit, and wrapping
 * or dropping columns would misrepresent the report. The first column is
 * sticky so a row stays identifiable at the right-hand end, and the whole
 * thing scrolls inside its own container so the page body never does — the
 * rule CLAUDE.md states for wide content.
 */
export function ActivityGridTable({
  data,
  compact = false,
  caption,
}: {
  data: GridInput;
  /** Dashboard card sizing. Presentation only — no column is dropped. */
  compact?: boolean;
  caption: string;
}) {
  const { rows, merges } = buildActivityGrid(data);
  const [groupRow, labelRow, ...bodyRows] = rows;

  // The merges say how far each group header reaches. Read rather than
  // recomputed, so the colspans here and the merged cells in the workbook come
  // from the same source.
  const spans = new Map<number, number>();
  for (const merge of merges) {
    if (merge.row === 0) spans.set(merge.col, merge.colSpan);
  }

  const cell = compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const headCell = compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-2 text-xs";
  // Sticky needs a solid background of its own, or the scrolled cells show
  // through it.
  const sticky = "sticky left-0 z-10";

  if (bodyRows.length === 0) {
    return (
      <p className="text-muted-foreground px-1 py-6 text-sm">
        No reps to report on yet.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "border-border bg-card overflow-x-auto rounded-lg border",
        compact && "max-h-[22rem] overflow-y-auto",
      )}
    >
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-secondary text-muted-foreground border-border border-b">
            {groupRow.map((value, index) => {
              // A cell covered by a merge to its left renders no <th> at all.
              if (value === null && !spans.has(index)) return null;
              const span = spans.get(index) ?? 1;
              return (
                <th
                  key={index}
                  scope="col"
                  colSpan={span}
                  rowSpan={index === 0 ? 2 : 1}
                  className={cn(
                    headCell,
                    "font-semibold tracking-wide uppercase",
                    index > 0 && "border-border border-l text-center",
                    index === 0 && cn(sticky, "bg-secondary"),
                  )}
                >
                  {String(value ?? "")}
                </th>
              );
            })}
          </tr>
          <tr className="bg-secondary text-muted-foreground border-border border-b">
            {/* Column A is covered by the rowSpan above, so it is skipped. */}
            {labelRow.slice(1).map((value, index) => (
              <th
                key={index}
                scope="col"
                className={cn(headCell, "font-medium whitespace-nowrap text-right")}
              >
                {String(value ?? "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, r) => (
            <tr
              key={r}
              className="group border-border hover:bg-accent/40 border-b transition-colors last:border-0"
            >
              {row.map((value, c) => (
                <td
                  key={c}
                  className={cn(
                    cell,
                    c === 0
                      ? cn(
                          sticky,
                          "bg-card group-hover:bg-accent/40 font-medium whitespace-nowrap",
                        )
                      : "text-right tabular-nums",
                    // A zero is real data, but it is not what the eye is for.
                    c > 0 && value === 0 && "text-muted-foreground/60",
                  )}
                >
                  {String(value ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
