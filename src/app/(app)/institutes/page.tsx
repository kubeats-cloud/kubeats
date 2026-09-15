import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { InstitutesBrowser } from "@/components/institutes/institutes-browser";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const metadata = { title: "Institutes" };

export default async function InstitutesPage() {
  const [result, catalogue, user] = await Promise.all([
    listInstitutes(),
    listStatusCatalogue(),
    getCurrentUser(),
  ]);

  const admin = isAdmin(user);

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
          <Button asChild className="h-11">
            <Link href="/institutes/new">
              <PlusIcon className="size-4" aria-hidden />
              Register
            </Link>
          </Button>
        }
      />

      {result.ok ? (
        <InstitutesBrowser
          institutes={result.institutes}
          catalogue={catalogue}
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
