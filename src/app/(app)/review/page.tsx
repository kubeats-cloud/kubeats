import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { VisitReview } from "@/components/admin/visit-review";
import { requireAdmin } from "@/lib/admin";
import { listTeamVisits, REVIEW_PAGE_SIZE } from "@/lib/admin-workspace";
import { listReps } from "@/lib/closing-report";
import { listStatusCatalogue } from "@/lib/statuses";
import { listInstitutesForPicker } from "@/lib/visits";

export const metadata = { title: "Review" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The team's work, all of it, filterable.
 *
 * proxy.ts already turned a rep away with a 307 before this ran; requireAdmin()
 * is the second of the three layers, and RLS underneath is the third — these
 * queries run as the signed-in admin, so the policy is what actually decides
 * whose visits come back.
 */
export default async function ReviewPage(props: PageProps<"/review">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Review" description="The team's logged work." />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;
  const filters = {
    member: first(searchParams.member),
    institute: first(searchParams.institute),
    activity: first(searchParams.activity),
    from: first(searchParams.from),
    to: first(searchParams.to),
    reported: first(searchParams.reported),
    instituteStatus: first(searchParams.status),
    /*
     * TWO STATUS PARAMS, DELIBERATELY UNMERGED.
     *
     * `?status=` has always meant the INSTITUTE's current status and keeps
     * meaning exactly that — every link already in the wild still resolves the
     * same way. `?visitStatus=` is the new one and means the visit's own. See
     * VisitFilters for why aliasing them would answer the wrong question
     * quietly.
     */
    visitStatus: first(searchParams.visitStatus),
    lifecycle: first(searchParams.lifecycle),
  };

  const [result, reps, institutes, catalogue] = await Promise.all([
    listTeamVisits(filters),
    listReps(),
    listInstitutesForPicker(),
    /*
     * The WHOLE vocabulary, retired statuses included — `listStatusCatalogue()`
     * and not `selectableStatuses()`, which filters to the active ones for a
     * rep's picker. An admin filtering the register is searching HISTORY, and
     * retiring a status takes it out of the picker without taking it off the
     * visits that already carry it. Filtering by it is exactly how you find
     * them. The panel marks them so nobody wonders why it is offered.
     *
     * Read from the database, never from SEED_STATUS_CATALOGUE: a status an
     * admin added last week has to be filterable this week.
     */
    listStatusCatalogue(),
  ]);

  return (
    <>
      <PageHeader
        title="Review"
        description="Every visit the team has logged, with its photo and closing report."
      />

      {result.ok ? (
        <VisitReview
          visits={result.visits}
          total={result.total}
          reps={reps.map((r) => ({ id: r.id, name: r.name }))}
          institutes={institutes.map((i) => ({ id: i.id, name: i.name }))}
          statuses={catalogue.map((s) => ({
            status: s.status,
            isActive: s.isActive,
          }))}
          pageSize={REVIEW_PAGE_SIZE}
        />
      ) : (
        <ErrorState message="We could not load the team's visits just now. Please try again in a moment." />
      )}
    </>
  );
}
