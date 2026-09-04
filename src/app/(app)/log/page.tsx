import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { LogVisitForm } from "@/components/visits/log-visit-form";
import { getCurrentUser } from "@/lib/auth";
import {
  getTodayPlan,
  listInstitutesForPicker,
} from "@/lib/visits";

export const metadata = { title: "Log Visit" };

export default async function LogVisitPage(props: PageProps<"/log">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const searchParams = await props.searchParams;
  const planParam = searchParams.plan;
  const initialPlanId = typeof planParam === "string" ? planParam : undefined;

  const [plan, institutes] = await Promise.all([
    getTodayPlan(user.id),
    listInstitutesForPicker(),
  ]);

  // Only entries not yet held can be completed — the rest are already counted.
  const openPlan = plan.ok
    ? plan.entries.filter((entry) => entry.meetings_actual === null)
    : [];

  return (
    <>
      <PageHeader
        title="Log a visit"
        description="Record what happened, with your location and an optional photo."
      />
      <LogVisitForm
        userId={user.id}
        institutes={institutes}
        openPlan={openPlan}
        initialPlanId={
          openPlan.some((entry) => entry.id === initialPlanId)
            ? initialPlanId
            : undefined
        }
      />
    </>
  );
}
