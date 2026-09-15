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
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listStatusCatalogue } from "@/lib/statuses";
import {
  getTodayPlan,
  listInstitutesForPicker,
  listPurposes,
  openLoopsByMember,
} from "@/lib/visits";
import { getWeekSummary } from "@/lib/week-summary";
import { formatWeekRange, mondayOf } from "@/lib/weeks";
import { getOverview } from "@/lib/admin-workspace";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  const weekStart = mondayOf();

  // An admin loads the supervision view; a rep loads their own day. Neither
  // pays for the other's queries.
  const [plan, institutes, purposes, openLoops, week, overview, catalogue] = await Promise.all([
    admin ? Promise.resolve({ ok: true as const, entries: [] }) : getTodayPlan(user.id),
    admin ? Promise.resolve([]) : listInstitutesForPicker(),
    admin ? Promise.resolve([]) : listPurposes(),
    admin ? Promise.resolve(new Map<string, number>()) : openLoopsByMember(),
    admin ? Promise.resolve(null) : getWeekSummary(user.id, weekStart),
    admin ? getOverview() : Promise.resolve(null),
    // The status vocabulary. Cheap, and needed by the plan picker to say when an
    // institute is being re-opened after a closed loop.
    listStatusCatalogue(),
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
            openLoops={openLoops.get(user.id) ?? 0}
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
        overview?.ok ? (
          <AdminOverview data={overview.data} />
        ) : (
          <ErrorState message="We could not load the team's activity just now. Please try again in a moment." />
        )
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
