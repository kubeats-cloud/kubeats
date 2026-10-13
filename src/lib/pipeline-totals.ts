import type {
  RepRow,
  StatusColumn,
  StatusColumns,
} from "@/lib/exports/activity-grid";

export interface PipelineTotals {
  /** Every institute the grid counts: open + closed + no status yet. */
  overall: number;
  open: number;
  closed: number;
  /** Null while a range is active — the column is not drawn, so it is not asked. */
  noStatus: number | null;
}

/**
 * The Overview's three headline figures, read off the same rows and columns
 * the grid beside them draws.
 *
 * OPEN AND CLOSED ARE THE COLUMN BANDS, not a second reading of the catalogue.
 * `statusColumnsFor()` already split the columns by `institute_statuses.category`,
 * so summing over each half is the category split by construction — and a
 * status an admin adds lands in the right total on the next request.
 *
 * Deliberately the FULL model, not the reader's folded view: hiding a column
 * in the picker changes what is on screen, not how many institutes there are.
 */
export function pipelineTotals(input: {
  reps: RepRow[];
  columns: StatusColumns;
  unsetColumn: StatusColumn | null;
}): PipelineTotals {
  const sum = (columns: StatusColumn[]) =>
    input.reps.reduce(
      (total, rep) =>
        total +
        columns.reduce((n, column) => n + (rep.statuses[column.status] ?? 0), 0),
      0,
    );

  const open = sum(input.columns.open);
  const closed = sum(input.columns.closed);
  const noStatus = input.unsetColumn ? sum([input.unsetColumn]) : null;

  return { overall: open + closed + (noStatus ?? 0), open, closed, noStatus };
}
