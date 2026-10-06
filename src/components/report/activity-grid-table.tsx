import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  buildActivityGrid,
  TOTAL_ROW_LABEL,
  type GridInput,
} from "@/lib/exports/activity-grid";
import { COUNT_LINK_CLASS, COUNT_ZERO_CLASS } from "@/components/ui/count-link";
import { cn } from "@/lib/utils";

/** Which column a grid is sorted by, and which way. */
export interface GridSortState {
  key: string;
  dir: "asc" | "desc";
}

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
  sortHrefFor,
  sortState,
}: {
  data: GridInput;
  /** Dashboard card sizing. Presentation only — no column is dropped. */
  compact?: boolean;
  caption: string;
  /**
   * Where a header should point to sort by its own column, or null for a
   * column this screen does not sort.
   *
   * OPTIONAL, AND ITS ABSENCE IS THE DEFAULT. Omitted — which is what the
   * Overview card and /team/report do — every header renders as the plain
   * `<th>` it always has, so neither screen changes at all. Only the pipeline
   * report passes it, because only that screen has the `?sort=` / `?dir=`
   * state to put in the link.
   */
  sortHrefFor?: (sortKey: string) => string | null;
  /** The column currently sorted, so the header can say so. */
  sortState?: GridSortState;
}) {
  const { rows, merges, hrefs, totals, sortKeys } = buildActivityGrid(data);
  const [groupRow, labelRow, ...bodyRows] = rows;
  // Same shape as `rows`, so the header rows are dropped in step with them.
  const [, , ...bodyHrefs] = hrefs;

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

  /**
   * One header's sort control, or the plain text it has always been.
   *
   * A LINK RATHER THAN A BUTTON, and `aria-sort` on the `<th>` rather than on
   * the control. The sort lives in the URL and the page is server-rendered, so
   * the thing a header does is NAVIGATE — which is a link, and which means the
   * header works with JavaScript off, can be opened in a new tab and can be
   * copied and sent to somebody. A `<button>` would be lying about the
   * mechanism, and would need a client component to carry it.
   *
   * The indicator is three-state: an up or down arrow on the active column,
   * and a quiet both-ways chevron on the others, so a reader can tell which
   * headers are sortable before touching one. On the active column the link
   * points at the OPPOSITE direction, which is what makes a second tap reverse
   * it.
   */
  function headerLabel(index: number, text: string) {
    const sortKey = sortKeys[index] ?? null;
    const href = sortKey && sortHrefFor ? sortHrefFor(sortKey) : null;
    if (!href) return text;

    const active = sortState?.key === sortKey;
    const Icon = !active
      ? ChevronsUpDownIcon
      : sortState?.dir === "asc"
        ? ArrowUpIcon
        : ArrowDownIcon;

    return (
      <Link
        href={href}
        className={cn(
          "focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none",
          "hover:text-foreground transition-colors",
          active && "text-foreground",
        )}
        aria-label={
          active
            ? `${text}, sorted ${sortState?.dir === "asc" ? "ascending" : "descending"}. Reverse the order.`
            : `Sort by ${text}`
        }
      >
        {text}
        <Icon
          className={cn("size-3 shrink-0", !active && "opacity-40")}
          aria-hidden
        />
      </Link>
    );
  }

  /** What `aria-sort` should say for the column at this index. */
  function ariaSortFor(index: number): "ascending" | "descending" | "none" | undefined {
    const sortKey = sortKeys[index] ?? null;
    if (!sortKey || !sortHrefFor) return undefined;
    if (sortState?.key !== sortKey) return "none";
    return sortState.dir === "asc" ? "ascending" : "descending";
  }

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
                  // Column A is the only group header that is also a column —
                  // every other one spans a band, and a band is not sortable.
                  aria-sort={index === 0 ? ariaSortFor(0) : undefined}
                  className={cn(
                    headCell,
                    "font-semibold tracking-wide uppercase",
                    index > 0 && "border-border border-l text-center",
                    index === 0 && cn(sticky, "bg-secondary"),
                  )}
                >
                  {index === 0
                    ? headerLabel(0, String(value ?? ""))
                    : String(value ?? "")}
                </th>
              );
            })}
          </tr>
          <tr className="bg-secondary text-muted-foreground border-border border-b">
            {/* Column A is covered by the rowSpan above, so it is skipped —
                which is why every index here is offset by one. */}
            {labelRow.slice(1).map((value, index) => {
              const column = index + 1;
              return (
                <th
                  key={index}
                  scope="col"
                  aria-sort={ariaSortFor(column)}
                  className={cn(headCell, "font-medium whitespace-nowrap text-right")}
                >
                  {headerLabel(column, String(value ?? ""))}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, r) => (
            <tr
              key={r}
              className="group border-border hover:bg-accent/40 border-b transition-colors last:border-0"
            >
              {row.map((value, c) => {
                const href = bodyHrefs[r]?.[c] ?? null;
                return (
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
                      // Same muted treatment CountLink gives its own zeroes.
                      c > 0 && value === 0 && COUNT_ZERO_CLASS,
                    )}
                  >
                    {href ? (
                      /*
                        A COUNT THAT IS A DOOR.
                        Dotted underline at rest and solid on hover: in a grid
                        this dense, permanently underlining every number reads
                        as a link farm, while no affordance at all leaves the
                        drill-down undiscoverable. The label says what it
                        opens, because "3" is useless to a screen reader.
                      */
                      /*
                        The link is `hidden md:inline` for the reason CountLink
                        states: a grid cell cannot reach a 44px tap target, so
                        below md the number stays plain and the sticky name
                        column is the way in.
                      */
                      <>
                        <span className="md:hidden">{String(value ?? "")}</span>
                        <Link
                          href={href}
                          aria-label={`${value} — open these for ${String(row[0] ?? "")}, ${String(labelRow[c] ?? "")}`}
                          className={cn("hidden md:inline", COUNT_LINK_CLASS)}
                        >
                          {String(value ?? "")}
                        </Link>
                      </>
                    ) : (
                      String(value ?? "")
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        {/*
          THE TOTAL ROW, IN A <tfoot> AND NOT IN <tbody>.

          Structural rather than decorative: a total is not one of the rows it
          sums, and `<tfoot>` is the element that says so to a screen reader,
          to a print stylesheet and to anybody reading the markup. Putting it
          in `<tbody>` would make it the last rep on the team.

          It is also why `buildActivityGrid()` keeps totals in their own field
          instead of appending a row — see that comment. The body above is
          exactly the reps, and this is drawn from `totals`.

          Three visual separations, because a number in a dense grid is easy to
          misread as another row: a heavier top border, semibold figures, and a
          slightly raised background that carries through the sticky first cell.
        */}
        {totals && (
          <tfoot>
            {/*
              SOLID `bg-secondary`, NOT A TINT — the sticky cell below needs an
              opaque background of its own or the scrolled columns show through
              it, exactly as the note beside `sticky` says. A first attempt used
              `bg-secondary/60` here and a stray count from the middle of the
              table rendered underneath the words "All reps".
            */}
            <tr className="border-border bg-secondary border-t-2">
              <th
                scope="row"
                className={cn(
                  cell,
                  sticky,
                  "bg-secondary text-left font-semibold whitespace-nowrap",
                )}
              >
                {TOTAL_ROW_LABEL}
              </th>
              {/* Column A is the <th> above, so this starts at 1 — and
                  `perColumn[0]` is null by construction for that reason. */}
              {totals.perColumn.slice(1).map((value, index) => (
                <td
                  key={index}
                  className={cn(
                    cell,
                    "text-right font-semibold tabular-nums",
                    value === 0 && COUNT_ZERO_CLASS,
                  )}
                >
                  {value ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
