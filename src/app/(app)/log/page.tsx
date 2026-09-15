import Link from "next/link";
import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { LogVisitForm } from "@/components/visits/log-visit-form";
import { FeedbackOnlyForm } from "@/components/visits/feedback-only-form";
import { getCurrentUser } from "@/lib/auth";
import {
  getPlanById,
  getTodayPlan,
  getUnreportedVisitFor,
  openLoopsAt,
} from "@/lib/visits";
import { visitStatusOf } from "@/lib/validation/checkin";
import { plannedActivityIsValid } from "@/lib/validation/visit";
import { listStatusCatalogue } from "@/lib/statuses";
import { statusRow } from "@/lib/validation/institute";
import { todayISO } from "@/lib/dates";

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
  // The status vocabulary. Needed by BOTH branches below: the full form offers
  // it, and the recovery form reads the already-recorded status off it to know
  // which extra questions that status turns on.
  const [plan, catalogue] = await Promise.all([
    getTodayPlan(user.id),
    listStatusCatalogue(),
  ]);
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

  // A named plan is honoured whatever day it belongs to and whatever state it
  // is in. That is what makes "Finish the report" work for a visit whose
  // check-in was swept closed overnight: the report is still owed, and the plan
  // row it came from is no longer in today's list at all.
  const named = planId ? await getPlanById(user.id, planId) : null;
  const entry = inProgress.find((e) => e.id === planId) ?? inProgress[0] ?? null;

  // Finishing a report needs a visit, not an arrival — so this is asked of the
  // named plan first and only then of the one in progress.
  const target = named ?? entry;
  const existing = target
    ? await getUnreportedVisitFor({
        member: user.id,
        date: named ? named.date : today,
        institute_id: target.institute_id,
      })
    : null;

  if (target && existing) {
    const stillOpen =
      target.checkinAt !== null &&
      target.checkoutAt === null &&
      target.checkoutMissing === false;

    const openLoops = await openLoopsAt(user.id, target.institute_id);

    return (
      <PageColumn>
        {/* "Finish this visit", not "How did it go?" — the box below is
            labelled Notes now, and a screen titled with a question the form no
            longer asks reads like a leftover. Imperative and institute name is
            also what the other three branches of this page already do, so the
            recovery path stops being the odd one out. */}
        <PageHeader
          title="Finish this visit"
          description={target.instituteName}
        />
        <FeedbackOnlyForm
          visitId={existing.id}
          // Null once the check-in is closed: the report is still filed, but
          // there is no check-out left to stamp and the database would refuse
          // one (daily_plans_checkout_missing_valid).
          planId={stillOpen ? target.id : null}
          asks={{
            sessionDetail:
              statusRow(catalogue, existing.status_set_to)?.asksSessionDetail ?? false,
            headCount:
              statusRow(catalogue, existing.status_set_to)?.asksHeadCount ?? false,
          }}
          openLoops={openLoops}
          alreadyClosed={!stillOpen}
        />
      </PageColumn>
    );
  }

  // Past the report branch, this is the full log form — and that genuinely does
  // need an arrival in progress. Nothing to log without one.
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

  /*
   * A plan whose purpose no longer maps to an activity cannot be logged, and
   * the rep has to be TOLD rather than shown a form that will be refused.
   *
   * Reachable in exactly two ways, both rare and both recoverable: a plan made
   * before migration 0025 linked plans to purposes, or one whose purpose was
   * DELETED rather than retired. `is_active` exists to make the second
   * essentially impossible, which is why this is a guard and not a flow.
   *
   * The way out is to re-plan the institute under a live purpose. The check-in
   * already happened and is untouched — FO011 makes it write-once — so this
   * does not cost the rep their arrival.
   */
  if (!plannedActivityIsValid(entry)) {
    return (
      <PageColumn>
        <PageHeader title="Log a visit" description={entry.instituteName} />
        <EmptyState
          title="This visit needs its purpose set again"
          description={`"${entry.purpose}" no longer says what kind of visit it is, so this cannot be logged yet. Add the institute to today's plan again with a current purpose — your check-in is safe.`}
          action={
            <Button asChild className="h-11">
              <Link href="/">Go to the Dashboard</Link>
            </Button>
          }
        />
      </PageColumn>
    );
  }

  const openLoops = await openLoopsAt(user.id, entry.institute_id);

  /*
    NO ARRIVAL TIME IN THE HEADER. Both of these headers used to read
    "St Xavier's · arrived 10:42". The time is still stamped, server-side, at
    the moment of check-in and it still appears on the finished report and in
    the admin's activity report. It is simply not read back to the rep while
    they are standing in the building: a clock against your name mid-task is
    the sort of thing that makes a tool feel like it is timing you.
  */
  return (
    <PageColumn>
      <PageHeader title="Log a visit" description={entry.instituteName} />
      <LogVisitForm
        userId={user.id}
        plan={entry}
        openLoops={openLoops}
        catalogue={catalogue}
      />
    </PageColumn>
  );
}
