import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, ChartColumnIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MetricList } from "@/components/weekly/metric-list";
import { ReopenButton } from "@/components/weekly/reopen-button";
import { TargetsForm } from "@/components/weekly/targets-form";
import { WeekNavigator } from "@/components/weekly/week-navigator";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWeekSummary, memberName } from "@/lib/week-summary";
import { completionPercent } from "@/lib/validation/weekly";
import { formatWeekRange, normaliseWeekParam } from "@/lib/weeks";

export const metadata = { title: "Targets" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * The weekly target: the eight numbers a rep commits to, and what they have
 * done against them.
 *
 * Stage 2 of the redesign made this screen read-only — no numbers to set, no
 * submit, no lock. The client's spec puts the commitment back, so the form is
 * back and public.targets is written again. What did NOT come back is the
 * daily target: that one was the daily plan wearing a second name, and it
 * stays merged into the Dashboard where the meeting gate can see it.
 *
 * ONE PARAMETER, ?week=. The screen briefly took ?period= and ?start= while it
 * offered a daily/weekly/monthly switcher; with only the week left, a switcher
 * with one option is not a switcher. ?week= is the parameter this screen has
 * shared with /team all along, and the one proxy.ts translates /weekly links
 * into — so bookmarks from every era of this screen still land on the right
 * week.
 */
export default async function TargetsPage(props: PageProps<"/targets">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const weekStart = normaliseWeekParam(first(searchParams.week));

  // An admin may look at one rep's targets; everyone else only ever sees their
  // own. Checked here as well as by RLS, so a rep hand-editing the URL simply
  // lands back on their own numbers rather than on an error.
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
        <PageHeader title="Targets" description="Your commitment for the week." />
        <ErrorState message="We could not load this week. Please try again in a moment." />
      </PageColumn>
    );
  }

  const { record, achieved } = result.summary;
  const percent = completionPercent(achieved, record.targets);

  return (
    <PageColumn>
      <PageHeader
        eyebrow={viewingOther ? "Team member" : undefined}
        title={viewingOther ? displayName : "Targets"}
        description={
          viewingOther
            ? "Their commitment for this week, and what they have achieved against it."
            : "Set what you are aiming for this week, and watch it fill in as you work."
        }
        action={
          percent !== null ? (
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums">{percent}%</p>
              <p className="text-muted-foreground text-xs">of commitment</p>
            </div>
          ) : undefined
        }
      />

      {/* The screen about what you are aiming for is the natural place to ask
          what you actually did. /report is out of the nav bar on purpose — see
          lib/nav.ts — so this is how a rep reaches their own history. */}
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

      {viewingOther ? (
        <div className="space-y-4">
          <MetricList
            title={record.locked ? "Submitted commitment" : "Commitment in progress"}
            description={formatWeekRange(weekStart)}
            targets={record.targets}
            achieved={achieved}
          />

          {record.locked ? (
            <ReopenButton
              member={memberId}
              weekStart={weekStart}
              memberName={displayName}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {record.id === null
                ? `${displayName} has not committed to this week yet.`
                : `${displayName} has not submitted this week yet, so there is nothing to reopen.`}
            </p>
          )}
        </div>
      ) : (
        <TargetsForm
          weekStart={weekStart}
          targets={record.targets}
          achieved={achieved}
          locked={record.locked}
          submittedAt={record.submitted_at}
          reopenedAt={record.reopened_at}
        />
      )}
    </PageColumn>
  );
}
