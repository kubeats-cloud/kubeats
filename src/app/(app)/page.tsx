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
import {
  getTodayPlan,
  listInstitutesForPicker,
  listPurposes,
  openLoopsByMember,
} from "@/lib/visits";
import { getTargets } from "@/lib/targets";
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
  const [plan, institutes, purposes, openLoops, week, overview] = await Promise.all([
    admin ? Promise.resolve({ ok: true as const, entries: [] }) : getTodayPlan(user.id),
    admin ? Promise.resolve([]) : listInstitutesForPicker(),
    admin ? Promise.resolve([]) : listPurposes(),
    admin ? Promise.resolve(new Map<string, number>()) : openLoopsByMember(),
    admin ? Promise.resolve(null) : getTargets(user.id, "weekly", weekStart),
    admin ? getOverview() : Promise.resolve(null),
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
                targets={week.view.record.targets}
                achieved={week.view.achieved}
                committed={week.view.record.id !== null}
                emptyAction={
                  <Button asChild className="h-11">
                    <Link href="/targets">Set this week&rsquo;s targets</Link>
                  </Button>
                }
              />
              {week.view.record.id !== null && (
                <Button asChild variant="outline" className="mt-3 h-11 w-full">
                  <Link href="/targets">Open Targets</Link>
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
