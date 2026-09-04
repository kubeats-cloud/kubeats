import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { InstituteForm } from "@/components/institutes/institute-form";
import { getLocationTree } from "@/lib/locations";

export const metadata = { title: "Register institute" };

export default async function NewInstitutePage() {
  const tree = await getLocationTree();

  return (
    <>
      <PageHeader
        title="Register institute"
        description="Rule 1: an institute has to exist here before anything can be logged against it."
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href="/institutes">Cancel</Link>
          </Button>
        }
      />
      <InstituteForm tree={tree} />
    </>
  );
}
