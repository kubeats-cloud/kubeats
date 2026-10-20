import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { COUNT_ZERO_CLASS } from "@/components/ui/count-link";
import {
  openClosedTotals,
  type InstituteActivityRow,
  type InstituteActivitySortKey,
} from "@/lib/institute-activity-counts";
import { instituteActivitySortHref } from "@/lib/institute-activity-links";
import type { PipelineRange } from "@/lib/validation/pipeline-report";

/**
 * R1 — a rep's own institute-wise activity, one row per institute they can see.
 *
 * NOT `InstituteActivityTable` (the admin grid): that one is twelve columns,
 * one Open/Closed pair per activity type, built for a registry an admin reads
 * on a desktop. A rep's own list is short and read on a phone, and R1 asks for
 * the AGGREGATE Open/Closed total rather than the per-type breakdown — so this
 * is its own, narrower component rather than a "compact" mode of the other one.
 *
 * NO REVIEW LINKS. `InstituteActivityTable`'s counts open `/review`, which is
 * staff-only — a rep following that link would be bounced straight back out.
 * Every number here is plain text; the institute name is still a link, into
 * `/institutes/[id]`, which a rep can always reach for their own institute.
 */

type SortState = { key: InstituteActivitySortKey; dir: "asc" | "desc" };

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
  basePath: string;
  extraParams?: Record<string, string>;
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
      className="bg-muted/60 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
    >
      <Link
        href={href}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className="size-3.5 shrink-0" aria-hidden />
      </Link>
    </th>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className={value > 0 ? "font-medium tabular-nums" : COUNT_ZERO_CLASS}>
      {value}
    </span>
  );
}

export function RepInstituteTable({
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
  basePath: string;
  /** Carried into every sort link — see `SortHeader`'s own comment. */
  extraParams?: Record<string, string>;
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
            <SortHeader
              label="Open"
              sortKey="open_total"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
            <SortHeader
              label="Closed"
              sortKey="closed_total"
              sort={sort}
              range={range}
              basePath={basePath}
              extraParams={extraParams}
            />
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
              <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center text-sm">
                No institutes in scope.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const oc = openClosedTotals(row);
              return (
                <tr key={row.id} className="border-border border-t">
                  <th
                    scope="row"
                    className="bg-card sticky left-0 px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    <Link href={`/institutes/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-right">
                    <Count value={oc.open} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Count value={oc.closed} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Count value={row.followUpsOwned} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Count value={row.followUpsPending} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.meetingsCompleted}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
