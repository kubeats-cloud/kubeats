import "server-only";

import { activitySheet } from "@/lib/exports/activity-grid";
import type { GridInput } from "@/lib/exports/activity-grid";
import { buildWorkbook } from "@/lib/xlsx";
import {
  getInstituteStatusModel,
  type InstituteStatusQuery,
} from "@/lib/institute-status-report";
import type { ExportResult } from "@/lib/exports/activity-export";

/**
 * Pipeline by Rep's Excel export (Activity tab, new).
 *
 * The screen had none — `/institutes/report` has never offered a download —
 * so this reuses `getInstituteStatusModel()` exactly as the on-screen
 * `CustomisableGrid` does, and hands its grid to `activitySheet()` the same
 * way `buildActivityExport()` does for the Rep Activity report. No new
 * counting: the workbook is `buildActivityGrid()`'s own rows, written rather
 * than drawn, which is what keeps a download byte-identical to the screen it
 * came from.
 *
 * `hiddenColumns` is never set, for the reason `customisable-grid.tsx`'s own
 * header comment gives for the Rep Activity export: a reader's column
 * preference is screen-only.
 */
export async function buildPipelineExport(
  query: InstituteStatusQuery = {},
): Promise<ExportResult> {
  const result = await getInstituteStatusModel(query);
  if (!result.ok) return { ok: false, error: result.error };

  const { reps, columns, unsetColumn } = result.model;
  const input: GridInput = {
    reps,
    columns,
    showActivities: false,
    unsetColumn: unsetColumn ?? undefined,
  };

  return {
    ok: true,
    filename: pipelineExportFilename(query.range),
    bytes: buildWorkbook(activitySheet(input, "Pipeline by rep")),
  };
}

/** A filename a person can find again: what it is and over what range. */
function pipelineExportFilename(range?: { from?: string; to?: string }): string {
  if (range?.from || range?.to) {
    return `kubeats-pipeline-${range.from ?? "start"}-to-${range.to ?? "today"}.xlsx`;
  }
  return "kubeats-pipeline-all-time.xlsx";
}
