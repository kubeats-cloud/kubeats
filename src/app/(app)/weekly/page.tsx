import { TargetIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Weekly · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader title="Weekly" description="Your commitment for the week, and what you have achieved against it." />
      <EmptyState
        icon={TargetIcon}
        title="No commitment for this week"
        description="Once submitted, a week locks. An admin can reopen it if something needs to change."
      />
    </>
  );
}
