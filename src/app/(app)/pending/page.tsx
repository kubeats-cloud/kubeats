import Link from "next/link";
import { redirect } from "next/navigation";
import { FileTextIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/states";
import { PendingList } from "@/components/visits/pending-list";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPendingVisits, getUnreportedVisits } from "@/lib/visits";
import { activityLabelFor } from "@/lib/validation/visit";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Pending" };

/**
 * Two different kinds of owing, kept apart because they are resolved in
 * completely different ways.
 *
 *   A report not finished   the visit HAPPENED and is waiting to be DESCRIBED.
 *                           Resolved today, by the rep, in one step.
 *   An open loop            a session or campus visit SET for a future date,
 *                           waiting to be COMPLETED. Resolved by going back to
 *                           the institute and visiting again.
 *
 * The first is listed above the second because it is both more urgent and
 * quicker: an unreported visit also means the rep is still checked in, and with
 * one-open-visit-at-a-time that stops them starting anywhere else.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);

  // Scope comes from RLS, not from here: a rep's query returns their own rows,
  // an admin's returns the team's.
  const [result, unreported] = await Promise.all([
    getPendingVisits(),
    admin ? Promise.resolve([]) : getUnreportedVisits(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="Pending"
        description={
          admin
            ? "Sessions and campus visits the team has set but not yet completed."
            : "What you still owe. Reports first, then the visits you have set."
        }
      />

      {unreported.length > 0 && (
        <div className="mb-6">
          <SectionTitle>Reports not finished</SectionTitle>
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
                    The visit is saved. Only the report is missing — you will be
                    checked out when you finish it.
                  </p>

                  {/*
                    The ONE action Pending keeps, and it is not the one #15
                    removed. That was "close a loop from a list", which is now
                    done by visiting the institute again. This is "finish the
                    visit you are still inside" — the forced chain resuming at
                    the step it stopped at, not an escape from it.

                    It goes to /log?plan=, which finds the unreported visit and
                    renders the report ALONE. It never restarts the log.
                  */}
                  <div className="mt-4">
                    <Button asChild className="h-11 w-full">
                      <Link
                        href={visit.planId ? `/log?plan=${visit.planId}` : "/log"}
                      >
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

      {unreported.length > 0 && <SectionTitle>Open loops</SectionTitle>}

      {result.ok ? (
        <PendingList visits={result.visits} currentUserId={user.id} />
      ) : (
        <ErrorState message="We could not load your open loops. Please try again in a moment." />
      )}
    </>
  );
}
