import { SettingsIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

export const metadata = { title: "Settings · Field Ops" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage the shared lists the whole team uses, and the team itself."
      />
      <EmptyState
        icon={SettingsIcon}
        title="Nothing to manage yet"
        description="Locations, meeting purposes and rep accounts will be administered here."
      />
    </>
  );
}
