import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { ActivitySummary } from "@/components/report/activity-summary";
import { PeriodControls } from "@/components/weekly/period-controls";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { ExportExcel } from "@/components/report/export-excel";
import { getActivityReport } from "@/lib/activity-report";
import { getInstituteActivityModel } from "@/lib/institute-activity-report";
import { sumInstituteActivityRows } from "@/lib/institute-activity-counts";
import { ActivityPages } from '@/components/report/activity-pages';
import { DailyStatusHistory } from '@/components/report/daily-status-history';
import { getDailyStatusReport } from '@/lib/rep-daily-status';
import { instituteActivityExportHref, instituteActivityExportRangeProblem } from '@/lib/institute-activity-links';
import {
  REPORT_PERIODS,
  isReportPeriod,
  normalisePeriodStart,
  periodRange,
  type ReportPeriod,
} from "@/lib/periods";

export const metadata = { title: "Activity report" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * One rep's field activity, aggregated over a day, a month or a year.
 *
 * This reads what /review reads and counts it instead of listing it. Nothing
 * here is collected for this screen.
 *
 * Who may see whose: a rep sees only themselves. That is enforced three times —
 * here, by ignoring ?member= for a non-admin; by RLS, which is what actually
 * decides which visit rows come back; and by the fact that the aggregation runs
 * as the signed-in user rather than with any elevated key. The check here
 * exists so a rep who edits the URL lands on their own numbers rather than on
 * an error.
 */
export default async function ReportPage(props: PageProps<"/report">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;

  const periodParam = first(searchParams.period);
  const period: ReportPeriod = isReportPeriod(periodParam) ? periodParam : "monthly";
  const periodStart = normalisePeriodStart(period, first(searchParams.start));

  const admin = isAdmin(user);
  const requested = first(searchParams.member);

  /*
   * ?member= IS THE REP HUB'S QUESTION NOW, so an admin asking it here is sent
   * there instead of being answered twice.
   *
   * /team/[memberId] shows this report AND the week, the pipeline, the
   * register and what is owed — everything /report?member= showed plus the
   * five screens an admin used to visit afterwards. Keeping both would leave
   * two pages answering "how is this rep doing" with different amounts of the
   * answer, and the weaker one reachable from links already in the wild.
   *
   * A REDIRECT RATHER THAN A DELETED PARAMETER, because those links exist: in
   * bookmarks, in the export button's history, and in anything the client has
   * sent each other. They keep working and land somewhere better.
   *
   * ONLY FOR AN ADMIN. A rep has no business reading another rep's activity
   * and /team is closed to them, so for them ?member= is ignored exactly as it
   * always was — silently, landing on their own report rather than on an
   * error, which is the existing behaviour and the right one for a URL they
   * may have been sent by mistake.
   */
  if (admin && requested && requested !== user.id) {
    const params = new URLSearchParams({ period, start: periodStart });
    redirect(`/team/${requested}?${params.toString()}`);
  }

  /*
   * AN ADMIN IS NEVER THE SUBJECT OF AN ACTIVITY REPORT.
   *
   * Without this, an admin reaching /report with no ?member= fell through to
   * `memberId = user.id` and got their OWN activity — "Pavan's activity",
   * every panel empty, as though they were a rep who had done nothing. They
   * are not: FO021 gives an admin no campus and 0028 no institutes, so they
   * log no visits and never will. The screen was answering a question that
   * cannot have an answer.
   *
   * It became reachable when the chip grid came off this page: that grid was
   * the admin's way to pick somebody, and with it gone /report had no meaning
   * for them at all. Sending them to the TEAM's activity is the nearest true
   * answer to what they clicked — "activity report" — and /team/report is the
   * screen that owns it.
   *
   * Placed after the ?member= redirect above so an admin who names a rep still
   * reaches that rep's hub; only the subject-less case lands here.
   */
  if (admin) redirect("/team/report");

  const memberId = user.id;
  const range = periodRange(period, periodStart);
  // Only a rep has a daily-status history to read; a team lead reaches this
  // page by URL and is refused by 0069's RPC and policies. The WRITE control
  // lives on the Dashboard — this page keeps only the report.
  const isRep = user.role === "rep";

  const [result, instituteActivityResult, historyResult] = await Promise.all([
    getActivityReport(memberId, "", period, periodStart),
    // R7's institute-wise table, same model A1 and R1 read. No member filter
    // to pass: this page only ever runs as the signed-in rep, and RLS is what
    // narrows `getInstituteActivityModel()` to their own institutes.
    getInstituteActivityModel({ range: { from: range.start, to: range.end }, page: first(searchParams.page) }),
    // The same period the rest of the page shows, so "your daily status"
    // below PeriodControls answers about the days on screen.
    isRep
      ? getDailyStatusReport({
          start: range.start,
          end: range.end,
          member: memberId,
        })
      : Promise.resolve(null),
  ]);
  const displayName = user.name;
  const presenceExportProblem = instituteActivityExportRangeProblem({
    from: range.start,
    to: range.end,
  });

  return (
    <PageColumn>
      <PageHeader
        title="Activity report"
        description="Your visits and what came of them, by day, month or year."
      />

      {/*
        THE CHIP GRID IS GONE — ~47 name buttons above a report about one of
        them, which was the only way to pick a rep before /team's names opened
        anything. Choosing a person is /team's job and switching between them
        is the rep hub's; this screen is one person's own activity and says so
        in its title again.

        No `member` prop on the controls either: this page only ever renders
        the signed-in user now, so there is nothing to carry.
      */}
      <PeriodControls
        period={period}
        periodStart={periodStart}
        options={REPORT_PERIODS}
        basePath="/report"
      />

      {/* Below the period controls, so this history follows the range on
          screen. Read-only; the toggle on the Dashboard is the only write. */}
      {isRep &&
        (historyResult?.ok ? (
          <DailyStatusHistory report={historyResult.report} repId={memberId} />
        ) : (
          <p className="text-muted-foreground mt-4 text-sm">
            {historyResult?.error}
          </p>
        ))}

      {/* ADMIN ONLY, because the endpoint is. A rep would get a 403 saved as a
          .xlsx, which is a worse answer than no button.

          The range follows the period ON SCREEN rather than always being this
          month: an admin looking at August who exports should get August. The
          page itself defaults to the current month, so the default range is
          still the current month — it simply stays in step when they navigate. */}
      {admin && (
        <div className="my-4">
          <ExportExcel
            start={range.start}
            end={range.end}
            member={memberId}
            label={`Export ${displayName}'s activity`}
          />
        </div>
      )}


      {instituteActivityResult.ok && <ActivityPages model={instituteActivityResult.model} basePath="/report" params={{period,start:periodStart}} />}
      {/*
        THE EXPORT NEEDS A COMPLETE RANGE OF AT MOST 31 DAYS (0060). A day or
        month qualifies; a year does not, so it gets the reason instead of a
        download that would come back refused. The link carries no page: the
        file covers every institute, never just the page on screen.
      */}
      {instituteActivityResult.ok && (presenceExportProblem ? (
        <p className="text-muted-foreground my-3 text-sm">{presenceExportProblem}</p>
      ) : (
        <a download className="my-3 inline-flex min-h-11 items-center rounded-md border px-4" href={instituteActivityExportHref({range:instituteActivityResult.model.range,sortKey:instituteActivityResult.model.sort.key,sortDir:instituteActivityResult.model.sort.dir,view:'presence'})}>Download Excel</a>
      ))}
      <p className="text-muted-foreground mb-3 text-xs">Summary Total visits counts your logged visit rows, including institutes no longer yours. The institute table covers the displayed page of your currently assigned institutes; its Total row sums that page, while Download Excel covers every row matching the range. Total Number of Visits uses the same logged-visit-row unit as the summary; Total Number of Meetings counts held plan meetings. Total activity count counts logged visit rows; Open/Closed use each visit&apos;s recorded status category. Check-in/out is the latest recorded arrival in range; missing times are never invented.</p>
      {!result.ok ? (
        <ErrorState message="We could not load this activity report. Please try again in a moment." />
      ) : (
        <ActivitySummary
          report={{ ...result.report, memberName: displayName }}
          instituteActivity={
            instituteActivityResult.ok
              ? {
                  rows: instituteActivityResult.model.rows,
                  totals: sumInstituteActivityRows(instituteActivityResult.model.rows),
                }
              : null
          }
        />
      )}
    </PageColumn>
  );
}
