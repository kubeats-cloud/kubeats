import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClosingReportForm } from "@/components/visits/closing-report-form";
import { ReportView } from "@/components/visits/report-view";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getVisitReport } from "@/lib/closing-report";
import { activityLabelFor } from "@/lib/validation/visit";
import { needsClosingReport } from "@/lib/validation/closing-report";

export const metadata = { title: "Closing report" };

/**
 * A visit's closing report — the Pending screen's detail view, the same way
 * /institutes/[id] belongs to Institutes. It is not a seventh tab: nothing
 * links to it but a visit, and the bottom bar is unchanged.
 *
 * Three states: fill it in (the owner, not yet filed), read it (already filed,
 * or an admin looking at someone else's), or nothing to see.
 */
export default async function ClosingReportPage(
  props: PageProps<"/pending/[id]">,
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await props.params;
  const report = await getVisitReport(id);

  // RLS already hides another rep's visit; this turns "no rows" into a 404
  // rather than a broken page.
  if (!report) notFound();

  const mine = report.member === user.id;
  if (!mine && !isAdmin(user)) notFound();

  const filed = Boolean(report.reported_at);
  const canFile = mine && !filed && needsClosingReport(report.activity);

  const heading = report.institute?.name ?? "Visit";
  const subtitle = [
    activityLabelFor(report.activity),
    new Date(report.date).toLocaleDateString(),
    !mine ? report.memberName : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={filed ? "Filed report" : "Closing report"}
        title={heading}
        description={subtitle}
        action={
          <Button asChild variant="ghost" className="h-11">
            <Link href="/pending">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Back
            </Link>
          </Button>
        }
      />

      {canFile ? (
        <>
          <Card className="mb-4">
            <CardContent className="text-muted-foreground space-y-1 text-sm">
              <p>
                {[report.institute?.area, report.institute?.city]
                  .filter(Boolean)
                  .join(", ") || "Location on file"}
                {report.institute?.boards?.length
                  ? ` · ${report.institute.boards.join(", ")}`
                  : ""}
              </p>
              <p>
                {report.latitude !== null && report.longitude !== null
                  ? `Logged at ${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`
                  : "Logged without a location fix"}
              </p>
            </CardContent>
          </Card>
          <ClosingReportForm visit={report} />
        </>
      ) : (
        <>
          {filed && (
            <p className="bg-success-subtle text-success-subtle-foreground mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
              <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
              Filed {new Date(report.reported_at!).toLocaleString()}
            </p>
          )}
          {!filed && (
            <p className="bg-neutral-subtle text-neutral-subtle-foreground mb-4 rounded-md px-3 py-2 text-sm">
              No closing report has been filed for this visit yet.
            </p>
          )}
          <ReportView report={report} />
        </>
      )}
    </>
  );
}
