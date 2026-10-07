import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { RangeControls } from "@/components/report/range-controls";
import { requireStaff } from "@/lib/admin";
import { getInstituteStatusModel } from "@/lib/institute-status-report";
// `cohortHref` and `sortHref` moved to CustomisableGrid with the links they
// build — see the comment at the grid below.
import {
  pipelineRangeSchema,
  type PipelineRange,
} from "@/lib/validation/pipeline-report";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Pipeline by rep" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * WHERE EVERY INSTITUTE STANDS, one row per rep who owns them.
 *
 * The activity report's twin: same component, same column vocabulary, same
 * ordering — but counting `institutes.status` as it is NOW rather than
 * `visits.status_set_to` over a range. Once DASHBOARD ACTIVITIES came off the
 * screen, the activity report already WAS a status grid; this is that grid
 * asked about the pipeline instead of about the period.
 *
 * IT NOW TAKES PARAMETERS, WHICH REVERSES WHAT THIS COMMENT USED TO SAY.
 *
 * It said "NO DATE CONTROLS, and that is why it is its own route rather than a
 * tab on /team/report". Half of that still holds and half of it does not, and
 * the difference is worth being precise about, because the old sentence was
 * right about the thing it was actually defending:
 *
 *   STILL TRUE   this report has no PERIOD. An institute has exactly one
 *                current status, so "where was it in March" is
 *                `institute_status_history` and remains a different report.
 *                With no `?from=`/`?to=` the answer is every institute, which
 *                is the screen exactly as it was.
 *   NOW FALSE    "a screen with a range picker that changed nothing would be
 *                worse than no picker." The range here changes something real
 *                and different: it narrows to the institutes whose status
 *                MOVED inside the window. That is a question about activity,
 *                not about a period's pipeline, and it is the one an admin
 *                asks when they want to know what has been touched lately.
 *
 * The header and the summary line are what keep those two apart, and they are
 * not decoration — see `rangeActive` below.
 *
 * `?from=` / `?to=` RATHER THAN `?start=` / `?end=`. /team/report uses the
 * second pair because it shares `exportRangeSchema` with the Excel endpoint and
 * cannot rename them without breaking every export link already saved. This
 * screen has never taken a parameter, so it takes /review's filter vocabulary
 * instead. Both spellings are deliberate; neither is a mistake to tidy up.
 *
 * SERVER-RENDERED THROUGHOUT. The range and the sort are read from the URL and
 * applied in `getInstituteStatusModel()`, so a filtered, sorted report is a
 * link somebody can send — and there is no hydration-only behaviour, which is
 * what `institutes-browser.tsx`'s pattern would have given us. That component
 * mirrors state OUT to the URL for a client-side filter over an array it
 * already holds; this one reads the URL IN. The two look similar and are
 * opposites; /review plus RangeControls is the precedent this follows.
 *
 * OFF THE NAV BAR, reached from Institutes and the Overview — the same call
 * /team/report, /data and /materials/manage got. Six tabs is the bar, and a
 * screen read weekly lives one tap deeper.
 *
 * GATED THREE WAYS, and the FIRST one needed a new entry. /institutes is
 * SHARED — a rep browses their own — so no prefix covers this leaf, exactly
 * the shape `ADMIN_ONLY_PATTERNS` exists for and the same mechanism
 * /institutes/[id]/edit uses. `requireAdmin()` below is the second layer and
 * RLS the third. Without the pattern a rep would reach a report of the whole
 * team's pipeline; RLS would empty it, but they should never arrive at all.
 */
export default async function InstituteStatusReportPage(
  props: PageProps<"/institutes/report">,
) {
  const gate = await requireStaff();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Pipeline by rep" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;

  /*
   * THE RANGE IS REFUSED WHEN IT IS WRONG; THE SORT IS NOT.
   *
   * The asymmetry is deliberate and it is about what a bad value costs. An
   * inverted or impossible RANGE produces wrong NUMBERS under a heading that
   * does not mention it, so it is refused with a sentence — the same stance
   * /team/report takes. A bad SORT produces the right numbers in a different
   * order, which is a presentation fault; `parsePipelineSort()` falls back to
   * the default silently, following /institutes' stance for its own filters
   * ("rejecting them would turn a stale bookmark into an error page"). A status
   * renamed in Settings since somebody saved a sorted link is exactly that
   * case, and it is not rare.
   */
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

      {/*
        BOTH ENDS OPTIONAL, AND NO DEFAULT WINDOW.
        A default would hide every institute whose status has not moved this
        month — which is precisely the stalled pipeline an admin opens this
        screen to find. `pipelineRangeSchema` states that decision once.
      */}
      <RangeControls
        start={range.from ?? ""}
        end={range.to ?? ""}
        basePath="/institutes/report"
        optional
        // So applying a range does not silently reset the sort.
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
              {/*
                "X of T" WHILE A RANGE IS ACTIVE, and the plain count otherwise.

                The grand total in the table's own footer must equal the first
                figure — that is the reconciliation C1 exists to guarantee — and
                the second is what makes the first interpretable. A filtered
                number with no denominator is how a filter gets mistaken for a
                total.
              */}
              {result.model.rangeActive
                ? `${result.model.filteredTotal} of ${result.model.total} institute${
                    result.model.total === 1 ? "" : "s"
                  }`
                : `${result.model.total} institute${
                    result.model.total === 1 ? "" : "s"
                  } in all`}
            </span>
          </SectionTitle>

          {/* The count summary line. Figures come from the model, never
              recomputed here, so the line and the grid cannot disagree. */}
          <p className="text-muted-foreground mt-1 text-xs">
            {result.model.counts.reps} rep
            {result.model.counts.reps === 1 ? "" : "s"}
            {" · "}
            {result.model.counts.statuses} status
            {result.model.counts.statuses === 1 ? "" : "es"}
            {" · "}
            {result.model.filteredTotal} institute
            {result.model.filteredTotal === 1 ? "" : "s"}
            {/* Each gets its own clause rather than being folded into the rep
                count, because neither is a rep. Printed only when present. */}
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
            {/*
              THE TWO FUNCTION PROPS BECAME DATA (change-doc item 7).

              This grid can now have its columns and status categories folded
              away per reader, which means it is rebuilt in the browser — and a
              server page cannot hand a function to a client component. So the
              cell links and the sort links are described rather than supplied:
              `linkCohorts` asks for the cohort hrefs this screen has always
              drawn, and `sort` + `range` are what `sortHref()` was being closed
              over. Both helpers are pure URL builders and are rebuilt
              identically on the other side.

              What they meant has not changed:
                - EVERY NON-ZERO CELL IS A DOOR into the rows behind it — the
                  client's "click 3 scheduled, open those three" — linking into
                  /institutes, a screen already built to answer it.
                - The TOTAL column is never offered one: `buildActivityGrid`
                  does not consult `hrefFor` for it at all, because a total
                  spans several statuses and no single cohort page is honest.
                - Sorting is this screen's alone, and the range rides through
                  every sort link so the two parameter sets cannot knock each
                  other out.
            */}
            <CustomisableGrid
              viewKey="pipeline-report"
              reps={result.model.reps}
              columns={result.model.columns}
              // The status bands are the whole report; there is no activity to
              // show, and these rows carry no activity counts.
              showActivities={false}
              // Null while a range is active — see the model's own note.
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
