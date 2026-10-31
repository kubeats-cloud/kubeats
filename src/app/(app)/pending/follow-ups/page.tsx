import { redirect } from "next/navigation";
import Link from 'next/link';
import { auditHref } from '@/lib/audit-pagination';
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/states";
import { AdminFollowUpCards } from "@/components/visits/follow-up-cards";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import {
  followUpCardItemsFor,
  getFollowUpCardModel,
  type FollowUpCardStatus,
} from "@/lib/follow-up-cards";

export const metadata = { title: "Follow-ups" };

const TITLES: Record<FollowUpCardStatus, string> = {
  owned: "Follow-ups Owned",
  missed: "Follow-ups Missed",
  closed: "Follow-ups Closed",
};

function isStatus(value: string | undefined): value is FollowUpCardStatus {
  return value === "owned" || value === "missed" || value === "closed";
}

/**
 * "The complete list" each Admin #4 / Rep #6 card opens.
 *
 * ONE ROUTE FOR ALL THREE/TWO CARDS, `?status=` picking which — same model
 * (`getFollowUpCardModel()`) the cards' own counts came from, so a number on
 * `/pending` and the rows behind it here cannot disagree. RLS alone decides
 * whose rows these are; nothing here re-filters by role.
 *
 * "Rep name" renders for staff (admin or team lead) only — Admin #4 names it
 * as a column, Rep #6 does not, and it would only ever read the signed-in
 * Rep's own name back to them. A team lead gets it too: `follow_up_tasks`
 * (via `getFollowUpCardModel()`) has been `supervises()`-scoped since 0042,
 * so the rows behind the column are already narrowed to their own reps —
 * the gate below only ever chose whether to SHOW whose row it is.
 */
export default async function FollowUpsPage(props: PageProps<"/pending/follow-ups">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const staff = isStaff(user);
  const searchParams = await props.searchParams;
  const statusParam = Array.isArray(searchParams.status)
    ? searchParams.status[0]
    : searchParams.status;
  const status: FollowUpCardStatus = isStatus(statusParam) ? statusParam : "owned";

  const result = await getFollowUpCardModel(status, typeof searchParams.page === 'string' ? searchParams.page : undefined);

  return (
    <>
      <PageHeader title={TITLES[status]} />

      {staff && result.ok && <AdminFollowUpCards counts={result.model.counts} />}
      <p className="text-muted-foreground mb-3 text-xs">Owned means unfinished tasks, including Missed; Missed means unfinished and overdue before today; Closed means completed. Missed history records days in the last 30 days, not currently overdue tasks.</p>
      {result.ok && <nav aria-label="Follow-up pages" className="my-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>{result.model.counts[status]} matching {result.model.counts[status] === 1 ? "task" : "tasks"} · page {result.page} of {result.pages}</p>
        {result.page > 1 && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/pending/follow-ups',{status},result.page-1)}>Previous</Link>}
        {result.page < result.pages && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/pending/follow-ups',{status},result.page+1)}>Next</Link>}
      </nav>}

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        (() => {
          const items = followUpCardItemsFor(result.model.items, status);
          return items.length === 0 ? (
            <EmptyState
              title="Nothing here"
              description="No follow-ups in this list right now."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary text-muted-foreground">
                      <tr>
                        {staff && (
                          <th scope="col" className="px-4 py-2.5 text-left font-medium">
                            Rep name
                          </th>
                        )}
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">
                          Institute name
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">
                          Follow-up date
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">
                          Follow-up status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id} className="border-border border-t">
                          {staff && <td className="px-4 py-3">{item.repName}</td>}
                          <td className="px-4 py-3">{item.instituteName}</td>
                          <td className="px-4 py-3">{formatDate(item.dueDate)}</td>
                          <td className="px-4 py-3">{item.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })()
      )}
    </>
  );
}
