import Link from "next/link";
import { NetworkIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { ErrorState } from "@/components/states";
import { AdminTeamWeek } from "@/components/dashboard/team-rep-search";
import { TeamSnapshot } from "@/components/dashboard/team-snapshot";
import { WeekNavigator } from "@/components/weekly/week-navigator";
import { CampusFilter } from "@/components/campus-filter";
import { ExportExcel } from "@/components/report/export-excel";
import { listTeamMembers, requireStaff, type TeamMember } from "@/lib/admin";
import { listCampuses, permittedCampuses, resolveCampusFilter } from "@/lib/campuses";
import { settled } from "@/lib/errors";
import type { Campus } from "@/lib/campus-display";
import { defaultExportRange } from "@/lib/validation/export";
import { getTeamWeek } from "@/lib/week-summary";
import { formatWeekRange, normaliseWeekParam } from "@/lib/weeks";

export const metadata = { title: "Team" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * Who is on track, and who is behind.
 *
 * The week is navigable because "how did the team do" is a question about a
 * particular week far more often than about this one. Opening a member goes to
 * their own Targets screen, which is where a locked week is reopened — one
 * place that does it, rather than a second button here that would have to stay
 * in step with it, and which shows all eight metrics rather than the handful
 * that fit across a table.
 *
 * Stage 2 of the redesign made this "what did they do", because commitments
 * had gone and a percentage would have had nothing under it. The client's spec
 * puts the weekly target back, so the question goes back to the stronger one.
 */
export default async function TeamPage(props: PageProps<"/team">) {
  const gate = await requireStaff();
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
  /*
   * The campus the table is narrowed to — resolved before the week is read, so
   * the roster and the controls agree. A team lead's list is their own campus
   * alone, which hides the control; an admin may step between sites, and the
   * week arrows carry the choice (see `extraParams` below).
   */
  const filterCampuses = await permittedCampuses(gate.user);
  const campus = resolveCampusFilter(filterCampuses, first(searchParams.campus));

  const [team, editableMembers, editableCampuses] = await Promise.all([
    getTeamWeek(weekStart, campus),
    /*
     * The row editor's data, fetched only for an admin — the role that may
     * open it. `getTeamWeek` carries the week; this carries the account facts
     * (campus to preselect, institutes a campus change would move) that its
     * reps-only rows do not.
     */
    gate.isAdmin
      ? settled<TeamMember[]>(listTeamMembers(), [], "team:members")
      : Promise.resolve<TeamMember[]>([]),
    gate.isAdmin
      ? settled<Campus[]>(listCampuses(), [], "team:campuses")
      : Promise.resolve<Campus[]>([]),
  ]);

  const controls = (
    <>
      <div className="mb-4 max-w-xs">
        <CampusFilter campuses={filterCampuses} paramName="campus" />
      </div>

      <WeekNavigator
        weekStart={weekStart}
        basePath="/team"
        extraParams={campus ? { campus } : undefined}
      />

      {/* The export is a MONTH by default, not this week. It answers a
          different question from the screen above it — "what did the team do
          over a period" rather than "who is on track this week" — so it keeps
          its own range rather than inheriting the navigator's. The full report
          is the same numbers as a table; this stays for the admin who only
          wants the file. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11">
          <Link href="/team/report">
            <TableIcon className="size-4" aria-hidden />
            Full activity report
          </Link>
        </Button>
        {/* Off the bar, like the report beside it: teams are restaffed rarely,
            not weekly. */}
        <Button asChild variant="outline" className="h-11">
          <Link href="/team/hierarchy">
            <NetworkIcon className="size-4" aria-hidden />
            Team Leads Assign
          </Link>
        </Button>
        <ExportExcel {...defaultExportRange()} label="Export to Excel" />
      </div>

      <SectionTitle className="mt-6">
        The week
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {formatWeekRange(weekStart)}
        </span>
      </SectionTitle>
    </>
  );

  return (
    <>
      <PageHeader
        title="Team"
        description="Each rep's commitment for the week and what they have achieved against it."
      />

      {/* Admin #5. The flag is the one requireStaff already returns. A team
          lead keeps the list exactly as it was, with no search bar. */}
      {gate.isAdmin && team.ok ? (
        <AdminTeamWeek
          members={team.members}
          weekStart={weekStart}
          editableMembers={editableMembers}
          campuses={editableCampuses}
        >
          {controls}
        </AdminTeamWeek>
      ) : (
        <>
          {controls}
          {team.ok ? (
            <TeamSnapshot members={team.members} weekStart={weekStart} />
          ) : (
            <ErrorState message="We could not load the team's week. Please try again in a moment." />
          )}
        </>
      )}
    </>
  );
}
