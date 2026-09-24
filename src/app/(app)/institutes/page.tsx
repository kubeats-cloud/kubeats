import Link from "next/link";
import { PlusIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import {
  InstitutesBrowser,
  type InstituteFilters,
} from "@/components/institutes/institutes-browser";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const metadata = { title: "Institutes" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * THE FILTERS ARRIVE IN THE URL, so a filtered registry is a link.
 *
 * That is the whole point of reading them here: the client's "click 3
 * scheduled and open those three institutes" is a count on another screen
 * becoming an href into this one. Nothing is filtered on the server — the
 * browser still does that over the list it is sent — so these are SEED values,
 * handed to the control once and then owned by it.
 *
 * NOT VALIDATED AGAINST ANYTHING HERE, and deliberately. A status that no
 * longer exists, a city nobody is in, a rep id that is not a rep: each lands
 * on an empty list with its own filter visible and clearable, which is a
 * readable answer. Rejecting them would turn a stale bookmark into an error
 * page. There is nothing to protect against either — the values only ever
 * reach a client-side `.filter()`, and which rows exist to be filtered was
 * already decided by RLS before this function returned.
 */
export default async function InstitutesPage(props: PageProps<"/institutes">) {
  const [searchParams, result, catalogue, user] = await Promise.all([
    props.searchParams,
    listInstitutes(),
    listStatusCatalogue(),
    getCurrentUser(),
  ]);

  const admin = isAdmin(user);

  const initial: InstituteFilters = {
    q: first(searchParams.q),
    status: first(searchParams.status),
    owner: first(searchParams.owner),
    state: first(searchParams.state),
    city: first(searchParams.city),
    area: first(searchParams.area),
    type: first(searchParams.type),
  };

  return (
    <>
      <PageHeader
        title="Institutes"
        // NOT "the shared registry" any more. After 0028 a rep sees only the
        // institutes they registered, so the old line promised a list they do
        // not get. An admin still sees all of them, and for them "everyone's"
        // is the honest word.
        description={
          admin
            ? "Every school, coaching centre and consultant, across all campuses."
            : "The schools, coaching centres and consultants you registered."
        }
        action={
          <div className="flex items-center gap-2">
            {/* Admin only, and off the nav bar: the pipeline is read weekly,
                not daily. A rep has no team-wide pipeline to read. */}
            {admin && (
              <Button asChild variant="outline" className="h-11">
                <Link href="/institutes/report">
                  <TableIcon className="size-4" aria-hidden />
                  Pipeline by rep
                </Link>
              </Button>
            )}
            <Button asChild className="h-11">
              <Link href="/institutes/new">
                <PlusIcon className="size-4" aria-hidden />
                Register
              </Link>
            </Button>
          </div>
        }
      />

      {result.ok ? (
        <InstitutesBrowser
          institutes={result.institutes}
          catalogue={catalogue}
          initial={initial}
          // Admin-only: a rep sees only their own institutes, so an owner
          // column would repeat one name down the page.
          showOwner={admin}
        />
      ) : (
        <ErrorState message="We could not load the registry just now. Please try again in a moment." />
      )}
    </>
  );
}
