import "server-only";

import { buildWorkbook, type CellValue, type SheetSpec } from "@/lib/xlsx";
import {
  getInstituteActivityModel,
  type InstituteActivityQuery,
} from "@/lib/institute-activity-report";
import type { InstituteActivityRow } from "@/lib/institute-activity-counts";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/validation/weekly";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * Excel for the institute-wise Activity Report.
 *
 * Built from the SAME model the screen renders (`getInstituteActivityModel`),
 * so filter + sort on the URL produce a file that matches the table. No second
 * counting path.
 */

export type InstituteActivityExportResult =
  | { ok: true; filename: string; bytes: Uint8Array }
  | { ok: false; error: string };

const ACTIVITY_HEADERS: { key: ActivityType; open: string; closed: string }[] =
  ACTIVITY_TYPES.map((key) => ({
    key,
    open: `${activityLabelFor(key)} Open`,
    closed: `${activityLabelFor(key)} Closed`,
  }));

export function instituteActivitySheetRows(
  rows: readonly InstituteActivityRow[],
): CellValue[][] {
  // No "Total" column: Admin #1/#2 name only the six activity types' Open/
  // Closed counts, and "the downloaded Excel file must contain the same
  // data as the displayed table" — this sheet can carry no column the table
  // itself does not show. Reconciliation stays internal
  // (`reconcileActivityCounts()`), not a displayed figure.
  const header: CellValue[] = [
    "Institute",
    ...ACTIVITY_HEADERS.flatMap((h) => [h.open, h.closed]),
  ];

  const body = rows.map((row) => {
    const cells: CellValue[] = [row.name];
    for (const key of ACTIVITY_TYPES) {
      cells.push(row.byActivity[key].open, row.byActivity[key].closed);
    }
    return cells;
  });

  return [header, ...body];
}

export async function buildInstituteActivityExport(
  query: InstituteActivityQuery = {},
): Promise<InstituteActivityExportResult> {
  const result = await getInstituteActivityModel(query);
  if (!result.ok) return { ok: false, error: result.error };

  const dataRows = instituteActivitySheetRows(result.model.rows);
  const colCount = dataRows[0]?.length ?? 1;
  const sheet: SheetSpec = {
    name: "Institute activity",
    rows: dataRows,
    boldRows: [0],
    freezeRows: 1,
    widths: Array.from({ length: colCount }, (_, i) => (i === 0 ? 28 : 12)),
  };

  const bytes = buildWorkbook(sheet);
  const { from, to } = result.model.range;
  const stamp =
    from || to
      ? `${from ?? "start"}_${to ?? "end"}`
      : "all";
  return {
    ok: true,
    filename: `institute-activity-${stamp}.xlsx`,
    bytes,
  };
}
