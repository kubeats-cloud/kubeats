import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { ErrorState } from "@/components/states";
import { TeamSnapshot } from "@/components/dashboard/team-snapshot";
import { WeekNavigator } from "@/components/weekly/week-navigator";
import { requireAdmin } from "@/lib/admin";
import { getTeamWeek } from "@/lib/week-summary";
import { openLoopsByMember } from "@/lib/visits";
import { formatWeekRange, normaliseWeekParam } from "@/lib/weeks";

export const metadata = { title: "Team" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * What each rep recorded this week.
 *
 * The week is navigable because "how did the team do" is a question about a
 * particular week far more often than about this one. Opening a member goes to
 * their own week, which shows all eight metrics rather than the three that fit
 * across a table.
 *
 * It used to ask who was on track against their commitment. Stage 2 of the
 * redesign ended commitments (docs/flow-redesign-plan.md, changes 3 and 4), so
 * there is no longer a target to be on track against — and no locked week to
 * reopen from here either.
 */
export default async function TeamPage(props: PageProps<"/team">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Team" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;
  const weekStart = normaliseWeekParam(first(searchParams.week));

  const [team, openLoops] = await Promise.all([
    getTeamWeek(weekStart),
    openLoopsByMember(),
  ]);

  return (
    <>
      <PageHeader
        title="Team"
        description="What each rep recorded this week."
      />

      <WeekNavigator weekStart={weekStart} basePath="/team" />

      <SectionTitle className="mt-6">
        The week
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {formatWeekRange(weekStart)}
        </span>
      </SectionTitle>

      {team.ok ? (
        <TeamSnapshot
          members={team.members}
          weekStart={weekStart}
          openLoops={openLoops}
        />
      ) : (
        <ErrorState message="We could not load the team's week. Please try again in a moment." />
      )}
    </>
  );
}
