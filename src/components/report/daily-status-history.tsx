import { SectionTitle } from "@/components/section-title";
import { formatDate } from "@/lib/dates";
import {
  DAILY_STATUS_LABELS,
  rowForRep,
  type DailyStatusReport,
} from "@/lib/validation/rep-daily-status";

/**
 * The rep's own recorded days for the range the page is showing.
 *
 * SERVER-RENDERED, unlike the toggle above it: this is a read, and the range
 * lives in the URL / PeriodControls, so a reload is exactly the right way for
 * it to change.
 *
 * ONLY RECORDED DAYS ARE LISTED. A day the rep did not declare has no row and
 * is not shown as "unknown" or inferred from check-ins — it is simply absent,
 * and the note under the table says so. The counts are therefore days
 * RECORDED, never days worked.
 */
export function DailyStatusHistory({
  report,
  repId,
}: {
  report: DailyStatusReport;
  repId: string;
}) {
  const row = rowForRep(report, repId);

  return (
    <section className="mt-6">
      <SectionTitle>
        Your daily status
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {formatDate(report.start)} – {formatDate(report.end)}
        </span>
      </SectionTitle>

      <p className="text-muted-foreground text-xs">
        In-Field {row.inField} · In-Office {row.inOffice} · On-Leave{" "}
        {row.onLeave} · Recorded {row.recorded}{" "}
        {row.recorded === 1 ? "day" : "days"}
      </p>

      <div className="border-border mt-3 overflow-x-auto rounded-lg border">
        <table className="w-max min-w-full border-collapse text-sm">
          <caption className="sr-only">
            Days you recorded a status, from {report.start} to {report.end}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="bg-muted/60 text-muted-foreground sticky top-0 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
              >
                Date
              </th>
              <th
                scope="col"
                className="bg-muted/60 text-muted-foreground sticky top-0 px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {row.days.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  No days recorded in this range.
                </td>
              </tr>
            ) : (
              row.days.map((day) => (
                <tr key={day.date} className="border-border border-t">
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatDate(day.date)}
                  </td>
                  <td className="px-3 py-2">
                    {DAILY_STATUS_LABELS[day.status]}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* The exclusion, stated where the numbers are. "Recorded" is the only
          total this screen prints, and it counts stored days — a day with no
          entry is in none of the three statuses and in no total. */}
      <p className="text-muted-foreground mt-2 text-xs">
        Days with no entry are not recorded and are not counted anywhere here.
        &ldquo;Recorded&rdquo; means days you declared a status, not days
        worked.
      </p>
    </section>
  );
}
