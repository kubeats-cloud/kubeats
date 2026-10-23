import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { COUNT_ZERO_CLASS } from "@/components/ui/count-link";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import {
  openClosedTotals,
  sumInstituteActivityRows,
  type InstituteActivityRow,
  type InstituteActivitySortKey,
} from "@/lib/institute-activity-counts";
import { instituteActivitySortHref } from "@/lib/institute-activity-links";
import { TYPE_LABELS, type StatusCatalogue } from "@/lib/validation/institute";
import type { PipelineRange } from "@/lib/validation/pipeline-report";

/**
 * R1 — a rep's single, consolidated institute-wise table: one row per
 * institute they can see, with institute details alongside the activity
 * counts, so this is the only table the Institute tab renders for a rep
 * (the correction pass folded the separate registry browser into this one).
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
 *
 * Type, Location and Status are plain (unsorted) columns — the client asked
 * for column sorting, not that every column carry it, and the five existing
 * sort keys (institute / open / closed / follow-ups / meetings) already cover
 * that ask.
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

function Count({ value }: { value: number }) {
  return (
    <span className={value > 0 ? "font-medium tabular-nums" : COUNT_ZERO_CLASS}>
      {value}
    </span>
  );
}

/** Area, city, state — the same join order `InstitutesBrowser` uses. */
function locationOf(row: InstituteActivityRow): string {
  return [row.area, row.city, row.state].filter(Boolean).join(", ");
}

export function RepInstituteTable({
  rows,
  sort,
  range,
  caption,
  basePath,
  extraParams,
  catalogue,
}: {
  rows: readonly InstituteActivityRow[];
  sort: SortState;
  range: PipelineRange;
  caption: string;
  basePath: string;
  /** Carried into every sort link — see `SortHeader`'s own comment. */
  extraParams?: Record<string, string>;
  /** For the Status column's badge. */
  catalogue: StatusCatalogue;
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
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              Type
            </th>
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              Location
            </th>
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              Status
            </th>
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
              <td colSpan={9} className="text-muted-foreground px-3 py-8 text-center text-sm">
                No institutes in scope.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const oc = openClosedTotals(row);
              const location = locationOf(row);
              return (
                <tr key={row.id} className="border-border border-t">
                  <th
                    scope="row"
                    className="bg-card sticky left-0 px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    <Link prefetch={false} href={`/institutes/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </th>
                  <td className="text-muted-foreground px-3 py-2 text-left whitespace-nowrap">
                    {TYPE_LABELS[row.type]}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-left whitespace-nowrap">
                    {location || "—"}
                  </td>
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <InstituteStatusBadge status={row.status} catalogue={catalogue} />
                  </td>
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
        <tfoot><tr className="bg-muted/60 border-t font-semibold">
          <th className="bg-card sticky left-0 px-3 py-2 text-left">Total</th><td /><td /><td />
          <td className="px-3 py-2 text-right">{sumInstituteActivityRows(rows).open}</td>
          <td className="px-3 py-2 text-right">{sumInstituteActivityRows(rows).closed}</td>
          <td className="px-3 py-2 text-right">{rows.reduce((n,r) => n+r.followUpsOwned,0)}</td>
          <td className="px-3 py-2 text-right">{rows.reduce((n,r) => n+r.followUpsPending,0)}</td>
          <td className="px-3 py-2 text-right">{sumInstituteActivityRows(rows).meetingsCompleted}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}
