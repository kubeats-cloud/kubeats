import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { HierarchyChart } from "@/components/admin/hierarchy-chart";
import { listTeamMembers, requireAdmin } from "@/lib/admin";

export const metadata = { title: "Hierarchy" };

/**
 * Which admin created which member.
 *
 * OFF THE BAR ON PURPOSE. The admin workspace is six tabs and this is not a
 * seventh: it is read a few times a year — when somebody joins, or when the
 * roster is being audited — which is the same distance `/team/report`, `/data`
 * and `/pending` are kept at, and for the same reason. It is reached from Team
 * and from the Settings team panel.
 *
 * Admin-only three times over, which is the pattern every admin screen follows:
 * `proxy.ts` turns a rep away with a 307 before this runs (`/team` is in
 * ADMIN_ONLY_PATHS and the match is prefix-based, so this subtree is covered),
 * `requireAdmin()` is the second layer, and RLS is the third — `profiles_select`
 * is `id = auth.uid() or is_admin()`, so the query underneath returns the whole
 * team only because the caller is an admin.
 *
 * THERE IS NOTHING HERE FOR A REP EVEN IF THEY GOT IN. `created_by` is readable
 * on a rep's own row, but the creating admin's profile is not theirs to read,
 * so the name would not resolve and the chart would have one node in it.
 */
export default async function HierarchyPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Hierarchy" description="Who created which account." />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const members = await listTeamMembers();

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Hierarchy"
        description="Which admin created which account. A record of how the team was set up — it does not decide what anyone can see."
      />

      <div className="mb-5">
        <Button asChild variant="outline" className="h-11">
          <Link href="/team">
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to Team
          </Link>
        </Button>
      </div>

      <HierarchyChart members={members} />
    </>
  );
}
