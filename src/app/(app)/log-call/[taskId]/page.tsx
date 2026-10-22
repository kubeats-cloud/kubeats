import Link from "next/link";
import { redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { LogCallForm } from "@/components/visits/log-call-form";
import { getCurrentUser } from "@/lib/auth";
import { listStatusCatalogue } from "@/lib/statuses";
import { listStatusFields } from "@/lib/status-fields";
import { getFollowUpCallById } from "@/lib/visits";

export const metadata = { title: "Log call" };

/**
 * The single way a follow-up call is closed (Phase A rebuild, decision §4i).
 *
 * NO CHECK-IN, NO PHOTO, NO `daily_plans` ROW — unlike `/log`, which exists
 * for a visit and refuses to render without an arrival in progress. A call
 * never has one: it is a `follow_up_tasks` row, raised automatically from a
 * visit's Next Action or from the morning tick-list's Call mode, and this
 * page is purely how the rep records what happened on it. That is also why
 * this is its own route rather than a branch of `/log` — a fourth branch with
 * no check-in requirement is a different shape of page, not a variant of
 * that one.
 */
export default async function LogCallPage(props: PageProps<"/log-call/[taskId]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { taskId } = await props.params;
  const [task, catalogue, fields] = await Promise.all([
    getFollowUpCallById(taskId, user.id),
    listStatusCatalogue(),
    listStatusFields(),
  ]);

  if (!task) {
    return (
      <PageColumn>
        <PageHeader title="Log call" />
        <EmptyState
          title="This call could not be found"
          description="It may already be logged, or it belongs to someone else."
          action={
            <Button asChild className="h-11">
              <Link href="/">Go to the Dashboard</Link>
            </Button>
          }
        />
      </PageColumn>
    );
  }

  return (
    <PageColumn>
      <PageHeader title="Log call" description={task.instituteName} />
      <LogCallForm taskId={task.id} note={task.note} catalogue={catalogue} statusFields={fields} />
    </PageColumn>
  );
}
