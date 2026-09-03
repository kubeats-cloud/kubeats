import { ClockIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Pending · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pending" description="Sessions and campus visits that are set but not yet done." />
      <EmptyState
        icon={ClockIcon}
        title="No open loops"
        description="Anything you schedule will wait here until you close it off."
      />
    </>
  );
}
