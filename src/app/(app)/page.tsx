import { LayoutDashboardIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Dashboard · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader title="Dashboard" description="Today at a glance, and how the week is tracking." />
      <EmptyState
        icon={LayoutDashboardIcon}
        title="Nothing to show yet"
        description="Today's plan, open loops and weekly progress will appear here once the screens are built."
      />
    </>
  );
}
