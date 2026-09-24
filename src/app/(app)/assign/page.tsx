import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { EmptyState, ErrorState } from "@/components/states";
import { AssignVisit } from "@/components/dashboard/assign-visit";
import { requireAdmin } from "@/lib/admin";
import { listAssignments } from "@/lib/admin-workspace";
import { listReps } from "@/lib/closing-report";
import { listInstitutesForPicker, listPurposes, todayISO } from "@/lib/visits";

export const metadata = { title: "Assign" };

/**
 * Handing work out, and seeing what has already been handed out.
 *
 * An assignment is not a separate concept from a rep planning their own day —
 * it is the same daily_plans row with assigned_by set, which is why the rule
 * that a meeting must be on the plan keeps working either way. This screen is
 * the admin's half of that: the form, and the list of what is outstanding.
 */
export default async function AssignPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Assign" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const [reps, institutes, purposes, assignments] = await Promise.all([
    listReps(),
    listInstitutesForPicker(),
    listPurposes(),
    listAssignments(),
  ]);

  return (
    <>
      <PageHeader
        title="Assign"
        description="Put a visit on a rep's plan. They will see it on their dashboard, badged as assigned."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
        <div>
          <SectionTitle>New assignment</SectionTitle>
          <AssignVisit
            reps={reps.filter((rep) => rep.id !== gate.user.id)}
            institutes={institutes}
            purposes={purposes}
            today={todayISO()}
            alwaysOpen
          />
        </div>

        <div>
          <SectionTitle>
            Outstanding
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              today onwards
            </span>
          </SectionTitle>

          {assignments.length === 0 ? (
            <EmptyState
              icon={CalendarClockIcon}
              title="Nothing assigned yet"
              description="Visits you assign from here appear in this list until the rep logs them."
            />
          ) : (
            <Card className="gap-0 overflow-hidden p-0 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">
                    Visits assigned to reps, from today onwards
                  </caption>
                  <thead>
                    <tr className="border-border bg-secondary/40 text-muted-foreground border-b text-left">
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                        Date
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                        Rep
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                        Institute
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                        Purpose
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((row) => (
                      <tr
                        key={row.id}
                        className="border-border hover:bg-accent/50 border-b transition-colors last:border-0"
                      >
                        <td className="px-5 py-3 whitespace-nowrap tabular-nums">
                          {row.date}
                        </td>
                        <td className="px-5 py-3">
                          <Link
                            href={`/team/${row.memberId}`}
                            className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {row.memberName}
                          </Link>
                        </td>
                        <td className="px-5 py-3 font-medium">
                          <Link
                            href={`/institutes/${row.instituteId}`}
                            className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                          >
                            {row.instituteName}
                          </Link>
                        </td>
                        <td className="text-muted-foreground px-5 py-3">
                          {row.purpose}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Badge variant={row.held ? "success" : "warning"}>
                            {row.held ? "Done" : "Waiting"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
