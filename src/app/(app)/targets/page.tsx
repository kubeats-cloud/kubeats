import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { redirect } from "next/navigation";
import { ArrowLeftIcon, ChartColumnIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MetricList } from "@/components/weekly/metric-list";
import { PeriodControls } from "@/components/weekly/period-controls";
import { ReopenButton } from "@/components/weekly/reopen-button";
import { TargetsForm } from "@/components/weekly/targets-form";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getTargets, memberName } from "@/lib/targets";
import { completionPercent } from "@/lib/validation/weekly";
import {
  PERIOD_NOUN,
  TARGET_PERIODS,
  isTargetPeriod,
  normalisePeriodStart,
  type TargetPeriod,
} from "@/lib/periods";

export const metadata = { title: "Targets" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function TargetsPage(props: PageProps<"/targets">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;

  // Period and start both come from the URL. An unknown period falls back to
  // weekly rather than erroring — that is the one this screen has always been,
  // and a hand-edited URL should land somewhere sensible.
  const periodParam = first(searchParams.period);
  const period: TargetPeriod = isTargetPeriod(periodParam) ? periodParam : "weekly";
  const periodStart = normalisePeriodStart(period, first(searchParams.start));

  // An admin may look at one rep's targets; everyone else only ever sees their
  // own. Checked here as well as by RLS, so a rep hand-editing the URL simply
  // lands back on their own numbers rather than on an error.
  const requested = first(searchParams.member);
  const viewingOther = isAdmin(user) && !!requested && requested !== user.id;
  const memberId = viewingOther ? requested! : user.id;

  const [result, name] = await Promise.all([
    getTargets(memberId, period, periodStart),
    viewingOther ? memberName(memberId) : Promise.resolve(user.name),
  ]);

  if (!result.ok) {
    return (
      <PageColumn>
        <PageHeader title="Targets" description="Your commitment for the period." />
        <ErrorState message="We could not load these targets. Please try again in a moment." />
      </PageColumn>
    );
  }

  const { record, achieved } = result.view;
  const displayName = name ?? "this member";
  const percent = completionPercent(achieved, record.targets);
  const noun = PERIOD_NOUN[period];

  return (
    <PageColumn>
      <PageHeader
        eyebrow={viewingOther ? "Team member" : undefined}
        title={viewingOther ? displayName : "Targets"}
        description={
          viewingOther
            ? `Their commitment for this ${noun}, and what they have achieved.`
            : `Set what you are aiming for by day or week, and watch it fill in as you work.`
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
          <Link href="/">
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to the team
          </Link>
        </Button>
      )}

      <PeriodControls
        period={period}
        periodStart={periodStart}
        options={TARGET_PERIODS}
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
              period={period}
              periodStart={periodStart}
              memberName={displayName}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {record.id === null
                ? `${displayName} has not committed to this ${noun} yet.`
                : `${displayName} has not submitted this ${noun} yet, so there is nothing to reopen.`}
            </p>
          )}
        </div>
      ) : (
        <TargetsForm
          period={period}
          periodStart={periodStart}
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
