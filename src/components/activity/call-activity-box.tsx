import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, FileSpreadsheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { FormNotice } from "@/components/form-notice";
import { CallActivityFilters } from "@/components/report/call-activity-filters";
import { DownloadButton } from "@/components/report/export-excel";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { ActivityToolbar } from "@/components/activity/activity-toolbar";
import { CollapsibleSection } from "@/components/activity/collapsible-section";
import {
  totalsRow,
  type CallActivityFilters as CallActivityFilterValues,
  type CallActivityReportModel,
  type CallActivitySort,
} from "@/lib/call-activity-report";

/**
 * Call Activity — the per-rep status-count summary that used to sit below the
 * register on `/review`, moved here as its own card. It is the same query
 * (`getCallActivityReport()`), the same grid (`viewKey="call-activity-report"`)
 * and the same `/api/export/call-activity` route; only its home and toolbar
 * changed. `/review` keeps the Call/Visit report list, its filters and its
 * correct-a-call editing, and no longer renders this table.
 *
 * The sort/page links are built the same way `/review` builds its own — a
 * local closure over the full current query string, with only this report's
 * own `call*` keys replaced — except the destination is `/activity` and
 * `tab` is always forced to `"call"` (see `ActivityTabs`'s header comment for
 * why that forcing, rather than trusting whatever `?tab=` already says, is
 * the part that keeps the right card selected after a reload).
 */
export function CallActivityBox({
  reps,
  statuses,
  filters,
  sort,
  notices,
  result,
  flat,
}: {
  reps: { id: string; name: string }[];
  statuses: { status: string; category: "open" | "closed" }[];
  filters: CallActivityFilterValues;
  sort: CallActivitySort;
  notices: string[];
  result:
    | ({ ok: true } & CallActivityReportModel)
    | { ok: false; error: string };
  /** Every other search param currently on the page, so a sort/page link
   *  here does not drop the other three reports' own state. */
  flat: Record<string, string>;
}) {
  function href(overrides: Record<string, string | null>) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(flat)) {
      if (value) params.set(name, value);
    }
    for (const [name, value] of Object.entries(overrides)) {
      if (value === null) params.delete(name);
      else params.set(name, value);
    }
    params.set("tab", "call");
    const query = params.toString();
    return query ? `/activity?${query}` : "/activity";
  }

  const sortHrefs: Record<string, string> = {};
  if (result.ok) {
    for (const key of [
      "rep",
      "open_total",
      "closed_total",
      "total",
      ...result.columns.closed.map((c) => `status:${c.status}`),
      ...result.columns.open.map((c) => `status:${c.status}`),
    ]) {
      const dir =
        sort.key === key
          ? sort.dir === "asc"
            ? "desc"
            : "asc"
          : key === "rep"
            ? "asc"
            : "desc";
      sortHrefs[key] = href({ callSort: key, callDir: dir, callPage: null });
    }
  }
  const pageHref = (page: number) =>
    href({ callPage: page <= 1 ? null : String(page) });

  return (
    <div>
      <ActivityToolbar>
        <CallActivityFilters
          reps={reps}
          statuses={statuses}
          initial={filters}
          basePath="/activity"
          extraParams={{ tab: "call" }}
          actions={
            <DownloadButton
              href={`/api/export/call-activity?${new URLSearchParams(
                Object.entries({
                  from: filters.from,
                  to: filters.to,
                  member: filters.member,
                  institute: filters.institute,
                  status: filters.status,
                }).filter((entry): entry is [string, string] => Boolean(entry[1])),
              ).toString()}`}
              variant="outline"
              className="h-9"
            >
              <FileSpreadsheetIcon className="size-4" aria-hidden />
              Download Excel
            </DownloadButton>
          }
        />
      </ActivityToolbar>

      {notices.map((notice) => (
        <div key={notice} className="mb-3">
          <FormNotice message={notice} />
        </div>
      ))}

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <CollapsibleSection label="the Call Activity table">
          <CustomisableGrid
            viewKey="call-activity-report"
            reps={result.reps}
            columns={result.columns}
            totalsReps={[totalsRow(result.totals)]}
            showActivities={false}
            showGroupTotals
            linkReps
            sort={sort}
            sortHrefs={sortHrefs}
            caption="Call Activity Report — one row per rep"
          />

          {result.pages > 1 && (
            <nav
              className="mt-3 flex items-center justify-between gap-3"
              aria-label="Call Activity Report pages"
            >
              <Button
                asChild={result.page > 1}
                variant="outline"
                className="h-11"
                disabled={result.page <= 1}
              >
                {result.page > 1 ? (
                  <Link href={pageHref(result.page - 1)} scroll={false}>
                    <ChevronLeftIcon className="size-4" aria-hidden />
                    Newer
                  </Link>
                ) : (
                  <span>
                    <ChevronLeftIcon className="size-4" aria-hidden />
                    Newer
                  </span>
                )}
              </Button>

              <p
                className="text-muted-foreground text-xs tabular-nums"
                aria-live="polite"
              >
                Page {result.page} of {result.pages}
              </p>

              <Button
                asChild={result.page < result.pages}
                variant="outline"
                className="h-11"
                disabled={result.page >= result.pages}
              >
                {result.page < result.pages ? (
                  <Link href={pageHref(result.page + 1)} scroll={false}>
                    Older
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <span>
                    Older
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </span>
                )}
              </Button>
            </nav>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}
