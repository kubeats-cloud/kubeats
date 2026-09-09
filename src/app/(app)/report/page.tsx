import Link from "next/link";
import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { ActivitySummary } from "@/components/report/activity-summary";
import { PeriodControls } from "@/components/weekly/period-controls";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getActivityReport } from "@/lib/activity-report";
import { listReps } from "@/lib/closing-report";
import { memberName } from "@/lib/week-summary";
import {
  REPORT_PERIODS,
  isReportPeriod,
  normalisePeriodStart,
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
  const viewingOther = admin && !!requested && requested !== user.id;
  const memberId = viewingOther ? requested! : user.id;

  const [result, name, reps] = await Promise.all([
    getActivityReport(memberId, "", period, periodStart),
    viewingOther ? memberName(memberId) : Promise.resolve(user.name),
    admin ? listReps() : Promise.resolve([]),
  ]);

  const displayName = name ?? "this member";

  const repLink = (id: string) => {
    const params = new URLSearchParams({ period, start: periodStart });
    if (id !== user.id) params.set("member", id);
    return `/report?${params.toString()}`;
  };

  return (
    <PageColumn>
      <PageHeader
        eyebrow={viewingOther ? "Team member" : undefined}
        title={viewingOther ? displayName : "Activity report"}
        description={
          viewingOther
            ? "Their complete field activity for the period."
            : "Everywhere you have been and everything you have logged, by day, month or year."
        }
      />

      {/* An admin picks a rep. Rendered as links rather than a dropdown so the
          screen works before any JavaScript arrives, the same reasoning as the
          period controls. */}
      {admin && reps.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {reps.map((rep) => {
            const active = rep.id === memberId;
            return (
              <Button
                key={rep.id}
                asChild
                variant={active ? "default" : "outline"}
                className="h-9"
              >
                <Link href={repLink(rep.id)} aria-current={active ? "page" : undefined}>
                  {rep.name}
                </Link>
              </Button>
            );
          })}
        </div>
      )}

      <PeriodControls
        period={period}
        periodStart={periodStart}
        options={REPORT_PERIODS}
        member={viewingOther ? memberId : undefined}
        basePath="/report"
      />

      {!result.ok ? (
        <ErrorState message="We could not load this activity report. Please try again in a moment." />
      ) : (
        <ActivitySummary report={{ ...result.report, memberName: displayName }} />
      )}
    </PageColumn>
  );
}
