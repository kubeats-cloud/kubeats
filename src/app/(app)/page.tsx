import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { DailyPlan } from "@/components/dashboard/daily-plan";
import { TeamSnapshot } from "@/components/dashboard/team-snapshot";
import { TodaySnapshot } from "@/components/dashboard/today-snapshot";
import { MetricList } from "@/components/weekly/metric-list";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  getTodayPlan,
  listInstitutesForPicker,
  listPurposes,
  openLoopsByMember,
} from "@/lib/visits";
import { getTeamWeek, getWeek } from "@/lib/weekly";
import { formatWeekRange, mondayOf } from "@/lib/weeks";

export const metadata = { title: "Dashboard · Field Ops" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  const weekStart = mondayOf();

  const [plan, institutes, purposes, openLoops, week, team] = await Promise.all([
    getTodayPlan(user.id),
    listInstitutesForPicker(),
    listPurposes(),
    openLoopsByMember(),
    getWeek(user.id, weekStart),
    admin ? getTeamWeek(weekStart) : Promise.resolve(null),
  ]);

  const entries = plan.ok ? plan.entries : [];
  const held = entries.filter((entry) => entry.meetings_actual !== null).length;

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        description={
          admin
            ? "Your day, and how the team is tracking against this week."
            : "Plan today's visits here, then log them as they happen."
        }
      />

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
        />
      ) : (
        <ErrorState message="We could not load today's plan. Please try again in a moment." />
      )}

      {admin ? (
        <>
          <SectionTitle className="mt-8">
            The team this week
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatWeekRange(weekStart)}
            </span>
          </SectionTitle>
          {team?.ok ? (
            <TeamSnapshot
              members={team.members}
              weekStart={weekStart}
              openLoops={openLoops}
            />
          ) : (
            <ErrorState message="We could not load the team's week. Please try again in a moment." />
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
          {week.ok ? (
            <>
              <MetricList
                title="Target vs achieved"
                targets={week.view.record.targets}
                achieved={week.view.achieved}
                committed={week.view.record.id !== null}
                emptyAction={
                  <Button asChild className="h-11">
                    <Link href="/weekly">Set this week&rsquo;s targets</Link>
                  </Button>
                }
              />
              {week.view.record.id !== null && (
                <Button asChild variant="outline" className="mt-3 h-11 w-full">
                  <Link href="/weekly">Open the Weekly tab</Link>
                </Button>
              )}
            </>
          ) : (
            <ErrorState message="We could not load this week's targets. Please try again in a moment." />
          )}
        </>
      )}
    </>
  );
}
