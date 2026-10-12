import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { TeamStructure } from "@/components/admin/team-structure";
import { SectionTitle } from "@/components/section-title";
import { listTeamMembers, requireStaff } from "@/lib/admin";

export const metadata = { title: "Team Leads Assign" };

/**
 * Each team lead and the reps assigned to them.
 *
 * OFF THE BAR ON PURPOSE. The admin workspace is six tabs and this is not a
 * seventh: teams are restaffed rarely, which is the same distance
 * `/team/report`, `/data` and `/pending` are kept at, and for the same reason.
 * It is reached from Team and from the Settings team panel.
 *
 * Admin-only three times over, which is the pattern every admin screen follows:
 * `proxy.ts` turns a rep away with a 307 before this runs (`/team` is in
 * ADMIN_ONLY_PATHS and the match is prefix-based, so this subtree is covered),
 * `requireStaff()` is the second layer, and RLS is the third — `profiles_select`
 * returns the whole team to an admin and only their own reps to a team lead.
 *
 * The who-created-whom chart (`profiles.created_by`) used to sit below this.
 * The client retired that view; the column and the stamping on account
 * creation are untouched, so nothing recorded is lost.
 */
export default async function HierarchyPage() {
  const gate = await requireStaff();
  if (!gate.ok) {
    return (
      <>
        <PageHeader
          title="Team Leads Assign"
          description="Each team lead and the reps assigned to them."
        />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const members = await listTeamMembers();

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Team Leads Assign"
        description="Each team lead and the reps assigned to them."
      />

      <div className="mb-5">
        <Button asChild variant="outline" className="h-11">
          <Link href="/team">
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to Team
          </Link>
        </Button>
      </div>

      <SectionTitle>Teams</SectionTitle>
      <p className="text-muted-foreground mb-3 text-xs">
        Who supervises whom. <strong>This decides what people can see</strong> —
        a team lead reads their own reps&rsquo; institutes, visits, follow-ups and
        targets, and nobody else&rsquo;s.
      </p>
      <TeamStructure members={members} canAssign={gate.isAdmin} />
    </>
  );
}
