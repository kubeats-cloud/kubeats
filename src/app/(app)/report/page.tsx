import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { ActivitySummary } from "@/components/report/activity-summary";
import { PeriodControls } from "@/components/weekly/period-controls";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { ExportExcel } from "@/components/report/export-excel";
import { getActivityReport } from "@/lib/activity-report";
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

  const memberId = user.id;

  const result = await getActivityReport(memberId, "", period, periodStart);
  const displayName = user.name;

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

      {/* ADMIN ONLY, because the endpoint is. A rep would get a 403 saved as a
          .xlsx, which is a worse answer than no button.

          The range follows the period ON SCREEN rather than always being this
          month: an admin looking at August who exports should get August. The
          page itself defaults to the current month, so the default range is
          still the current month — it simply stays in step when they navigate. */}
      {admin && (
        <div className="my-4">
          <ExportExcel
            {...periodRange(period, periodStart)}
            member={memberId}
            label={`Export ${displayName}'s activity`}
          />
        </div>
      )}


      {!result.ok ? (
        <ErrorState message="We could not load this activity report. Please try again in a moment." />
      ) : (
        <ActivitySummary report={{ ...result.report, memberName: displayName }} />
      )}
    </PageColumn>
  );
}
