import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Log Visit · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader title="Log Visit" description="Record a meeting, session, campus visit or admission." />
      <EmptyState
        icon={PlusIcon}
        title="Nothing to log yet"
        description="Logging captures the activity, your location and an optional photo. A meeting also needs to be on today's plan."
      />
    </>
  );
}
