import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { ActivityGridTable } from "@/components/report/activity-grid-table";
import { requireAdmin } from "@/lib/admin";
import {
  cohortHref,
  getInstituteStatusModel,
} from "@/lib/institute-status-report";

export const metadata = { title: "Pipeline by rep" };

/**
 * WHERE EVERY INSTITUTE STANDS, one row per rep who owns them.
 *
 * The activity report's twin: same component, same column vocabulary, same
 * ordering — but counting `institutes.status` as it is NOW rather than
 * `visits.status_set_to` over a range. Once DASHBOARD ACTIVITIES came off the
 * screen, the activity report already WAS a status grid; this is that grid
 * asked about the pipeline instead of about the period.
 *
 * NO DATE CONTROLS, and that is why it is its own route rather than a tab on
 * /team/report. An institute has one current status; "where was it in March"
 * is `institute_status_history`, which is a different report. A screen with a
 * range picker that changed nothing would be worse than no picker.
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
export default async function InstituteStatusReportPage() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Pipeline by rep" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const result = await getInstituteStatusModel();

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

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <>
          <SectionTitle>
            As it stands
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {result.model.total} institute
              {result.model.total === 1 ? "" : "s"} in all
            </span>
          </SectionTitle>

          <div className="mt-3">
            <ActivityGridTable
              data={{
                reps: result.model.reps,
                columns: result.model.columns,
                // The status bands are the whole report; there is no activity
                // to show, and these rows carry no activity counts.
                showActivities: false,
                unsetColumn: result.model.unsetColumn,
                /*
                 * EVERY NON-ZERO CELL IS A DOOR into the rows behind it —
                 * the client's "click 3 scheduled, open those three".
                 *
                 * The two sentinels are the ones /institutes already
                 * understands, so this links into a screen built to answer
                 * it rather than into a new one.
                 */
                hrefFor: (rep, status) =>
                  rep.id ? cohortHref(rep.id, status) : null,
              }}
              caption="Institutes by current status, per owning rep"
            />
          </div>

          <p className="text-muted-foreground mt-3 text-xs">
            One row per rep, counted by who <strong>registered</strong> each
            institute — after migration 0028 that is the only rep who can see it
            or act on it. Every non-zero count opens those institutes.
            &ldquo;Unassigned&rdquo; is an institute whose owner has been
            removed; &ldquo;No status yet&rdquo; is one nobody has reached. The
            columns are the status vocabulary as it stands now, and a retired
            status still appears while anything sits at it.
          </p>
        </>
      )}
    </>
  );
}
