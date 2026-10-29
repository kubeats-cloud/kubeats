import {
  buildActivityGrid,
  TOTAL_ROW_LABEL,
  type RepRow,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import type { CellValue, SheetMerge, SheetSpec } from "@/lib/xlsx";

/**
 * The Call Activity Report's grid and its .xlsx sheet — PURE, like
 * `activity-grid.ts` beside it, so the title rows, the headings and the
 * totals row are all testable with no database. `call-activity-export.ts`
 * (server-only) does the reading; this decides the shape.
 */

export interface CallActivityTotals {
  byStatus: Record<string, number>;
  openTotal: number;
  closedTotal: number;
  total: number;
}

/**
 * The footer's "All reps" row, as a single `RepRow` — fed to
 * `buildActivityGrid()`'s `totalsFrom` in place of every rep's own row, on
 * screen and in the .xlsx alike.
 *
 * `buildActivityGrid()` recomputes the Open/Closed/Total subtotals from
 * `.statuses` itself (see `activity-grid.ts`'s `showGroupTotals` body), so
 * summing a SINGLE row whose `.statuses` is already the server's full-
 * population sum (`totals.byStatus`, computed over every matching rep, not
 * only the visible page or the current export's own row list) reproduces
 * exactly the same footer a true "all reps" reduction would.
 */
export function totalsRow(totals: CallActivityTotals): RepRow {
  return { name: "", activities: ZERO_COUNTS, statuses: totals.byStatus };
}

/** A sanitised, filename-safe fragment — mirrors `exportFilename()` in activity-export.ts. */
function slug(value: string | null | undefined): string {
  return value
    ? value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"
    : "all";
}

/** `kubeats-call-activity-<who>-<from>-to-<to>.xlsx` — its own name, never activity-export.ts's. */
export function callActivityExportFilename(
  from: string,
  to: string,
  repName: string | null,
): string {
  return `kubeats-call-activity-${slug(repName)}-${from}-to-${to}.xlsx`;
}

export interface CallActivitySheetMeta {
  /** Both present once the export has resolved its range — never both null. */
  from: string;
  to: string;
  /** The rep's name, or null for "Everyone". */
  repLabel: string | null;
  /** The raw search text, or null for "Any". */
  institute: string | null;
  /** The status name, or null for "Any status". */
  status: string | null;
}

/**
 * The finished sheet: title, date range, filters in plain words, a blank
 * row, then the same table `CustomisableGrid` renders on screen (reused via
 * `buildActivityGrid`, `showActivities: false, showGroupTotals: true` — the
 * same two flags the screen passes), plus the totals row.
 *
 * NUMBERS MUST EQUAL THE TABLE FOR THE SAME FILTERS — and they do by
 * construction: this is the SAME `reps`/`columns`/totals-row the screen
 * builds from the same RPC answer, not a second computation that could
 * drift from it.
 */
export function buildCallActivitySheet(
  reps: readonly RepRow[],
  columns: StatusColumns,
  totals: CallActivityTotals,
  meta: CallActivitySheetMeta,
): SheetSpec {
  const grid = buildActivityGrid({
    reps: [...reps],
    columns,
    showActivities: false,
    showGroupTotals: true,
    totalsFrom: [totalsRow(totals)],
  });

  const filterLine =
    `Filters — Representative: ${meta.repLabel ?? "Everyone"}; ` +
    `Institute contains: ${meta.institute ? `"${meta.institute}"` : "Any"}; ` +
    `Call Status: ${meta.status ?? "Any status"}`;

  const titleRows: CellValue[][] = [
    ["Call Activity Report"],
    [`Date range: ${meta.from} to ${meta.to}`],
    [filterLine],
    [null],
  ];
  const offset = titleRows.length;

  // Offset by the title block — the grid's own merge positions are relative
  // to its own row 0, which is now `offset` rows further down the sheet.
  const merges: SheetMerge[] = [
    ...(grid.merges ?? []).map((m) => ({ ...m, row: m.row + offset })),
  ];

  const bodyRows = [...titleRows, ...grid.rows];
  const sheetRows = grid.totals
    ? [...bodyRows, [TOTAL_ROW_LABEL, ...grid.totals.perColumn.slice(1)] as CellValue[]]
    : bodyRows;

  return {
    name: "Call Activity",
    rows: sheetRows,
    merges,
    // The title, the two header rows and the totals row — all bold, same
    // rule `activitySheet()` uses for its own header-and-footer pair.
    boldRows: [0, offset, offset + 1, sheetRows.length - 1],
    freezeRows: offset + 2,
  };
}
