import "server-only";

import { buildWorkbook, type CellValue, type SheetSpec } from "@/lib/xlsx";
import {
  getInstituteActivityModel,
  type InstituteActivityQuery,
} from "@/lib/institute-activity-report";
import type { InstituteActivityRow } from "@/lib/institute-activity-counts";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/validation/weekly";
import { INSTITUTE_ACTIVITY_LABELS } from "@/lib/institute-activity-counts";
import { openClosedTotals,sumInstituteActivityRows } from '@/lib/institute-activity-counts';
import { TYPE_LABELS } from '@/lib/validation/institute';
import { formatDateTime } from '@/lib/dates';
import { formatArea } from '@/lib/location-display';

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
    open: `${INSTITUTE_ACTIVITY_LABELS[key]} Open`,
    closed: `${INSTITUTE_ACTIVITY_LABELS[key]} Closed`,
  }));

export function instituteActivitySheetRows(
  rows: readonly InstituteActivityRow[],
  /** SQL totals over all matching rows; falls back to the passed rows. */
  totals?: Record<ActivityType, {open: number; closed: number}>,
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

  const total: CellValue[] = ['Total',...ACTIVITY_TYPES.flatMap(key => (['open','closed'] as const)
    .map(category => totals ? totals[key][category]
      : rows.reduce((sum,row) => sum + row.byActivity[key][category],0)))];
  return [header, ...body,total];
}

export function repInstituteSheetRows(rows: readonly InstituteActivityRow[]): CellValue[][] {
  const totals = sumInstituteActivityRows(rows);
  return [
    ['Institute','Type','Location','Status','Open','Closed','Follow-ups owned','Follow-ups pending','Meetings completed'],
    ...rows.map(row => {const oc = openClosedTotals(row); return [row.name,TYPE_LABELS[row.type],
      [row.area,row.city,row.state].filter(Boolean).join(', ') || '—',row.status ?? 'No status yet',
      oc.open,oc.closed,row.followUpsOwned,row.followUpsPending,row.meetingsCompleted];}),
    ['Total','','','',totals.open,totals.closed,rows.reduce((n,r) => n+r.followUpsOwned,0),
      rows.reduce((n,r) => n+r.followUpsPending,0),totals.meetingsCompleted],
  ];
}

export function presenceSheetRows(rows: readonly InstituteActivityRow[]): CellValue[][] {
  const totals = sumInstituteActivityRows(rows);
  return [
    ['Institute Name','Check-In Date and Time','Check-Out Date and Time','Location',
      'Number of Open Status activities','Number of Closed Status activities','Total Number of Visits','Total Number of Meetings','Total activity count'],
    ...rows.map(row => {const oc = openClosedTotals(row); return [row.name,
      row.lastCheckinAt ? formatDateTime(row.lastCheckinAt) : 'Not recorded',
      row.lastCheckoutAt ? formatDateTime(row.lastCheckoutAt) : 'Not recorded',
      row.lastCheckinAt ? formatArea(row.lastCheckinArea) : '—',oc.open,oc.closed,row.totalVisits,row.meetingsCompleted,row.totalActivities];}),
    ['Total','','','',totals.open,totals.closed,totals.totalVisits,totals.meetingsCompleted,totals.totalActivities],
  ];
}

export async function buildInstituteActivityExport(
  query: InstituteActivityQuery & {view?: 'rep' | 'presence'} = {},
): Promise<InstituteActivityExportResult> {
  // The admin download is the whole filtered report, not the page on screen:
  // `p_page = 0` returns every matching institute, and the Total row uses the
  // RPC's sum over those same rows.
  const allRows = query.view === undefined;
  const result = await getInstituteActivityModel({...query, allRows, page: allRows ? undefined : query.page});
  if (!result.ok) return { ok: false, error: result.error };

  const dataRows = query.view === 'rep' ? repInstituteSheetRows(result.model.rows)
    : query.view === 'presence' ? presenceSheetRows(result.model.rows)
      : instituteActivitySheetRows(result.model.rows, result.model.totals.byActivity);
  const colCount = dataRows[0]?.length ?? 1;
  const sheet: SheetSpec = {
    name: "Institute activity",
    rows: dataRows,
    boldRows: [0,dataRows.length-1],
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
