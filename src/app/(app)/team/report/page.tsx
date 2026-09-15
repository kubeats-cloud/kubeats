import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { ActivityGridTable } from "@/components/report/activity-grid-table";
import { RangeControls } from "@/components/report/range-controls";
import { ExportExcel } from "@/components/report/export-excel";
import { requireAdmin } from "@/lib/admin";
import { getActivityReportModel } from "@/lib/exports/activity-export";
import { exportRangeSchema } from "@/lib/validation/export";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Activity report" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The client's activity report: one row per rep, over a range.
 *
 * OFF THE NAV BAR, AND REACHED FROM TEAM. CLAUDE.md's restraint rule is about
 * the thumb-reachable bar, and an admin already has six tabs; this is the same
 * call `/materials/manage` and `/data` got — a screen used a few times a month
 * lives one tap deeper rather than costing every other tab its width. It sits
 * under /team because Team is the screen about the whole team, and the
 * dashboard card links straight here.
 *
 * THE RANGE IS IN THE URL, which is what lets the export button produce exactly
 * the report on screen: both read the same `?start=&end=`, and the server
 * validates them with the same schema the endpoint uses. Nothing is counted
 * twice and no default is written down in two places.
 */
export default async function TeamReportPage(props: PageProps<"/team/report">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Activity report" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;

  // The same schema the endpoint parses, so an out-of-range or inverted range
  // is rejected identically here and there — and its defaults (this month,
  // resolved through todayISO()) are stated once, in that schema.
  const parsed = exportRangeSchema.safeParse({
    start: first(searchParams.start),
    end: first(searchParams.end),
  });

  if (!parsed.success) {
    return (
      <>
        <PageHeader title="Activity report" />
        <ErrorState
          message={
            parsed.error.issues[0]?.message ??
            "That date range is not one we can report on."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11">
          <Link href="/team/report">Back to this month</Link>
        </Button>
      </>
    );
  }

  const { start, end } = parsed.data;
  const result = await getActivityReportModel({ start, end }, null);

  return (
    <>
      <PageHeader
        eyebrow="Team"
        title="Activity report"
        description="What each rep did over the period, and where they left each institute."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/team">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Team
            </Link>
          </Button>
        }
      />

      <RangeControls start={start} end={end} basePath="/team/report" />

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <ExportExcel start={start} end={end} label="Export to Excel" />

          <SectionTitle className="mt-6">
            The period
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatDate(start)} – {formatDate(end)}
            </span>
          </SectionTitle>

          <div className="mt-3">
            <ActivityGridTable
              data={{ reps: result.model.reps, columns: result.model.columns }}
              caption={`Activity by rep from ${start} to ${end}`}
            />
          </div>

          <p className="text-muted-foreground mt-3 text-xs">
            Counts are the same figures the Team and report screens show:
            meetings from the daily plan, everything else from the visits log.
            Status columns are the vocabulary as it stands now.
          </p>
        </>
      )}
    </>
  );
}
