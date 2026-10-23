import Link from "next/link";
import { formatArea } from "@/lib/location-display";
import { formatDateTime } from "@/lib/dates";
import {
  openClosedTotals,
  type InstituteActivityRow,
  type InstituteActivityTotals,
} from "@/lib/institute-activity-counts";

/**
 * R7 — a rep's own Activity Report, institute-wise.
 *
 * REPLACES THE OLD "Field presence" card list (one card per planned VISIT,
 * arrival and departure side by side) with one row per INSTITUTE — the
 * client's own ask. The two answer different questions and lose nothing in
 * the switch: the per-visit list told you about one check-in; this tells you,
 * for every institute you reached in the period, when you LAST arrived and
 * left, from how many visits, and what came of them.
 *
 * "Check-In" / "Check-Out" / "Location" are the LATEST plan row for that
 * institute in range — `getInstituteActivityModel()`'s own choice, stated in
 * its own comment, not a second decision made here. An institute visited more
 * than once (0033) shows its most recent arrival; "Total Visits" is what
 * says there were others. "Location" is that same arrival's check-in area —
 * one column, not the full coordinate/accuracy breakdown the old per-visit
 * cards carried, because this screen answers "where, roughly", not "prove it".
 *
 * NOT LINKED anywhere a rep cannot follow — `/review` is staff-only, so
 * unlike the admin grid these counts are plain numbers. The institute name
 * still links to `/institutes/[id]`, which a rep can always reach for their
 * own institute.
 */

function DateTime({ at }: { at: string | null }) {
  return at ? (
    <span className="tabular-nums">{formatDateTime(at)}</span>
  ) : (
    <span className="text-muted-foreground">Not recorded</span>
  );
}

const HEAD_CLASS =
  "bg-muted/60 text-muted-foreground sticky top-0 px-3 py-2 text-right text-xs font-medium whitespace-nowrap";

export function InstitutePresenceTable({
  rows,
  totals,
}: {
  rows: readonly InstituteActivityRow[];
  totals: InstituteActivityTotals;
}) {
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">
          Institutes reached this period, with the latest check-in and
          check-out on record for each
        </caption>
        <thead>
          <tr>
            {/*
              EXACT CLIENT WORDING, per Rep Side #7 — "columns must exactly
              match ... same names." Longer than a typical header on purpose;
              not shortened to "Check-in" / "Open" / "Closed" etc.
            */}
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 left-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              Institute Name
            </th>
            <th className={HEAD_CLASS}>Check-In Date and Time</th>
            <th className={HEAD_CLASS}>Check-Out Date and Time</th>
            <th className="bg-muted/60 text-muted-foreground sticky top-0 px-3 py-2 text-left text-xs font-medium whitespace-nowrap">
              Location
            </th>
            <th className={HEAD_CLASS}>Number of Open Status activities</th>
            <th className={HEAD_CLASS}>Number of Closed Status activities</th>
            <th className={HEAD_CLASS}>Total Number of Visits</th>
            <th className={HEAD_CLASS}>Total Number of Meetings</th>
            <th className={HEAD_CLASS}>Total activity count</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-muted-foreground px-3 py-8 text-center text-sm">
                No institutes reached in this period.
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
                    <Link prefetch={false} href={`/institutes/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-right">
                    <DateTime at={row.lastCheckinAt} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DateTime at={row.lastCheckoutAt} />
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-left whitespace-nowrap">
                    {row.lastCheckinAt ? formatArea(row.lastCheckinArea) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{oc.open}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{oc.closed}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.totalVisits}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.meetingsCompleted}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {row.totalActivities}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-border bg-muted/40 border-t font-medium">
              {/*
                "Total" rather than an invented label like "All institutes" —
                the client asked only for "the overall totals," not a name for
                this row. This is the minimal necessary plumbing to make a
                totals row legible, not an added label.
              */}
              <th scope="row" className="bg-muted/40 sticky left-0 px-3 py-2 text-left">
                Total
              </th>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums">{totals.open}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.closed}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.totalVisits}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {totals.meetingsCompleted}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {totals.totalActivities}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
