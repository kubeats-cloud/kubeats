import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PageColumn } from "@/components/layout/page-column";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, CheckCircle2Icon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ReportView } from "@/components/visits/report-view";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getVisitReport } from "@/lib/closing-report";
import { activityLabelFor } from "@/lib/validation/visit";

export const metadata = { title: "Closing report" };

/**
 * A visit's report, READ ONLY — the Pending screen's detail view, the same way
 * /institutes/[id] belongs to Institutes.
 *
 * It used to have a third state: the owner filling the report in. Stage 3 moved
 * filing into the visit itself — check in, log, feedback, auto check-out — so
 * there is nothing to submit here for anybody. What remains is reading one,
 * which is what an admin always did with it.
 *
 * `report-view.tsx` skips an empty value, so a report filed under the old rich
 * form still renders in full and one filed under the short form simply shows
 * fewer rows.
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

  const heading = report.institute?.name ?? "Visit";
  const subtitle = [
    activityLabelFor(report.activity),
    formatDate(report.date),
    !mine ? report.memberName : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageColumn>
      <PageHeader
        eyebrow={filed ? "Filed report" : "Not reported"}
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

      {filed ? (
        <p className="bg-success-subtle text-success-subtle-foreground mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
          Filed {formatDateTime(report.reported_at)}
        </p>
      ) : (
        <p className="bg-neutral-subtle text-neutral-subtle-foreground mb-4 rounded-md px-3 py-2 text-sm">
          {mine
            ? "Not reported yet. Check in at this institute again and the visit that completes it will close this off."
            : "No report has been filed for this visit yet."}
        </p>
      )}
      <ReportView report={report} />
    </PageColumn>
  );
}
