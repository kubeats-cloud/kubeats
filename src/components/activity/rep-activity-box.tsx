import { FileSpreadsheetIcon } from "lucide-react";
import { ErrorState } from "@/components/states";
import { RangeControls } from "@/components/report/range-controls";
import { DownloadButton } from "@/components/report/export-excel";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { ActivityToolbar } from "@/components/activity/activity-toolbar";
import { CollapsibleSection } from "@/components/activity/collapsible-section";
import { formatDate } from "@/lib/dates";
import type { ActivityReportModel } from "@/lib/exports/activity-export";

/**
 * Rep Activity, reusing exactly what `/team/report` renders: the same
 * `getActivityReportModel()` result (fetched once by the Activity page),
 * the same `CustomisableGrid` with `viewKey="activity-report"`, and the same
 * `/api/export/activity` route. `/team/report` itself is untouched — this is
 * a second home for the same report, not a replacement.
 */
export function RepActivityBox({
  start,
  end,
  extraParams,
  result,
}: {
  start: string;
  end: string;
  /** `tab=rep` plus whatever the other three reports currently have set, so
   *  applying this range does not reset them. */
  extraParams: Record<string, string>;
  result: { ok: true; model: ActivityReportModel } | { ok: false; error: string };
}) {
  return (
    <div>
      <ActivityToolbar>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <RangeControls
              start={start}
              end={end}
              basePath="/activity"
              extraParams={extraParams}
              idPrefix="rep-range"
              hint="Filters by when the activity was logged."
              clearable
              className=""
            />
          </div>

          {result.ok && (
            <DownloadButton
              href={`/api/export/activity?start=${start}&end=${end}`}
              variant="outline"
              className="h-11"
            >
              <FileSpreadsheetIcon className="size-4" aria-hidden />
              Download Excel
            </DownloadButton>
          )}
        </div>
      </ActivityToolbar>

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <p className="text-muted-foreground mb-2 text-xs">
            {formatDate(start)} – {formatDate(end)} · {result.model.counts.reps}{" "}
            rep{result.model.counts.reps === 1 ? "" : "s"} ·{" "}
            {result.model.counts.statuses} status
            {result.model.counts.statuses === 1 ? "" : "es"}
          </p>

          <CollapsibleSection label="the Rep Activity table">
            <CustomisableGrid
              viewKey="activity-report"
              reps={result.model.reps}
              columns={result.model.columns}
              showActivities={false}
              caption={`Activity by rep from ${start} to ${end}`}
            />
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}
