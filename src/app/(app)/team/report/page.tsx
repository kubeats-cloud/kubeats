import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { RangeControls } from "@/components/report/range-controls";
import { ExportExcel } from "@/components/report/export-excel";
import { DailyStatusReportTable } from "@/components/report/daily-status-report-table";
import { requireStaff } from "@/lib/admin";
import { getActivityReportModel } from "@/lib/exports/activity-export";
import { getDailyStatusReport } from "@/lib/rep-daily-status";
import { exportRangeSchema } from "@/lib/validation/export";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Activity report" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The client's activity report: one row per rep, over a range.
 *
 * OFF THE NAV BAR, AND REACHED FROM TEAM. CLAUDE.md's restraint rule is about
 * the thumb-reachable bar, and an admin already has six tabs; this is the same
 * call `/materials/manage` and `/data` got — a screen used a few times a month
 * lives one tap deeper rather than costing every other tab its width. It sits
 * under /team because Team is the screen about the whole team, and the
 * dashboard card links straight here.
 *
 * THE RANGE IS IN THE URL, which is what lets the export button produce exactly
 * the report on screen: both read the same `?start=&end=`, and the server
 * validates them with the same schema the endpoint uses. Nothing is counted
 * twice and no default is written down in two places.
 */
export default async function TeamReportPage(props: PageProps<"/team/report">) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Activity report" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;

  // The same schema the endpoint parses, so an out-of-range or inverted range
  // is rejected identically here and there — and its defaults (this month,
  // resolved through todayISO()) are stated once, in that schema.
  const parsed = exportRangeSchema.safeParse({
    start: first(searchParams.start),
    end: first(searchParams.end),
  });

  if (!parsed.success) {
    return (
      <>
        <PageHeader title="Activity report" />
        <ErrorState
          message={
            parsed.error.issues[0]?.message ??
            "That date range is not one we can report on."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11">
          <Link href="/team/report">Back to this month</Link>
        </Button>
      </>
    );
  }

  const { start, end } = parsed.data;

  // Lenient, like the rest of the app's page params: a stale or hand-edited
  // `?page=` lands on page 1 rather than on an error. The RPC clamps a page
  // past the end to the last one, so only the lower bound needs saying here.
  const rawPage = Number.parseInt(first(searchParams.page) ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  const [result, daily] = await Promise.all([
    getActivityReportModel({ start, end }, null),
    // Same range as the activity report above, and the same RLS scope: an
    // admin gets every rep, a team lead only their own (supervises()). No
    // member filter — this section is about the whole scope, not one rep.
    getDailyStatusReport({ start, end, page }),
  ]);

  const dailyPageHref = (next: number) =>
    `/team/report?${new URLSearchParams({
      start,
      end,
      page: String(next),
    }).toString()}`;

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Activity report"
        description="What each rep did over the period, and where they left each institute."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/team">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Team
            </Link>
          </Button>
        }
      />

      <RangeControls start={start} end={end} basePath="/team/report" />

      {gate.isAdmin && (
        <Button asChild variant="outline" className="mb-3 h-11">
          <a href={`/api/export/activity?report=field-visits&start=${start}&end=${end}`} download>
            Download Field Visit Report
          </a>
        </Button>
      )}
      <p className="text-muted-foreground mb-3 text-xs">Field Visit Report exports check-in records in range, including arrivals without a logged status. A blank Check-Out Time means still open or not recorded; no time is invented. Status-event counts below exclude logged visits with no recorded status and are not the field-visit row count.</p>

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <ExportExcel start={start} end={end} label="Export to Excel" />

          <SectionTitle className="mt-6">
            The period
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatDate(start)} – {formatDate(end)}
            </span>
          </SectionTitle>

          {/*
            THE THIRD FIGURE IS NOT "VISITS", AND THE LABEL HAS TO SAY SO.

            `enforce_status_required()` (FO024, migration 0027) is INSERT-only,
            so every visit logged before it still legally carries a null
            `status_set_to`. Those rows are counted in the six activity columns
            of the export and contribute nothing to the status bands — so the
            grand total in the table's footer is strictly ≤ the number of visits
            in the range.

            Calling it "visits" would make the status bands look like they had
            quietly lost rows. Naming it for what it is makes the arithmetic
            legible, and is why `ActivityReportCounts` carries the figure under
            that name rather than this page computing one.
          */}
          <p className="text-muted-foreground mt-1 text-xs">
            {result.model.counts.reps} rep
            {result.model.counts.reps === 1 ? "" : "s"}
            {" · "}
            {result.model.counts.statuses} status
            {result.model.counts.statuses === 1 ? "" : "es"}
            {" · "}
            {result.model.counts.visitsWithStatus} visit
            {result.model.counts.visitsWithStatus === 1 ? "" : "s"} that recorded
            a status
          </p>

          <div className="mt-3">
            {/* Status bands only — `showActivities: false`. The six activity
                counts are what /team and /report already report, so on screen
                they crowded out the status columns this report exists for. The
                Excel export keeps all six: the flag is passed here, never by
                `activitySheet()`. See GridInput in activity-grid.ts. */}
            {/* The grid, with its columns and status categories foldable per
                reader (change-doc item 7). Display only: the same rows are
                fetched under the same RLS, and the Export button above is
                untouched — `activitySheet()` never sees a view preference. */}
            <CustomisableGrid
              viewKey="activity-report"
              reps={result.model.reps}
              columns={result.model.columns}
              showActivities={false}
              caption={`Activity by rep from ${start} to ${end}`}
            />
          </div>

          {/* The first sentence described the six activity columns, which are
              no longer on screen. The second is still what a reader needs.

              The third is new and earns its place: the Export button is
              directly above this, and the file it produces still carries the
              six activity columns. An admin comparing the two would otherwise
              have no way to know that is deliberate. */}
          <p className="text-muted-foreground mt-3 text-xs">
            Status columns are the vocabulary as it stands now, counted from
            where each visit left the institute. The Excel export also includes
            the six activity columns, which the Team and report screens show.
          </p>
        </>
      )}

      {/*
        DAILY STATUS IS A SEPARATE FACT FROM ACTIVITY, so it is a separate
        block rather than more columns on the grid above: where a rep declared
        they were working is not derivable from their visits, and a rep with a
        quiet week can still have been in the office every day.

        NO EXPORT BUTTON. The client asked for the counts on screen and nothing
        else; adding a file would be a new report with its own columns and
        notes, not a one-line reuse of the field-visit export.
      */}
      <SectionTitle className="mt-8">
        Daily status
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {formatDate(start)} – {formatDate(end)}
        </span>
      </SectionTitle>

      <p className="text-muted-foreground mb-3 text-xs">
        What each rep declared for themselves, one status per day
        {gate.isAdmin
          ? ", across the whole team."
          : ", for the reps on your team."}{" "}
        Recorded Total is the number of days that carry a status, not the number
        of calendar days in the range.
      </p>

      {!daily.ok ? (
        <ErrorState message={daily.error} />
      ) : (
        <>
          <DailyStatusReportTable report={daily.report} />

          <p className="text-muted-foreground mt-2 text-xs">
            Days with no entry are not recorded: they are not inferred from
            check-ins, they appear in none of the three status counts, and they
            are not in Recorded Total. A day that was recorded and later
            changed keeps only its latest value — the table is not an edit
            history.
          </p>

          {daily.report.pages > 1 && (
            <nav
              aria-label="Daily status pages"
              className="mt-3 flex items-center justify-between gap-2"
            >
              {daily.report.page > 1 ? (
                <Button asChild variant="outline" className="h-11">
                  <Link prefetch={false} href={dailyPageHref(daily.report.page - 1)}>
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" className="h-11" disabled>
                  Previous
                </Button>
              )}

              <p className="text-muted-foreground text-xs">
                Page {daily.report.page} of {daily.report.pages} ·{" "}
                {daily.report.total}{" "}
                {daily.report.total === 1 ? "rep" : "reps"}
              </p>

              {daily.report.page < daily.report.pages ? (
                <Button asChild variant="outline" className="h-11">
                  <Link prefetch={false} href={dailyPageHref(daily.report.page + 1)}>
                    Next
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" className="h-11" disabled>
                  Next
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
