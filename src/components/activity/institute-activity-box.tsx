import { ErrorState } from "@/components/states";
import { ActivityFilters } from "@/components/report/activity-filters";
import { RangeControls } from "@/components/report/range-controls";
import { DownloadButton } from "@/components/report/export-excel";
import { ActivityPages } from "@/components/report/activity-pages";
import { InstituteStatusActivityTable } from "@/components/report/institute-status-activity-table";
import { ActivityToolbar } from "@/components/activity/activity-toolbar";
import { CollapsibleSection } from "@/components/activity/collapsible-section";
import {
  instituteActivityExportHref,
  instituteActivityExportRangeProblem,
} from "@/lib/institute-activity-links";
import type { InstituteStatusActivityModel } from "@/lib/institute-activity-report";
import type { PipelineRange } from "@/lib/validation/pipeline-report";

/**
 * Institute-Wise Activity, reusing exactly what `/institutes?view=activity`
 * renders: the same `getInstituteStatusActivityModel()` result, the same
 * `ActivityFilters` / `ActivityPages` / `InstituteStatusActivityTable`, and
 * the same `/api/export/institute-activity` route. `/institutes` itself is
 * untouched.
 *
 * KEEPS ITS OWN BARE `from`/`to`/`sort`/`dir`/`page`/`member`/`campus`/`q` —
 * see `pipeline-box.tsx`'s header comment for why Pipeline, not this report,
 * is the one that took a prefix. Every component here already accepts a
 * `basePath`/`action`/`extraParams`/`preserve` override, so pointing them at
 * `/activity` needed no change beyond `preserve` gaining the other three
 * reports' own keys (plus `tab`) in `activity-filters.tsx`.
 */
export function InstituteActivityBox({
  params,
  range,
  rangeError,
  extraParams,
  search,
  member,
  campus,
  result,
}: {
  /** The full current query string, for `ActivityFilters`' hidden-preserve
   *  inputs — it reads only the keys it is told to preserve, so handing it
   *  everything is harmless. */
  params: Record<string, string>;
  range: PipelineRange;
  rangeError: string | null;
  /** `tab=institute` plus the other three reports' own current params. */
  extraParams: Record<string, string>;
  search?: string;
  member?: string;
  campus?: string;
  result:
    | { ok: true; model: InstituteStatusActivityModel }
    | { ok: false; error: string }
    | null;
}) {
  const exportProblem = instituteActivityExportRangeProblem(range);
  // Clear this report's own filters, but keep the other three reports' state
  // and this card's identity — the same rule every other box follows.
  const clearQuery = new URLSearchParams(extraParams).toString();
  const ownFilters = {
    ...(search ? { q: search } : {}),
    ...(member ? { member } : {}),
    ...(campus ? { campus } : {}),
  };
  // A new range or page must keep the sort the reader chose — the original
  // /institutes screen passed sort/dir along in its own extraParams too.
  const sortParams: Record<string, string> = result?.ok
    ? { sort: result.model.sort.key, dir: result.model.sort.dir }
    : {};

  return (
    <div>
      <ActivityFilters
        params={params}
        action="/activity"
        clearHref={clearQuery ? `/activity?${clearQuery}` : "/activity?tab=institute"}
        preserve={[
          "tab",
          "start",
          "end",
          "callFrom",
          "callTo",
          "callMember",
          "callInstitute",
          "callStatus",
          "callSort",
          "callDir",
          "callPage",
          "pipeFrom",
          "pipeTo",
          "pipeSort",
          "pipeDir",
        ]}
      />
      <ActivityToolbar>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <RangeControls
              start={range.from ?? ""}
              end={range.to ?? ""}
              basePath="/activity"
              optional
              idPrefix="institute-range"
              extraParams={{ ...extraParams, ...ownFilters, ...sortParams, page: "1" }}
              hint="Filters by the date the work was logged. Leave both blank for all time; the Excel export needs both dates."
              className=""
            />
          </div>

          {result?.ok &&
            (exportProblem ? (
              // Its own row below `sm`: beside the controls it left them
              // 27px wide at 400px, which overflowed the date inputs. The
              // max-width is `sm:` only — it would clamp the basis below
              // 100% and defeat the wrap.
              <p className="text-muted-foreground basis-full text-sm sm:basis-auto sm:max-w-xs">
                {exportProblem}
              </p>
            ) : (
              <DownloadButton
                variant="outline"
                className="h-11"
                href={instituteActivityExportHref({
                  range: result.model.range,
                  sortKey: result.model.sort.key,
                  sortDir: result.model.sort.dir,
                  search,
                  member,
                  campus,
                })}
              >
                Download Excel
              </DownloadButton>
            ))}
        </div>
      </ActivityToolbar>

      {rangeError ? (
        <ErrorState message={rangeError} />
      ) : !result?.ok ? (
        <ErrorState
          message={
            result && !result.ok
              ? result.error
              : "We could not load the institute activity just now. Please try again in a moment."
          }
        />
      ) : (
        <>
          <ActivityPages
            model={result.model}
            basePath="/activity"
            params={{ ...extraParams, ...ownFilters, ...sortParams }}
          />
          <CollapsibleSection label="the Institute-Wise Activity table">
            <InstituteStatusActivityTable
              rows={result.model.rows}
              statuses={result.model.statuses}
              totals={result.model.totals}
              sort={result.model.sort}
              range={result.model.range}
              basePath="/activity"
              caption="One row per institute, one column per active status"
              extraParams={{ ...extraParams, ...ownFilters }}
            />
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}
