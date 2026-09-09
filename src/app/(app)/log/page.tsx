import Link from "next/link";
import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { LogVisitForm } from "@/components/visits/log-visit-form";
import { FeedbackOnlyForm } from "@/components/visits/feedback-only-form";
import { getCurrentUser } from "@/lib/auth";
import { getTodayPlan, getUnreportedVisitFor, openLoopsAt } from "@/lib/visits";
import { visitStatusOf } from "@/lib/validation/checkin";
import { formatTime, todayISO } from "@/lib/dates";

export const metadata = { title: "Log Visit" };

/**
 * The second step of the chain, and never a screen a rep browses to.
 *
 * A visit can only be logged against a check-in now — 0018 widens the presence
 * guarantee from meetings to every activity — so this page's first job is to
 * find the arrival it belongs to. Without one there is nothing to log and the
 * rep is sent back to the Dashboard to start properly.
 *
 * Three states:
 *
 *   no plan / not checked in   go and check in first
 *   checked in, no visit yet   the full form: what happened, photo, feedback
 *   checked in, visit exists   the feedback alone
 *
 * The third is the recovery path. Logging and filing are one submit but two
 * RPCs, and if the second fails the visit exists unreported while the rep is
 * still checked in. Finding it here means they finish the report rather than
 * logging a second visit for the same arrival.
 */
export default async function LogVisitPage(props: PageProps<"/log">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const planParam = searchParams.plan;
  const planId = typeof planParam === "string" ? planParam : undefined;

  const today = todayISO();
  const plan = await getTodayPlan(user.id);
  const entries = plan.ok ? plan.entries : [];

  // The visit in progress: the one checked in and not yet checked out. Named
  // explicitly rather than "the one in the URL", so a stale link cannot point
  // the rep at somebody else's arrival or a finished one.
  const inProgress = entries.filter(
    (entry) =>
      visitStatusOf({
        checkinAt: entry.checkinAt,
        checkoutAt: entry.checkoutAt,
        checkoutMissing: entry.checkoutMissing,
      }) === "In Progress",
  );
  const entry = inProgress.find((e) => e.id === planId) ?? inProgress[0] ?? null;

  if (!entry) {
    return (
      <PageColumn>
        <PageHeader title="Log a visit" />
        <EmptyState
          title="Check in first"
          description="A visit is logged from the moment you arrive. Add the institute to today's plan on the Dashboard, then check in there."
          action={
            <Button asChild className="h-11">
              <Link href="/">Go to the Dashboard</Link>
            </Button>
          }
        />
      </PageColumn>
    );
  }

  const [existing, openLoops] = await Promise.all([
    // Keyed on the plan's own (member, date, institute), NOT on
    // visits.daily_plan_id — that link is written by close_visit(), which is
    // the step that fails in the case this recovers. See getUnreportedVisitFor.
    getUnreportedVisitFor({
      member: user.id,
      date: today,
      institute_id: entry.institute_id,
    }),
    openLoopsAt(user.id, entry.institute_id),
  ]);

  // "Meeting time" is the arrival, server-stamped — never a field the rep types.
  const arrived = entry.checkinAt ? formatTime(entry.checkinAt) : null;
  const description = arrived
    ? `${entry.instituteName} · arrived ${arrived}`
    : entry.instituteName;

  if (existing) {
    return (
      <PageColumn>
        <PageHeader
          eyebrow="Finish this visit"
          title="How did it go?"
          description={description}
        />
        <FeedbackOnlyForm
          visitId={existing.id}
          planId={entry.id}
          status={existing.status_set_to}
          openLoops={openLoops}
        />
      </PageColumn>
    );
  }

  return (
    <PageColumn>
      <PageHeader title="Log a visit" description={description} />
      <LogVisitForm userId={user.id} plan={entry} openLoops={openLoops} />
    </PageColumn>
  );
}
