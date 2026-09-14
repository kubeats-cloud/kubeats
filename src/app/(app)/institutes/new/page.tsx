import Link from "next/link";
import { PageColumn } from "@/components/layout/page-column";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { InstituteForm } from "@/components/institutes/institute-form";
import { getLocationTree } from "@/lib/locations";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listCampuses } from "@/lib/campuses";

export const metadata = { title: "Register institute" };

export default async function NewInstitutePage() {
  const user = await getCurrentUser();

  /**
   * Only an admin is asked which campus. A rep has exactly one and the trigger
   * fills it in, so a picker would offer them a choice with no alternatives —
   * the same reasoning that hides the campus field from an ADMIN on the
   * add-a-team-member form, pointing the other way.
   */
  const [tree, campuses] = await Promise.all([
    getLocationTree(),
    isAdmin(user) ? listCampuses() : Promise.resolve([]),
  ]);

  return (
    <PageColumn>
      <PageHeader
        title="Register institute"
        description="An institute has to be registered here before anything can be logged against it."
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href="/institutes">Cancel</Link>
          </Button>
        }
      />
      <InstituteForm tree={tree} campuses={campuses} />
    </PageColumn>
  );
}
