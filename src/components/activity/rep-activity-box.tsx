import { FileSpreadsheetIcon } from "lucide-react";
import { ErrorState } from "@/components/states";
import { RangeControls } from "@/components/report/range-controls";
import { DownloadButton } from "@/components/report/export-excel";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { ActivityToolbar } from "@/components/activity/activity-toolbar";
import { CollapsibleSection } from "@/components/activity/collapsible-section";
import { CampusFilter } from "@/components/campus-filter";
import { formatDate } from "@/lib/dates";
import type { Campus } from "@/lib/campus-display";
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
  campuses,
  campus,
  extraParams,
  result,
}: {
  start: string;
  end: string;
  /** The campuses this reader may choose between; one hides the control. */
  campuses: Campus[];
  /** The resolved campus, empty for "all". */
  campus?: string;
  /** `tab=rep` plus whatever the other three reports currently have set, so
   *  applying this range does not reset them. */
  extraParams: Record<string, string>;
  result: { ok: true; model: ActivityReportModel } | { ok: false; error: string };
}) {
  const exportParams = new URLSearchParams({ start, end });
  if (campus) exportParams.set("campus", campus);

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

          {/*
            Its own URL key (`repCampus`), because this card shares the page
            with three others and each keeps a separate filter namespace. The
            navigate form preserves every other parameter and restates the tab.
          */}
          <CampusFilter
            campuses={campuses}
            value={campus}
            paramName="repCampus"
            extraParams={{ tab: "rep" }}
            className="w-full space-y-1.5 sm:w-52"
          />

          {result.ok && (
            <DownloadButton
              href={`/api/export/activity?${exportParams.toString()}`}
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
