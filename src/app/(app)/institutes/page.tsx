import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { InstitutesBrowser } from "@/components/institutes/institutes-browser";
import { listInstitutes } from "@/lib/institutes";

export const metadata = { title: "Institutes · Field Ops" };

export default async function InstitutesPage() {
  const result = await listInstitutes();

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
        <InstitutesBrowser institutes={result.institutes} />
      ) : (
        <ErrorState message="We could not load the registry just now. Please try again in a moment." />
      )}
    </>
  );
}
