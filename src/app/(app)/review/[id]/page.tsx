import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageColumn } from "@/components/layout/page-column";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { ReportView } from "@/components/visits/report-view";
import { VisitProof } from "@/components/admin/visit-proof";
import { requireAdmin } from "@/lib/admin";
import { getVisitReport } from "@/lib/closing-report";
import { activityLabelFor } from "@/lib/validation/visit";

export const metadata = { title: "Visit" };

/**
 * One visit, read-only.
 *
 * Deliberately not the rep's closing-report form at /pending/[id]: an admin
 * reviews work, they do not file it, and the surest way to keep that true is to
 * give them a screen with nothing to submit. The proof photo is shown large
 * here rather than as a thumbnail — this is the screen where somebody is
 * actually looking at the evidence.
 */
export default async function ReviewVisitPage(props: PageProps<"/review/[id]">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <PageColumn>
        <PageHeader title="Visit" />
        <ErrorState message={gate.error} />
      </PageColumn>
    );
  }

  const { id } = await props.params;
  const report = await getVisitReport(id);
  if (!report) notFound();

  const activity = activityLabelFor(report.activity);
  // The institute is a separate lookup and can come back null if it was
  // removed after the visit; the visit itself is still worth reading.
  const where = report.institute?.name ?? "an institute that no longer exists";
  const who = report.memberName ?? "an unknown member";

  return (
    <PageColumn>
      <PageHeader
        eyebrow="Visit"
        title={where}
        description={`${activity} · ${report.date} · logged by ${who}`}
        action={
          <Button asChild variant="outline" className="h-10">
            <Link href="/review">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Back
            </Link>
          </Button>
        }
      />

      {report.photo && (
        <Card className="mb-5 p-4">
          <VisitProof
            photo={report.photo}
            caption={`${activity} at ${where}, ${report.date}`}
          />
        </Card>
      )}

      <ReportView report={report} />
    </PageColumn>
  );
}
