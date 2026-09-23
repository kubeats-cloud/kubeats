import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { InstituteForm } from "@/components/institutes/institute-form";
import { getInstitute } from "@/lib/institutes";
import { getLocationTree } from "@/lib/locations";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const metadata = { title: "Edit institute" };

/**
 * Correcting an institute's details.
 *
 * ADMIN-ONLY, THREE TIMES OVER, which is the pattern every admin screen here
 * follows: `proxy.ts` turns a rep away with a real 307 before this runs,
 * `isAdmin()` below is the second layer, and `updateInstitute()` starts with
 * `requireAdmin()` — the one that actually holds, since deleting a button never
 * closes the path behind it (the lesson FO020 records).
 *
 * THE FIRST LAYER NEEDED NEW MACHINERY. `ADMIN_ONLY_PATHS` is matched by
 * prefix, and this route's admin-ness sits AFTER a dynamic segment, so no
 * prefix can express it. `nav.ts` gained a small pattern list for exactly this
 * shape rather than this page quietly making do with two layers instead of
 * three.
 *
 * A REDIRECT RATHER THAN notFound() for the role check, matching /settings and
 * for its reason: this page renders dynamically, so by the time notFound() is
 * reached the response has begun streaming and Next answers 200 with a
 * not-found body. The content is protected either way, but a 200 on a refusal
 * reads like a page that loaded.
 *
 * notFound() IS still right for a missing institute — that is a genuine 404 and
 * carries no information about anyone's role.
 */
export default async function EditInstitutePage(
  props: PageProps<"/institutes/[id]/edit">,
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdmin(user)) redirect("/");

  const { id } = await props.params;

  const [institute, tree] = await Promise.all([getInstitute(id), getLocationTree()]);
  if (!institute) notFound();

  return (
    <PageColumn>
      <PageHeader
        eyebrow="Admin"
        title="Edit institute"
        description="Correct the details. The status, the campus and who it belongs to are changed elsewhere."
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href={`/institutes/${institute.id}`}>Cancel</Link>
          </Button>
        }
      />
      {/*
        `campuses` is deliberately NOT passed, and its absence is what takes the
        campus field off the form. An institute's campus moves with the rep who
        owns it — correct_member_campus() (0035) — not with a rename.
      */}
      <InstituteForm tree={tree} initial={institute} />
    </PageColumn>
  );
}
