import Link from "next/link";
import { ArrowLeftIcon, FileSpreadsheetIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { InstituteActivityTable } from "@/components/report/institute-activity-table";
import { RangeControls } from "@/components/report/range-controls";
import { requireStaff } from "@/lib/admin";
import {
  getInstituteActivityModel,
  DEFAULT_INSTITUTE_ACTIVITY_SORT,
} from "@/lib/institute-activity-report";
import { instituteActivityExportHref } from "@/lib/institute-activity-links";
import {
  pipelineRangeSchema,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";
import { isInstituteActivitySortKey } from "@/lib/institute-activity-counts";

export const metadata = { title: "Activity report" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * INSTITUTE-WISE ACTIVITY REPORT (A1), replacing the rep-wise pipeline grid.
 *
 * One row per institute, with Open/Closed counts for each of the six activity
 * types — the client's own ask, that the old "Pipeline by rep" screen could
 * not answer because its rows were reps and its columns were status NAMES
 * rather than a category by activity. `getInstituteActivityModel()` is the
 * single counted path: `tallyVisitMetrics()` / `reconcileActivityCounts()`
 * underneath, the same arithmetic Weekly, Team and the Excel export already
 * use — see that module's own comment for why this is TypeScript and not a
 * second SQL copy of Rule 7.
 *
 * `getInstituteStatusModel()` — the old rep-wise pipeline — is left in the
 * tree unused by this page. Nothing in this batch requires deleting it.
 *
 * GATED THREE WAYS, unchanged from the screen this replaces: the path pattern
 * in `nav.ts`, `requireStaff()` here, and RLS underneath (admin sees every
 * institute; a team lead sees only `supervises()`'s own team's rows; a rep
 * never reaches this screen at all — R1 brings the rep's own table later,
 * from the same model).
 */
export default async function InstituteActivityReportPage(
  props: PageProps<"/institutes/report">,
) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Activity report" />
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
        <PageHeader eyebrow="Institutes" title="Activity report" />
        <ErrorState
          message={
            parsedRange.error.issues[0]?.message ??
            "That date range is not one we can report on."
          }
        />
        <Button asChild variant="outline" className="mt-4 h-11">
          <Link href="/institutes/report">Back to the whole report</Link>
        </Button>
      </>
    );
  }

  const range: PipelineRange = parsedRange.data;
  const sortKeyParam = first(searchParams.sort);
  const sort = {
    key: isInstituteActivitySortKey(sortKeyParam)
      ? sortKeyParam
      : DEFAULT_INSTITUTE_ACTIVITY_SORT.key,
    dir: first(searchParams.dir) === "desc" ? ("desc" as const) : ("asc" as const),
  };

  const result = await getInstituteActivityModel({ range, sort });

  return (
    <>
      <PageHeader
        eyebrow="Institutes"
        title="Activity report"
        description="Every institute's activity, Open and Closed by type, over a date range you choose."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/institutes">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Institutes
            </Link>
          </Button>
        }
      />

      {/*
        BOTH ENDS OPTIONAL, AND NO DEFAULT WINDOW — same stance as the screen
        this replaces. A default would hide every institute with no activity
        in the window, which is precisely what this report exists to surface.
      */}
      <RangeControls
        start={range.from ?? ""}
        end={range.to ?? ""}
        basePath="/institutes/report"
        optional
        extraParams={
          sort.key !== DEFAULT_INSTITUTE_ACTIVITY_SORT.key ||
          sort.dir !== DEFAULT_INSTITUTE_ACTIVITY_SORT.dir
            ? { sort: sort.key, dir: sort.dir }
            : undefined
        }
        hint="Filters by the date the work was logged. Leave both blank for all time."
      />

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle className="mb-0">
              {result.model.rangeActive ? "Activity in range" : "All activity"}
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {result.model.rows.length} of {result.model.totalInstitutes}{" "}
                institute{result.model.totalInstitutes === 1 ? "" : "s"}
              </span>
            </SectionTitle>

            {/*
              A PLAIN LINK, NOT THE `ExportExcel` COMPONENT. That component
              owns its own date-range state so one button can serve both the
              per-rep and all-reps screens; a second, independent range here
              would let the download disagree with the table it sits beside,
              which is exactly what "Excel bytes match the filtered/sorted
              table" rules out. This link carries the SAME range and sort the
              table was just built with — nothing the reader can diverge.
            */}
            <Button asChild variant="outline" className="h-11">
              <a
                href={instituteActivityExportHref({
                  range,
                  sortKey: sort.key,
                  sortDir: sort.dir,
                })}
                download
              >
                <FileSpreadsheetIcon className="size-4" aria-hidden />
                Download Excel
              </a>
            </Button>
          </div>

          {result.model.rangeActive && (
            <p className="bg-warning-subtle text-warning-subtle-foreground mt-3 rounded-md px-3 py-2 text-xs">
              Showing activity logged between the dates above, by the Indian
              calendar day.
            </p>
          )}

          {result.model.reconciliationFailed && (
            <p className="bg-danger-subtle text-danger-subtle-foreground mt-3 rounded-md px-3 py-2 text-xs">
              Some institutes&apos; activity counts could not be reconciled
              against the single counted source. Totals for those institutes
              are shown as visit counts rather than a type breakdown. This has
              been logged for investigation.
            </p>
          )}

          <div className="mt-3">
            <InstituteActivityTable
              rows={result.model.rows}
              sort={result.model.sort}
              range={range}
              caption="Institutes by activity, Open and Closed per type"
            />
          </div>

          <p className="text-muted-foreground mt-3 text-xs">
            Every non-zero Open/Closed count opens the visits behind it on
            Review. The six activity columns count visit rows, the same
            arithmetic Weekly and Team already report.
          </p>
        </>
      )}
    </>
  );
}
