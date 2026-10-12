import Link from "next/link";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { RangeControls } from "@/components/report/range-controls";
import { formatDate } from "@/lib/dates";
import { pipelineTotals } from "@/lib/pipeline-totals";
import type { OverviewPipelineResult } from "@/lib/overview-pipeline";

/**
 * The Institutes Pipeline on the admin Overview: the `/institutes/report` grid
 * with Overall, Open and Closed totals above it.
 *
 * Same `?from=&to=` as that screen, blank by default, and the range narrows all
 * three figures because they are read off the model the grid draws. No sort
 * headers — `sortHref()` belongs to `/institutes/report` — but the cell links
 * and the column picker come with the grid.
 */
export function OverviewPipeline({
  result,
}: {
  result: OverviewPipelineResult | null;
}) {
  if (!result?.ok) {
    return (
      <>
        <SectionTitle className="mt-8">Institutes pipeline</SectionTitle>
        <ErrorState
          message={
            result?.badRange
              ? result.error
              : "We could not load the institutes pipeline just now. Please try again in a moment."
          }
        />
        {result?.badRange && (
          <Button asChild variant="outline" className="mt-3 h-11 w-full">
            <Link href="/">Back to the whole pipeline</Link>
          </Button>
        )}
      </>
    );
  }

  const { model, range } = result;
  const totals = pipelineTotals(model);

  return (
    <>
      <SectionTitle className="mt-8">
        Institutes pipeline
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {model.rangeActive
            ? `Status changed ${formatDate(range.from) || "from the beginning"} – ${
                formatDate(range.to) || "today"
              }`
            : "As it stands"}
        </span>
      </SectionTitle>

      <div className="mt-3">
        <RangeControls
          start={range.from ?? ""}
          end={range.to ?? ""}
          basePath="/"
          optional
          hint="Filters by when an institute's status last changed. Leave both blank for the whole pipeline."
        />
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Figure label="Overall" value={totals.overall} />
        <Figure label="Open" value={totals.open} />
        <Figure label="Closed" value={totals.closed} />
      </dl>
      <p className="text-muted-foreground mt-2 text-xs">
        {totals.noStatus === null ? (
          <>
            Overall = Open + Closed. &ldquo;No status yet&rdquo; is not
            counted while a range is set: those institutes have never had a
            status, so no date range can include them.
          </>
        ) : (
          <>
            Overall = Open + Closed + No status yet ({totals.noStatus}).
          </>
        )}
      </p>

      <div className="mt-3">
        <CustomisableGrid
          viewKey="overview-pipeline"
          reps={model.reps}
          columns={model.columns}
          showActivities={false}
          unsetColumn={model.unsetColumn ?? undefined}
          linkCohorts
          caption="Institutes by current status, per owning rep"
        />
      </div>
      <Button asChild variant="outline" className="mt-3 h-11 w-full">
        <Link href="/institutes/report">View full pipeline</Link>
      </Button>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-card rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
