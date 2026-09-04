import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { ErrorState } from "@/components/states";
import { DailyPlan } from "@/components/dashboard/daily-plan";
import { getCurrentUser } from "@/lib/auth";
import {
  getTodayPlan,
  listInstitutesForPicker,
  listPurposes,
} from "@/lib/visits";

export const metadata = { title: "Dashboard · Field Ops" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [plan, institutes, purposes] = await Promise.all([
    getTodayPlan(user.id),
    listInstitutesForPicker(),
    listPurposes(),
  ]);

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        description="Plan today's visits here, then log them as they happen."
      />

      <SectionTitle>Today</SectionTitle>
      {plan.ok ? (
        <DailyPlan
          institutes={institutes}
          purposes={purposes}
          entries={plan.entries}
        />
      ) : (
        <ErrorState message="We could not load today's plan. Please try again in a moment." />
      )}
    </>
  );
}
