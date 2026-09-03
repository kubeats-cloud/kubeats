import { Building2Icon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Institutes · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader title="Institutes" description="The shared registry of schools, coaching centres and consultants." />
      <EmptyState
        icon={Building2Icon}
        title="No institutes yet"
        description="Registering an institute is the first step — nothing can be logged against one until it exists here."
      />
    </>
  );
}
