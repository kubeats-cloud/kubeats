import type { DailyStatusReport } from "@/lib/validation/rep-daily-status";

const HEAD_CLASS =
  "bg-muted/60 text-muted-foreground sticky top-0 px-3 py-2 text-right text-xs font-medium whitespace-nowrap";

/**
 * Daily status by rep, over the range the staff page is showing.
 *
 * FOUR COUNTS, chosen by the client: In-Field, In-Office, Leave, Recorded
 * Total. "Recorded Total" is the number of DAYS THAT CARRY A STATUS — not the
 * number of calendar days in the range, and not a worked-days figure. The note
 * under the table says so, because the four numbers would otherwise look like
 * they might sum to the range.
 *
 * LEAVE, NOT ON-LEAVE, in the header only: this is a count column, and the
 * toggle's three-way choice keeps the longer vocabulary. Same value either way
 * (see DAILY_STATUS_LABELS in validation/rep-daily-status.ts).
 *
 * THE FOOTER IS THE RPC's `totals` — every rep in the caller's scope, not just
 * the 50 on the page. On a one-page team the two are the same; on a larger one
 * the footer is the true whole-team figure, and the caption says so rather than
 * leaving a reader to add up a page and wonder.
 */
export function DailyStatusReportTable({
  report,
}: {
  report: DailyStatusReport;
}) {
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">
          Daily status by rep from {report.start} to {report.end}. Recorded
          Total counts days that have a status; days with no entry are not
          counted.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="bg-muted/60 text-muted-foreground sticky top-0 left-0 z-10 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
            >
              Rep
            </th>
            <th className={HEAD_CLASS}>In-Field</th>
            <th className={HEAD_CLASS}>In-Office</th>
            <th className={HEAD_CLASS}>Leave</th>
            <th className={HEAD_CLASS}>Recorded Total</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="text-muted-foreground px-3 py-8 text-center text-sm"
              >
                No reps in this range.
              </td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <tr key={row.id} className="border-border border-t">
                <th
                  scope="row"
                  className="bg-card sticky left-0 px-3 py-2 text-left font-medium whitespace-nowrap"
                >
                  {row.name}
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.inField}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.inOffice}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.onLeave}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {row.recorded}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {report.rows.length > 0 && (
          <tfoot>
            <tr className="border-border bg-muted/40 border-t font-medium">
              <th
                scope="row"
                className="bg-muted/40 sticky left-0 px-3 py-2 text-left"
              >
                Total
              </th>
              <td className="px-3 py-2 text-right tabular-nums">
                {report.totals.inField}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {report.totals.inOffice}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {report.totals.onLeave}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {report.totals.recorded}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
