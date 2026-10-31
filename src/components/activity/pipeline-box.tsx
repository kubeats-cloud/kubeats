import { FileSpreadsheetIcon } from "lucide-react";
import { ErrorState } from "@/components/states";
import { RangeControls } from "@/components/report/range-controls";
import { DownloadButton } from "@/components/report/export-excel";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { ActivityToolbar } from "@/components/activity/activity-toolbar";
import { CollapsibleSection } from "@/components/activity/collapsible-section";
import { SORT_BY_REP, SORT_BY_TOTAL } from "@/lib/exports/activity-grid";
import {
  nextSortDirection,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";
import type { InstituteStatusModel } from "@/lib/institute-status-report";

/**
 * Pipeline by Rep, reusing exactly what `/institutes/report` renders: the
 * same `getInstituteStatusModel()` result, the same `CustomisableGrid` with
 * `viewKey="pipeline-report"`, `linkCohorts` and all of its original status
 * columns — nothing simplified. `/institutes/report` itself is untouched.
 *
 * ⚠ ITS OWN PARAM NAMES, UNLIKE EVERY OTHER REPORT HERE. Pipeline and
 * Institute-Wise Activity are the only two of the four that both already use
 * a bare `?from=&to=&sort=&dir=` — `RangeControls` optional mode for both,
 * `institute-activity-links.ts` hard-codes `from`/`to`/`sort`/`dir` for the
 * other. Institute-Wise Activity's whole stack (`ActivityFilters`,
 * `ActivityPages`, `instituteActivitySortHref`) is built around those bare
 * names in four collaborating files; reusing it unchanged, rather than
 * forking it to take a prefix, means Pipeline is the one that gets the
 * prefix instead — `pipeFrom`/`pipeTo` via `RangeControls`' new `paramNames`
 * prop, and `pipeSort`/`pipeDir` via the `sortHrefs` map built below, which
 * bypasses `pipelineHref()`/`sortHref()` (hard-coded to `/institutes/report`)
 * through `CustomisableGrid`'s existing escape hatch for exactly this case —
 * see its own comment: "screens whose query keys differ from the pipeline."
 * The Excel export still reads bare `from`/`to`/`sort`/`dir`, because that is
 * `/api/export/pipeline`'s own (new) contract, independent of this screen's
 * URL — see `pipelineExportHref` below.
 */
export function PipelineBox({
  range,
  extraParams,
  flat,
  result,
}: {
  range: PipelineRange;
  /** `tab=pipeline` plus everything the other three reports currently have
   *  set (including this report's own `pipeSort`/`pipeDir`, which
   *  `RangeControls` does not write itself and so must be carried). */
  extraParams: Record<string, string>;
  /** Every search param currently on the page, for the sort links below. */
  flat: Record<string, string>;
  result: { ok: true; model: InstituteStatusModel } | { ok: false; error: string };
}) {
  const sort = result.ok ? result.model.sort : { key: SORT_BY_REP, dir: "asc" as const };

  const allowed = result.ok
    ? [
        SORT_BY_REP,
        ...result.model.columns.closed.map((c) => c.status),
        ...result.model.columns.open.map((c) => c.status),
        ...(result.model.unsetColumn ? [result.model.unsetColumn.status] : []),
        SORT_BY_TOTAL,
      ]
    : [];

  const sortHrefs: Record<string, string> = {};
  for (const key of allowed) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(flat)) {
      if (name === "pipeSort" || name === "pipeDir" || name === "tab") continue;
      if (value) params.set(name, value);
    }
    params.set("tab", "pipeline");
    params.set("pipeSort", key);
    params.set("pipeDir", nextSortDirection(key, sort));
    sortHrefs[key] = `/activity?${params.toString()}`;
  }

  return (
    <div>
      <ActivityToolbar>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <RangeControls
              start={range.from ?? ""}
              end={range.to ?? ""}
              basePath="/activity"
              optional
              paramNames={{ from: "pipeFrom", to: "pipeTo" }}
              idPrefix="pipe-range"
              extraParams={extraParams}
              hint="Filters by when an institute's status last changed. Leave both blank for the whole pipeline."
              className=""
            />
          </div>

          {result.ok && (
            <DownloadButton
              href={pipelineExportHref(range, result.model.sort)}
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
          <CollapsibleSection label="the Pipeline by rep table">
            <CustomisableGrid
              viewKey="pipeline-report"
              reps={result.model.reps}
              columns={result.model.columns}
              showActivities={false}
              unsetColumn={result.model.unsetColumn ?? undefined}
              linkCohorts
              sort={result.model.sort}
              sortHrefs={sortHrefs}
              caption="Institutes by current status, per owning rep"
            />
          </CollapsibleSection>

          <p className="text-muted-foreground mt-3 text-xs">
            One row per rep, counted by who registered each institute. Every
            non-zero count opens those institutes.
          </p>
        </>
      )}
    </div>
  );
}

function pipelineExportHref(
  range: PipelineRange,
  sort: { key: string; dir: "asc" | "desc" },
): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  params.set("sort", sort.key);
  params.set("dir", sort.dir);
  return `/api/export/pipeline?${params.toString()}`;
}
