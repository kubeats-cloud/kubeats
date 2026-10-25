import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  inactiveStatusCount,
  type StatusColumn,
} from "@/lib/institute-activity-counts";
import type { PipelineRange } from "@/lib/validation/pipeline-report";
import { instituteActivitySortHref } from "@/lib/institute-activity-links";
import { OTHER_INACTIVE_STATUS_LABEL } from "@/lib/exports/activity-grid";

/**
 * The Institute Activity table: one row per institute, one column per active
 * status, in the app's status order.
 *
 * The status columns come from `institute_statuses` rather than a hard-coded
 * list, so adding a status on the Targets page adds a column here and in the
 * Excel with no code change. A status with no visits still shows its column,
 * all zeros — its absence would read as "not a status" rather than "nothing
 * happened".
 *
 * The footer is the SQL totals over EVERY matching institute, not the page on
 * screen, which is the same set the Excel's Total row sums.
 */

export interface StatusActivityTableRow {
  id: string;
  name: string;
  byStatus: Record<string, number>;
  totalVisits: number;
  meetingsCompleted: number;
  followUpsOwned: number;
  followUpsPending: number;
}

function SortHeader({
  label,
  sortKey,
  sort,
  range,
  basePath,
  extraParams,
}: {
  label: string;
  sortKey: string;
  sort: { key: string; dir: "asc" | "desc" };
  range: PipelineRange;
  basePath?: string;
  extraParams?: Record<string, string>;
}) {
  const active = sort.key === sortKey;
  const href = instituteActivitySortHref({
    key: sortKey,
    currentKey: sort.key,
    currentDir: sort.dir,
    range,
    basePath,
    extraParams,
  });
  const Icon = !active
    ? ChevronsUpDownIcon
    : sort.dir === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon;

  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className="bg-muted/60 text-muted-foreground sticky top-0 z-20 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
    >
      <Link
        prefetch={false}
        href={href}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="size-3.5 shrink-0" aria-hidden />
      </Link>
    </th>
  );
}

export function InstituteStatusActivityTable({
  rows,
  statuses,
  totals,
  sort,
  range,
  caption,
  basePath,
  extraParams,
}: {
  rows: readonly StatusActivityTableRow[];
  statuses: readonly StatusColumn[];
  /** SQL totals over every matching institute, not only the shown page. */
  totals: {
    byStatus: Record<string, number>;
    totalVisits: number;
    meetingsCompleted: number;
    followUpsOwned: number;
    followUpsPending: number;
  };
  sort: { key: string; dir: "asc" | "desc" };
  range: PipelineRange;
  caption: string;
  basePath?: string;
  extraParams?: Record<string, string>;
}) {
  const columnCount = 3 + statuses.length + 3;
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <SortHeader
              label="Institute"
              sortKey="institute"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
            <SortHeader
              label="Total visits"
              sortKey="total_visits"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
            {statuses.map((status) => (
              <SortHeader
                key={status.status}
                label={status.status}
                sortKey={`status:${status.status}`}
                sort={sort}
                range={range}
                basePath={basePath}
                extraParams={extraParams}
              />
            ))}
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 z-20 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              {OTHER_INACTIVE_STATUS_LABEL}
            </th>
            <SortHeader
              label="Follow-ups owned"
              sortKey="follow_ups_owned"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
            <SortHeader
              label="Follow-ups pending"
              sortKey="follow_ups_pending"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
            <SortHeader
              label="Meetings completed"
              sortKey="meetings_completed"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columnCount}
                className="text-muted-foreground px-3 py-8 text-center text-sm"
              >
                No institutes in scope.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-border border-t">
                <th
                  scope="row"
                  className="bg-card sticky left-0 z-10 px-3 py-2 text-left font-medium whitespace-nowrap"
                >
                  <Link
                    prefetch={false}
                    href={`/institutes/${row.id}`}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.totalVisits}
                </td>
                {statuses.map((status) => (
                  <td
                    key={status.status}
                    className="px-3 py-2 text-right tabular-nums"
                  >
                    {row.byStatus[status.status] ?? 0}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">
                  {inactiveStatusCount(row, statuses)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.followUpsOwned}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.followUpsPending}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.meetingsCompleted}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-muted/60 border-t font-semibold">
            <th className="bg-card sticky left-0 px-3 py-2 text-left">Total</th>
            <td className="px-3 py-2 text-right tabular-nums">
              {totals.totalVisits}
            </td>
            {statuses.map((status) => (
              <td
                key={status.status}
                className="px-3 py-2 text-right tabular-nums"
              >
                {totals.byStatus[status.status] ?? 0}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums">
              {inactiveStatusCount(totals, statuses)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {totals.followUpsOwned}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {totals.followUpsPending}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {totals.meetingsCompleted}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
