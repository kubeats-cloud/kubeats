import "server-only";

import { buildWorkbook, type CellValue, type SheetSpec } from "@/lib/xlsx";
import {
  getInstituteActivityModel,
  getInstituteStatusActivityModel,
  type InstituteActivityQuery,
  type InstituteStatusActivityQuery,
} from "@/lib/institute-activity-report";
import type {
  InstituteActivityRow,
  StatusActivityVisit,
  StatusColumn,
} from "@/lib/institute-activity-counts";
import { ACTIVITY_TYPES, type ActivityType } from "@/lib/validation/weekly";
import { OTHER_INACTIVE_STATUS_LABEL } from "@/lib/exports/activity-grid";
import { INSTITUTE_ACTIVITY_LABELS } from "@/lib/institute-activity-counts";
import {
  openClosedTotals,
  sumInstituteActivityRows,
} from "@/lib/institute-activity-counts";
import { TYPE_LABELS } from "@/lib/validation/institute";
import { activityLabel } from "@/lib/activities";
import { formatClockTime, formatDate, formatDateTime, formatTime } from "@/lib/dates";
import { formatArea } from "@/lib/location-display";
import { formatDuration, visitMinutes } from "@/lib/validation/checkin";

/**
 * Excel for the Institute Activity report.
 *
 * Two shapes, because the two screens ask different questions:
 *
 *   - The admin/team-lead export is ONE ROW PER VISIT in the chosen range,
 *     with one column per active status (1/0) and the visit's follow-up
 *     columns, plus a Total row that sums the status and follow-up-created
 *     columns. The on-screen table is one row per institute; those status
 *     column totals are the parity check between the two.
 *   - The rep and presence exports stay one row per institute: they are the
 *     rep's own list and the R7 presence table, neither of which the client
 *     asked to change.
 *
 * Built from the SAME model the screen renders, so a filtered screen and its
 * file cannot count differently.
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

/** The visit sheet's fixed columns, before the status block. */
const VISIT_HEADERS: CellValue[] = [
  "Institute",
  "Rep",
  "Activity",
  "Meeting purpose",
  "Visit date",
  "Check-In Date (IST)",
  "Check-In Time (IST)",
  "Check-Out Date (IST)",
  "Check-Out Time (IST)",
  "Duration",
  "Location",
  "Status",
  "Next action",
  "Next action date",
  "Total follow-ups",
  "Open follow-ups",
];

function durationOf(visit: StatusActivityVisit): string | null {
  const minutes = visitMinutes({
    checkinAt: visit.checkinAt,
    checkoutAt: visit.checkoutAt,
    checkoutMissing: false,
  });
  return minutes === null ? null : formatDuration(minutes);
}

function nextActionLabel(value: string | null): string | null {
  if (value === "call") return "Call";
  if (value === "meeting") return "Meeting";
  return null;
}

const FOLLOW_UP_HEADERS: CellValue[] = [
  "Follow-up Date",
  "Follow-up Time (IST)",
  "Follow-up Created",
];

function sheetFor(rows: CellValue[][]): SheetSpec {
  const colCount = rows[0]?.length ?? 1;
  return {
    name: "Institute activity",
    rows,
    boldRows: [0, rows.length - 1],
    freezeRows: 1,
    widths: Array.from({ length: colCount }, (_, i) =>
      i === 0 || i === 10 ? 28 : 14,
    ),
  };
}

/**
 * One row per visit, one column per active status, then the follow-up columns.
 *
 * A status with no visits still gets its column, all zeros, because its
 * absence would read as "not a status" rather than "nothing happened".
 *
 * The Total row is the SUM OF THE ROWS ABOVE IT (each status flag is 1 or 0,
 * and Follow-up Created likewise), not the RPC's totals — that is what makes
 * the number in the file an independent check on the number on the screen.
 *
 * Blank cells are null, not a placeholder: a missing check-in time is not a
 * recorded time and must not read like one. Duration is derived from the two
 * timestamps; Meeting purpose and Next action are read from the plan and visit
 * as recorded, not inferred.
 */
export function statusActivitySheetRows(
  statuses: readonly StatusColumn[],
  visits: readonly StatusActivityVisit[],
): CellValue[][] {
  const activeStatuses = new Set(statuses.map((status) => status.status));
  const isOther = (visit: StatusActivityVisit) =>
    !visit.status || !activeStatuses.has(visit.status);
  const header: CellValue[] = [
    ...VISIT_HEADERS,
    ...statuses.map((status) => status.status),
    OTHER_INACTIVE_STATUS_LABEL,
    ...FOLLOW_UP_HEADERS,
  ];

  const body = visits.map((visit) => [
    visit.institute,
    visit.member ?? null,
    activityLabel(visit.activity),
    visit.meetingPurpose ?? null,
    formatDate(visit.date) || null,
    visit.checkinAt ? formatDate(visit.checkinAt) : null,
    visit.checkinAt ? formatTime(visit.checkinAt) : null,
    visit.checkoutAt ? formatDate(visit.checkoutAt) : null,
    visit.checkoutAt ? formatTime(visit.checkoutAt) : null,
    durationOf(visit),
    visit.location ?? null,
    visit.status ?? null,
    nextActionLabel(visit.nextAction),
    visit.nextActionDate ? formatDate(visit.nextActionDate) : null,
    visit.totalFollowUps ?? 0,
    visit.openFollowUps ?? 0,
    ...statuses.map((status) => (visit.status === status.status ? 1 : 0)),
    isOther(visit) ? 1 : 0,
    visit.followUpDate ? formatDate(visit.followUpDate) : null,
    visit.followUpTime ? formatClockTime(visit.followUpTime) : null,
    visit.followUpCreated ? 1 : 0,
  ]);

  const total: CellValue[] = [
    "Total",
    ...Array<CellValue>(VISIT_HEADERS.length - 3).fill(null),
    visits.reduce((sum, visit) => sum + (visit.totalFollowUps ?? 0), 0),
    visits.reduce((sum, visit) => sum + (visit.openFollowUps ?? 0), 0),
    ...statuses.map(
      (status) => visits.filter((visit) => visit.status === status.status).length,
    ),
    visits.filter(isOther).length,
    null,
    null,
    visits.filter((visit) => visit.followUpCreated).length,
  ];

  return [header, ...body, total];
}

export function instituteActivitySheetRows(
  rows: readonly InstituteActivityRow[],
  /** SQL totals over all matching rows; falls back to the passed rows. */
  totals?: Record<ActivityType, { open: number; closed: number }>,
): CellValue[][] {
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

  const total: CellValue[] = [
    "Total",
    ...ACTIVITY_TYPES.flatMap((key) =>
      (["open", "closed"] as const).map((category) =>
        totals
          ? totals[key][category]
          : rows.reduce((sum, row) => sum + row.byActivity[key][category], 0),
      ),
    ),
  ];
  return [header, ...body, total];
}

export function repInstituteSheetRows(
  rows: readonly InstituteActivityRow[],
): CellValue[][] {
  const totals = sumInstituteActivityRows(rows);
  return [
    [
      "Institute",
      "Type",
      "Location",
      "Status",
      "Open",
      "Closed",
      "Follow-ups owned",
      "Follow-ups pending",
      "Meetings completed",
    ],
    ...rows.map((row) => {
      const oc = openClosedTotals(row);
      return [
        row.name,
        TYPE_LABELS[row.type],
        [row.area, row.city, row.state].filter(Boolean).join(", ") || "—",
        row.status ?? "No status yet",
        oc.open,
        oc.closed,
        row.followUpsOwned,
        row.followUpsPending,
        row.meetingsCompleted,
      ];
    }),
    [
      "Total",
      "",
      "",
      "",
      totals.open,
      totals.closed,
      rows.reduce((n, r) => n + r.followUpsOwned, 0),
      rows.reduce((n, r) => n + r.followUpsPending, 0),
      totals.meetingsCompleted,
    ],
  ];
}

export function presenceSheetRows(
  rows: readonly InstituteActivityRow[],
): CellValue[][] {
  const totals = sumInstituteActivityRows(rows);
  return [
    [
      "Institute Name",
      "Check-In Date and Time",
      "Check-Out Date and Time",
      "Location",
      "Number of Open Status activities",
      "Number of Closed Status activities",
      "Total Number of Visits",
      "Total Number of Meetings",
      "Total activity count",
    ],
    ...rows.map((row) => {
      const oc = openClosedTotals(row);
      return [
        row.name,
        row.lastCheckinAt ? formatDateTime(row.lastCheckinAt) : "Not recorded",
        row.lastCheckoutAt ? formatDateTime(row.lastCheckoutAt) : "Not recorded",
        row.lastCheckinAt ? formatArea(row.lastCheckinArea) : "—",
        oc.open,
        oc.closed,
        row.totalVisits,
        row.meetingsCompleted,
        row.totalActivities,
      ];
    }),
    [
      "Total",
      "",
      "",
      "",
      totals.open,
      totals.closed,
      totals.totalVisits,
      totals.meetingsCompleted,
      totals.totalActivities,
    ],
  ];
}

/** The admin/team-lead visit-level workbook, over EVERY matching visit. */
export async function buildInstituteStatusActivityExport(
  query: InstituteStatusActivityQuery = {},
): Promise<InstituteActivityExportResult> {
  // `p_page = 0` is the RPC's export mode: every matching institute and every
  // visit row, with the same 31-day ceiling enforced in SQL. Nothing is
  // assembled in the browser.
  const result = await getInstituteStatusActivityModel({
    ...query,
    allRows: true,
    page: undefined,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const dataRows = statusActivitySheetRows(
    result.model.statuses,
    result.model.visits,
  );
  const bytes = buildWorkbook(sheetFor(dataRows));
  const { from, to } = result.model.range;
  return {
    ok: true,
    filename: `institute-activity-${from ?? "start"}_${to ?? "end"}.xlsx`,
    bytes,
  };
}

/** The rep and presence workbooks, one institute per row. */
export async function buildInstituteActivityExport(
  query: InstituteActivityQuery & { view?: "rep" | "presence" } = {},
): Promise<InstituteActivityExportResult> {
  // Every export is the whole filtered set, not the page on screen.
  const allRows = true;
  const result = await getInstituteActivityModel({
    ...query,
    allRows,
    page: undefined,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const dataRows =
    query.view === "rep"
      ? statusActivitySheetRows(result.model.statuses, result.model.visits)
      : query.view === "presence"
        ? presenceSheetRows(result.model.rows)
        : instituteActivitySheetRows(
            result.model.rows,
            result.model.totals.byActivity,
          );
  const bytes = buildWorkbook(sheetFor(dataRows));
  const { from, to } = result.model.range;
  const stamp = from || to ? `${from ?? "start"}_${to ?? "end"}` : "all";
  return {
    ok: true,
    filename: `institute-activity-${stamp}.xlsx`,
    bytes,
  };
}
