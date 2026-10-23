import Link from "next/link";
import { Fragment } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { COUNT_LINK_CLASS, COUNT_ZERO_CLASS } from "@/components/ui/count-link";
import {
  ACTIVITY_TYPES,
  type ActivityType,
} from "@/lib/validation/weekly";
import { INSTITUTE_ACTIVITY_LABELS } from "@/lib/institute-activity-counts";
import type {
  InstituteActivityRow,
  InstituteActivitySortKey,
} from "@/lib/institute-activity-counts";
import type { PipelineRange } from "@/lib/validation/pipeline-report";
import {
  instituteActivitySortHref,
  reviewCohortHref,
} from "@/lib/institute-activity-links";

/**
 * Institute-wise Activity Report grid.
 *
 * Renders the rows `getInstituteActivityModel` already sorted. Count cells
 * link into `/review` with the same institute / activity / category / date
 * window the cell was counted from.
 */

type SortState = { key: InstituteActivitySortKey; dir: "asc" | "desc" };

function CountCell({
  value,
  href,
}: {
  value: number;
  href: string | null;
}) {
  if (value <= 0 || !href) {
    return <span className={COUNT_ZERO_CLASS}>{value}</span>;
  }
  return (
    <Link prefetch={false} href={href} className={COUNT_LINK_CLASS}>
      {value}
    </Link>
  );
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
  sortKey: InstituteActivitySortKey;
  sort: SortState;
  range: PipelineRange;
  basePath?: string;
  extraParams?: Record<string,string>;
}) {
  const href = instituteActivitySortHref({
    key: sortKey,
    currentKey: sort.key,
    currentDir: sort.dir,
    range,
    basePath,
  extraParams,
  });
  const active = sort.key === sortKey;
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
      <Link prefetch={false}
        href={href}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="size-3.5 shrink-0" aria-hidden />
      </Link>
    </th>
  );
}

export function InstituteActivityTable({
  rows,
  sort,
  range,
  caption,
  basePath,
  extraParams,
}: {
  rows: readonly InstituteActivityRow[];
  sort: SortState;
  range: PipelineRange;
  caption: string;
  /** Where a sort-header click navigates. Defaults to this table's own page. */
  basePath?: string;
  extraParams?: Record<string,string>;
}) {
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
            {ACTIVITY_TYPES.map((activity) => (
              <th
                key={activity}
                colSpan={2}
                className="bg-muted/60 text-muted-foreground sticky top-0 z-20 px-3 py-2 text-center text-xs font-medium"
              >
                {INSTITUTE_ACTIVITY_LABELS[activity]}
              </th>
            ))}
          </tr>
          <tr>
            <th
              scope="col"
              className="bg-muted/40 text-muted-foreground sticky top-0 left-0 z-30 px-3 py-1.5 text-left text-[11px] font-medium"
            />
            {ACTIVITY_TYPES.flatMap((activity) => [
              <SortHeader
                key={`${activity}-open`}
                label="Open"
                sortKey={`${activity}_open` as InstituteActivitySortKey}
                sort={sort}
                range={range}
                basePath={basePath}
              extraParams={extraParams}
              />,
              <SortHeader
                key={`${activity}-closed`}
                label="Closed"
                sortKey={`${activity}_closed` as InstituteActivitySortKey}
                sort={sort}
                range={range}
                basePath={basePath}
              extraParams={extraParams}
              />,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={1 + ACTIVITY_TYPES.length * 2}
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
                  <Link prefetch={false}
                    href={`/institutes/${row.id}`}
                    className="hover:underline"
                  >
                    {row.name}
                  </Link>
                </th>
                {ACTIVITY_TYPES.map((activity: ActivityType) => (
                  <Fragment key={`${row.id}-${activity}`}>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <CountCell
                        value={row.byActivity[activity].open}
                        href={reviewCohortHref({
                          instituteId: row.id,
                          activity,
                          category: "open",
                          range,
                          member: extraParams?.member,
                        })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <CountCell
                        value={row.byActivity[activity].closed}
                        href={reviewCohortHref({
                          instituteId: row.id,
                          activity,
                          category: "closed",
                          range,
                          member: extraParams?.member,
                        })}
                      />
                    </td>
                  </Fragment>
                ))}
              </tr>
            ))
          )}
        </tbody>
        <tfoot><tr className="bg-muted/60 border-t font-semibold"><th className="bg-card sticky left-0 px-3 py-2 text-left">Total</th>
          {ACTIVITY_TYPES.flatMap(activity => (['open','closed'] as const).map(category => <td key={`${activity}-${category}`} className="px-3 py-2 text-right tabular-nums">{rows.reduce((sum,row) => sum + row.byActivity[activity][category],0)}</td>))}
        </tr></tfoot>
      </table>
    </div>
  );
}
