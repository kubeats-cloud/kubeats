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

  return (
    <>
      <PageHeader
        title="Institutes"
        description="The shared registry of schools, coaching centres and consultants."
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
          showOwner={isAdmin(user)}
        />
      ) : (
        <ErrorState message="We could not load the registry just now. Please try again in a moment." />
      )}
    </>
  );
}
