import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { DailyPlan } from "@/components/dashboard/daily-plan";
import { TodaySnapshot } from "@/components/dashboard/today-snapshot";
import { MetricList } from "@/components/weekly/metric-list";
import { AdminOverview } from "@/components/admin/overview";
import { ActivityGridTable } from "@/components/report/activity-grid-table";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listStatusCatalogue } from "@/lib/statuses";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import { settled } from "@/lib/errors";
import {
  getTodayPlan,
  listInstitutesForPicker,
  listPurposes,
} from "@/lib/visits";
import { getWeekSummary } from "@/lib/week-summary";
import { formatWeekRange, mondayOf } from "@/lib/weeks";
import { formatDate, todayISO } from "@/lib/dates";
import { getOverview } from "@/lib/admin-workspace";
import { getActivityReportModel } from "@/lib/exports/activity-export";
import { defaultExportRange } from "@/lib/validation/export";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  const weekStart = mondayOf();

  // An admin loads the supervision view; a rep loads their own day. Neither
  // pays for the other's queries.
  // This month, for the admin's activity card. Stated by the export schema so
  // the card, the full report and the download cannot default differently.
  const range = defaultExportRange();

  /*
   * EVERY FETCH IS WRAPPED, because this is the screen a rep lands on.
   *
   * Each helper below already degrades on a database error. `Promise.all`
   * rejects as a whole the moment ANY of them rejects outright, though — a
   * dropped connection fetching the campus list would take the plan, the
   * institutes and the week's figures down with it and show the error
   * boundary instead of the Dashboard. `settled()` gives each one the same
   * fallback it would have returned for itself, so a rejection now costs one
   * panel rather than the screen.
   *
   * The fallbacks are deliberately the helpers' OWN: `{ ok: false }` is what
   * getTodayPlan answers with, SEED_STATUS_CATALOGUE is what listStatusCatalogue
   * falls back to. Nothing downstream can tell the two routes apart, which is
   * why this needed no change to how the page reads any of it.
   */
  const [plan, institutes, purposes, week, overview, catalogue, report] = await Promise.all([
    admin
      ? Promise.resolve({ ok: true as const, entries: [] })
      : settled(getTodayPlan(user.id), { ok: false as const }, "dashboard:plan"),
    admin
      ? Promise.resolve([])
      : settled(listInstitutesForPicker(), [], "dashboard:institutes"),
    admin ? Promise.resolve([]) : settled(listPurposes(), [], "dashboard:purposes"),
    admin
      ? Promise.resolve(null)
      : settled(getWeekSummary(user.id, weekStart), null, "dashboard:week"),
    admin ? settled(getOverview(), null, "dashboard:overview") : Promise.resolve(null),
    // The status vocabulary. Cheap, and needed by the plan picker to say when an
    // institute is being re-opened after a closed loop.
    settled(listStatusCatalogue(), SEED_STATUS_CATALOGUE, "dashboard:statuses"),
    admin
      ? settled(getActivityReportModel(range, null), null, "dashboard:report")
      : Promise.resolve(null),
  ]);

  const entries = plan.ok ? plan.entries : [];
  const held = entries.filter((entry) => entry.meetings_actual !== null).length;

  return (
    <>
      <PageHeader
        title={admin ? "Overview" : `Hello, ${user.name.split(" ")[0]}`}
        description={
          admin
            ? "What the team has been doing, and what is still open."
            : "Plan today's visits here, then log them as they happen."
        }
      />

      {/* Fieldwork belongs to reps. An admin's landing screen is supervision:
          what the team did, who was out, what is still open. */}
      {!admin && (
        <>
          <SectionTitle>Today</SectionTitle>
          <TodaySnapshot
            planned={entries.length}
            held={held}
          />

          {plan.ok ? (
            <DailyPlan
              institutes={institutes}
              purposes={purposes}
              entries={plan.entries}
              catalogue={catalogue}
            />
          ) : (
            <ErrorState message="We could not load today's plan. Please try again in a moment." />
          )}
        </>
      )}

      {admin ? (
        <>
          {overview?.ok ? (
            /* `todayISO()` read once and shared: the tile's counts and the
               link it opens must agree about which day it is. */
            <AdminOverview data={overview.data} today={todayISO()} />
          ) : (
            <ErrorState message="We could not load the team's activity just now. Please try again in a moment." />
          )}

          {/* THE SAME TABLE THE REPORT PAGE SHOWS, compact — and the same
              columns as it, so the card and the full report cannot say
              different things.

              The STATUS bands only: `showActivities: false` drops DASHBOARD
              ACTIVITIES, whose six counts repeated what /team and /report
              already show and pushed the status columns — the ones an admin
              opens this card to read — off the right-hand edge. Every status
              column is still here and still scrolls sideways rather than being
              dropped, because a status column invisible on the dashboard is one
              nobody knows to look for.

              The .xlsx is UNAFFECTED: the flag lives at the caller and the
              export never passes it. See GridInput in activity-grid.ts. */}
          <SectionTitle className="mt-8">
            Activity this month
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatDate(range.start)} – {formatDate(range.end)}
            </span>
          </SectionTitle>

          {report?.ok ? (
            <>
              <div className="mt-3">
                <ActivityGridTable
                  data={{
                    reps: report.model.reps,
                    columns: report.model.columns,
                    showActivities: false,
                  }}
                  compact
                  caption="Activity by rep this month"
                />
              </div>
              <Button asChild variant="outline" className="mt-3 h-11 w-full">
                <Link href="/team/report">View full report</Link>
              </Button>
            </>
          ) : (
            <ErrorState message="We could not load the activity report just now. Please try again in a moment." />
          )}
        </>
      ) : (
        <>
          <SectionTitle className="mt-8">
            This week
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatWeekRange(weekStart)}
            </span>
          </SectionTitle>
          {week?.ok ? (
            <>
              <MetricList
                title="Target vs achieved"
                targets={week.summary.record.targets}
                achieved={week.summary.achieved}
                emptyDescription="Set the eight numbers on the Targets tab, and the bars fill in as you log visits."
                emptyAction={
                  <Button asChild className="h-11">
                    <Link href="/targets">Set this week&rsquo;s targets</Link>
                  </Button>
                }
              />
              <Button asChild variant="outline" className="mt-3 h-11 w-full">
                <Link href="/targets">Open Targets</Link>
              </Button>
            </>
          ) : (
            <ErrorState message="We could not load this week's targets. Please try again in a moment." />
          )}
        </>
      )}
    </>
  );
}
