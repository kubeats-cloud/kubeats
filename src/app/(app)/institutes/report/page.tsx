import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { RangeControls } from "@/components/report/range-controls";
import { requireAdmin } from "@/lib/admin";
import { getInstituteStatusModel } from "@/lib/institute-status-report";
import {
  pipelineRangeSchema,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Pipeline by rep" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

export default async function InstituteStatusReportPage(
  props: PageProps<"/institutes/report">,
) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Pipeline by rep" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;

  const parsedRange = pipelineRangeSchema.safeParse({
    from: first(searchParams.from),
    to: first(searchParams.to),
  });

  if (!parsedRange.success) {
    return (
      <>
        <PageHeader eyebrow="Institutes" title="Pipeline by rep" />
        <ErrorState
          message={
            parsedRange.error.issues[0]?.message ??
            "That date range is not one we can report on."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11">
          <Link href="/institutes/report">Back to the whole pipeline</Link>
        </Button>
      </>
    );
  }

  const range: PipelineRange = parsedRange.data;

  const result = await getInstituteStatusModel({
    range,
    sort: { key: first(searchParams.sort), dir: first(searchParams.dir) },
  });

  return (
    <>
      <PageHeader
        eyebrow="Institutes"
        title="Pipeline by rep"
        description="Where every registered institute stands right now, by the rep who owns it."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/institutes">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Institutes
            </Link>
          </Button>
        }
      />

      <RangeControls
        start={range.from ?? ""}
        end={range.to ?? ""}
        basePath="/institutes/report"
        optional
        extraParams={
          result.ok &&
          (result.model.sort.key !== "rep" || result.model.sort.dir !== "asc")
            ? { sort: result.model.sort.key, dir: result.model.sort.dir }
            : undefined
        }
        hint="Filters by when an institute's status last changed. Leave both blank for the whole pipeline."
      />

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <SectionTitle>
            {result.model.rangeActive ? "Status changed in range" : "As it stands"}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {result.model.rangeActive
                ? `${result.model.filteredTotal} of ${result.model.total} institute${
                    result.model.total === 1 ? "" : "s"
                  }`
                : `${result.model.total} institute${
                    result.model.total === 1 ? "" : "s"
                  } in all`}
            </span>
          </SectionTitle>

          <p className="text-muted-foreground mt-1 text-xs">
            {result.model.counts.reps} rep
            {result.model.counts.reps === 1 ? "" : "s"}
            {" · "}
            {result.model.counts.statuses} status
            {result.model.counts.statuses === 1 ? "" : "es"}
            {" · "}
            {result.model.filteredTotal} institute
            {result.model.filteredTotal === 1 ? "" : "s"}
            {result.model.counts.nonRepOwners > 0 &&
              ` · ${result.model.counts.nonRepOwners} non-rep owner${
                result.model.counts.nonRepOwners === 1 ? "" : "s"
              }`}
            {result.model.counts.anyUnassigned && " · plus unassigned"}
          </p>

          {result.model.rangeActive && (
            <p className="bg-warning-subtle text-warning-subtle-foreground mt-3 rounded-md px-3 py-2 text-xs">
              Showing institutes whose status changed between{" "}
              <strong>{formatDate(range.from) || "the beginning"}</strong> and{" "}
              <strong>{formatDate(range.to) || "today"}</strong>, by the
              Indian calendar day. The &ldquo;No status yet&rdquo; column is not
              shown: those institutes have never had a status set, so no date
              range can include them.
            </p>
          )}

          <div className="mt-3">
            <CustomisableGrid
              viewKey="pipeline-report"
              reps={result.model.reps}
              columns={result.model.columns}
              showActivities={false}
              unsetColumn={result.model.unsetColumn ?? undefined}
              linkCohorts
              sort={result.model.sort}
              range={range}
              caption="Institutes by current status, per owning rep"
            />
          </div>

          <p className="text-muted-foreground mt-3 text-xs">
            One row per rep, counted by who <strong>registered</strong> each
            institute — after migration 0028 that is the only rep who can see it
            or act on it. Every non-zero count opens those institutes; the
            Total column does not, because it spans several statuses at once.
            &ldquo;Unassigned&rdquo; is an institute whose owner has been
            removed and stays at the foot of the table whichever column you sort
            by; &ldquo;No status yet&rdquo; is one nobody has reached. The
            columns are the status vocabulary as it stands now, and a retired
            status still appears while anything sits at it.
          </p>
        </>
      )}
    </>
  );
}
