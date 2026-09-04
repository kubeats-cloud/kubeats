import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { PendingList } from "@/components/visits/pending-list";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPendingVisits } from "@/lib/visits";

export const metadata = { title: "Pending" };

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Scope comes from RLS, not from here: a rep's query returns their own rows,
  // an admin's returns the team's.
  const result = await getPendingVisits();

  return (
    <>
      <PageHeader
        title="Pending"
        description={
          isAdmin(user)
            ? "Sessions and campus visits the team has set but not yet closed."
            : "Sessions and campus visits you have set but not yet closed."
        }
      />

      {result.ok ? (
        <PendingList visits={result.visits} currentUserId={user.id} />
      ) : (
        <ErrorState message="We could not load your open loops. Please try again in a moment." />
      )}
    </>
  );
}
