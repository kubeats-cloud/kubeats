import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, ChartColumnIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MetricList } from "@/components/weekly/metric-list";
import { WeekNavigator } from "@/components/weekly/week-navigator";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWeekSummary, memberName } from "@/lib/week-summary";
import { formatWeekRange, normaliseWeekParam } from "@/lib/weeks";

export const metadata = { title: "This week" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The week, read only.
 *
 * This screen used to be Targets: a rep committed to eight numbers for a day,
 * a week or a month, submitted them, and an admin could reopen a locked week.
 * Stage 2 of the redesign removed all of it (docs/flow-redesign-plan.md,
 * changes 3 and 4) — the daily target turned out to be the daily plan and was
 * merged into it, and the weekly commitment became this: what you actually did.
 *
 * The route is still /targets. Renaming it would break the bookmarks and the
 * /weekly redirect that proxy.ts already serves, for no gain a rep would ever
 * see — the tab is labelled from lib/nav.ts, and that is what they read.
 *
 * ?period= and ?start= are gone with the period switcher; ?week= is the
 * parameter this screen has always shared with /team and the one the admin
 * drill-in passes. An old ?start= link simply lands on the current week, which
 * is the same graceful fallback the period switcher used to give.
 */
export default async function WeekPage(props: PageProps<"/targets">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const weekStart = normaliseWeekParam(first(searchParams.week));

  // An admin may look at one rep's week; everyone else only ever sees their
  // own. Checked here as well as by RLS, so a rep hand-editing the URL simply
  // lands back on their own figures rather than on an error.
  const requested = first(searchParams.member);
  const viewingOther = isAdmin(user) && !!requested && requested !== user.id;
  const memberId = viewingOther ? requested! : user.id;

  const [result, name] = await Promise.all([
    getWeekSummary(memberId, weekStart),
    viewingOther ? memberName(memberId) : Promise.resolve(user.name),
  ]);

  const displayName = name ?? "this member";

  if (!result.ok) {
    return (
      <PageColumn>
        <PageHeader title="This week" description="What was recorded this week." />
        <ErrorState message="We could not load this week. Please try again in a moment." />
      </PageColumn>
    );
  }

  return (
    <PageColumn>
      <PageHeader
        eyebrow={viewingOther ? "Team member" : undefined}
        title={viewingOther ? displayName : "This week"}
        description={
          viewingOther
            ? "What they recorded this week."
            : "What you have recorded this week. It fills in as you log visits."
        }
      />

      {/* The screen about this week is the natural place to ask about the rest
          of the history. /report is out of the nav bar on purpose — see
          lib/nav.ts — so this is how a rep reaches their own. */}
      <Button asChild variant="outline" className="mb-4 h-11">
        <Link
          href={
            viewingOther
              ? `/report?period=monthly&member=${memberId}`
              : "/report?period=monthly"
          }
        >
          <ChartColumnIcon className="size-4" aria-hidden />
          {viewingOther ? "Their activity report" : "My activity report"}
        </Link>
      </Button>

      {viewingOther && (
        <Button asChild variant="outline" className="mb-4 h-11">
          <Link href="/team">
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to the team
          </Link>
        </Button>
      )}

      <WeekNavigator
        weekStart={weekStart}
        basePath="/targets"
        member={viewingOther ? memberId : undefined}
      />

      <MetricList
        title="Recorded this week"
        description={formatWeekRange(weekStart)}
        achieved={result.summary.achieved}
      />
    </PageColumn>
  );
}
