import Link from "next/link";
import { redirect } from "next/navigation";
import { FileTextIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/states";
import { FollowUpList } from "@/components/visits/follow-up-list";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getOpenFollowUps, getUnreportedVisits, listPurposes } from "@/lib/visits";
import { listStatusCatalogue } from "@/lib/statuses";
import { activityLabelFor } from "@/lib/validation/visit";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Pending" };

/**
 * What is still owed.
 *
 * PENDING ASKS A DIFFERENT QUESTION NOW. It used to list visits sitting at
 * `lifecycle_status = 'Set'` — sessions and campus visits promised and not yet
 * held. That was one kind of owing and it missed every other: a first meeting
 * nobody chased, an approval nobody came back on, an invitation with no answer.
 * All of those are what the vocabulary calls OPEN, so the screen asks for those
 * instead — and because the category is managed data since stage 4a, a status an
 * admin adds and marks open appears here with no code change.
 *
 * TWO BLOCKS, AND THE SMALL ONE IS NOT A TO-DO LIST.
 *
 *   Finish these first   a visit that was saved but whose report did not go
 *                        through. A recovery notice, shown only when there IS
 *                        one, and almost always empty.
 *   Follow-ups owed      the actual subject of this screen.
 *
 * THE FIRST BLOCK LOOKS REDUNDANT AND IS NOT — this was checked rather than
 * assumed. Logging and filing are one submit but TWO RPCs (`log_visit()` then
 * `close_visit()`), and if the second fails the visit exists unreported while
 * the rep is still checked in. Overnight, `sweep_open_checkins()` closes the
 * check-in with `checkout_missing = true` — at which point `visitStatusOf()`
 * calls the plan entry "Completed", the Dashboard stops offering "Continue",
 * and the Dashboard only ever shows TODAY in any case.
 *
 * `getUnreportedVisits()` is then the ONLY thing in the app that produces a
 * `/log?plan=` link for that visit. Remove it and the report is owed for ever
 * with no route to it, and the rep is told nothing. So it stays.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  const catalogue = await listStatusCatalogue();

  // The category is the managed vocabulary's to decide, never a list in here.
  const openStatuses = catalogue
    .filter((row) => row.category === "open")
    .map((row) => row.status);

  const [result, unreported, purposes] = await Promise.all([
    getOpenFollowUps(openStatuses, user.id),
    // An admin has no half-finished visits of their own: they do not log any.
    admin ? Promise.resolve([]) : getUnreportedVisits(user.id),
    // Only a rep can start a follow-up, so only a rep needs the purposes.
    admin ? Promise.resolve([]) : listPurposes(),
  ]);

  return (
    <>
      <PageHeader
        title="Pending"
        description={
          admin
            ? "Every institute across the team still waiting on a follow-up."
            : "Institutes you have left open. Tap one to go back."
        }
      />

      {unreported.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Finish these first</SectionTitle>
          <ul className="space-y-3">
            {unreported.map((visit) => (
              <li key={visit.id}>
                <Card className="border-l-warning gap-0 rounded-l-sm border-l-2 p-5">
                  <p className="truncate text-[15px] leading-tight font-semibold tracking-tight">
                    {visit.instituteName}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {activityLabelFor(visit.activity)} · {formatDate(visit.date)}
                  </p>
                  <p className="text-muted-foreground mt-3 text-sm">
                    The visit is saved. Only the report is missing, and finishing
                    it checks you out.
                  </p>

                  {/*
                    The forced chain resuming at the step it stopped at — not an
                    escape from it. /log?plan= finds the unreported visit and
                    renders the report ALONE; it never restarts the log, and it
                    works whatever day the visit belongs to, which is the whole
                    reason this block cannot be deleted.
                  */}
                  <div className="mt-4">
                    <Button asChild className="h-11 w-full">
                      <Link href={visit.planId ? `/log?plan=${visit.planId}` : "/log"}>
                        <FileTextIcon className="size-4" aria-hidden />
                        Finish the report
                      </Link>
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unreported.length > 0 && <SectionTitle>Follow-ups owed</SectionTitle>}

      {result.ok ? (
        <FollowUpList
          items={result.items}
          purposes={purposes}
          catalogue={catalogue}
          // D10 — an admin has no campus and does not do field visits, so a
          // launch would put the visit on their own day. Read-only, and the
          // action refuses them too rather than trusting this prop.
          readOnly={admin}
        />
      ) : (
        <ErrorState message="We could not load what is still open. Please try again in a moment." />
      )}
    </>
  );
}
