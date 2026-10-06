import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageColumn } from "@/components/layout/page-column";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { InstituteForm } from "@/components/institutes/institute-form";
import { getInstitute } from "@/lib/institutes";
import { getLocationTree } from "@/lib/locations";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { instituteEditRefusal } from "@/lib/validation/institute";

export const metadata = { title: "Edit institute" };

/**
 * Correcting an institute's details — an admin, or the owning rep ONCE.
 *
 * ⚠ THIS PAGE LOST ITS EDGE GATE, AND THAT IS THE COST OF B1.
 *
 * It used to be admin-only THREE times over: `proxy.ts` turned a rep away with
 * a real 307 via `ADMIN_ONLY_PATTERNS`, then `isAdmin()` here, then
 * `requireAdmin()` inside `updateInstitute()`. The first of those is gone, and
 * it had to be: the pattern list is static regexes matched before any database
 * read, so it cannot express "admin, OR the owner who still has an edit left" —
 * the allowance lives in a column and the edge has no row to consult. Keeping
 * it would have meant the feature could not exist.
 *
 * WHAT STILL STANDS, and it is four things, one fewer only at the edge:
 *
 *   this page's own server check, below;
 *   `updateInstitute()`'s gate, which refuses the write;
 *   `institutes_update` — owner-scoped on BOTH halves since 0028, so RLS alone
 *     already refuses a rep who does not own the row;
 *   `guard_rep_institute_edit()` raising FO030 on the second edit, in the
 *     database, where a tampered request also has to hear it.
 *
 * `nav.ts` records the same decision from its side. Neither comment is
 * decoration: the next person to read either should know the layer went on
 * purpose and what replaced it.
 *
 * A REDIRECT RATHER THAN notFound() for the refusal, matching /settings and
 * for its reason: this page renders dynamically, so by the time notFound() is
 * reached the response has begun streaming and Next answers 200 with a
 * not-found body. The content is protected either way, but a 200 on a refusal
 * reads like a page that loaded.
 *
 * notFound() IS still right for a missing institute — that is a genuine 404 and
 * carries no information about anyone's role. It is also what a rep gets for a
 * colleague's institute, because after 0028 `getInstitute()` cannot see it:
 * "no such page" and "not yours" are indistinguishable from outside, which is
 * the answer that leaks least.
 */
export default async function EditInstitutePage(
  props: PageProps<"/institutes/[id]/edit">,
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;

  const [institute, tree] = await Promise.all([getInstitute(id), getLocationTree()]);
  if (!institute) notFound();

  /*
   * The gate, from the same helper the detail page's Edit button and
   * `updateInstitute()` both use — so a button that appears, a page that opens
   * and a write that succeeds can never disagree about who may edit.
   */
  const admin = isAdmin(user);
  const refusal = instituteEditRefusal(institute, {
    isAdmin: admin,
    viewerId: user.id,
  });
  // Back to the institute rather than to "/", so a rep who has spent their
  // correction lands where the explanation for it is.
  if (refusal) redirect(`/institutes/${id}`);

  return (
    <PageColumn>
      <PageHeader
        eyebrow={admin ? "Admin" : "Your one correction"}
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
      {/* `oneTimeNotice` only for a rep: an admin edits without limit and must
          not be told they are spending something. */}
      <InstituteForm tree={tree} initial={institute} oneTimeNotice={!admin} />
    </PageColumn>
  );
}
