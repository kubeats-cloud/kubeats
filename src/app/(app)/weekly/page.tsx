import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MetricList } from "@/components/weekly/metric-list";
import { ReopenButton } from "@/components/weekly/reopen-button";
import { TargetsForm } from "@/components/weekly/targets-form";
import { WeekNavigator } from "@/components/weekly/week-navigator";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWeek, memberName } from "@/lib/weekly";
import { completionPercent } from "@/lib/validation/weekly";
import { normaliseWeekParam } from "@/lib/weeks";

export const metadata = { title: "Weekly" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function WeeklyPage(props: PageProps<"/weekly">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const weekStart = normaliseWeekParam(first(searchParams.week));

  // An admin may look at one rep's week; everyone else only ever sees their own.
  // Checked here as well as by RLS, so a rep hand-editing the URL simply lands
  // back on their own numbers rather than on an error.
  const requested = first(searchParams.member);
  const viewingOther = isAdmin(user) && !!requested && requested !== user.id;
  const memberId = viewingOther ? requested! : user.id;

  const [result, name] = await Promise.all([
    getWeek(memberId, weekStart),
    viewingOther ? memberName(memberId) : Promise.resolve(user.name),
  ]);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Weekly" description="Your commitment for the week." />
        <ErrorState message="We could not load this week. Please try again in a moment." />
      </>
    );
  }

  const { record, achieved } = result.view;
  const displayName = name ?? "this member";
  const percent = completionPercent(achieved, record.targets);

  return (
    <PageColumn>
      <PageHeader
        eyebrow={viewingOther ? "Team member" : undefined}
        title={viewingOther ? displayName : "Weekly"}
        description={
          viewingOther
            ? "Their commitment for this week, and what they have achieved."
            : "Your commitment for the week, and what you have achieved against it."
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

      {viewingOther && (
        <Button asChild variant="outline" className="mb-4 h-11">
          <Link href="/">
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to the team
          </Link>
        </Button>
      )}

      <WeekNavigator
        weekStart={weekStart}
        member={viewingOther ? memberId : undefined}
      />

      {viewingOther ? (
        <div className="space-y-4">
          <MetricList
            title={record.locked ? "Submitted commitment" : "Commitment in progress"}
            targets={record.targets}
            achieved={achieved}
            committed={record.id !== null}
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
