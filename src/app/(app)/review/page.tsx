import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { VisitReview } from "@/components/admin/visit-review";
import { requireStaff } from "@/lib/admin";
import { listTeamVisits, REVIEW_PAGE_SIZE } from "@/lib/admin-workspace";
import { listReps } from "@/lib/closing-report";
import { listStatusCatalogue, listCallStatusCatalogue } from "@/lib/statuses";
import { listInstitutesForPicker } from "@/lib/visits";
import { listCallReports } from "@/lib/call-reports";
import { mergeReviewFeed, reviewKinds } from "@/lib/review-feed";

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
  const gate = await requireStaff();
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
     * THREE STATUS PARAMS, DELIBERATELY UNMERGED.
     *
     * `?status=` has always meant the INSTITUTE's current status and keeps
     * meaning exactly that — every link already in the wild still resolves the
     * same way. On the visit register it reads `institutes.status`; on the call
     * register it reads `institutes.call_status`, because that is the badge a
     * call moved (0073). `?visitStatus=` means the visit's own
     * `status_set_to`; `?callStatus=` means the call's own. See VisitFilters
     * for why aliasing any two of them would answer the wrong question
     * quietly.
     */
    visitStatus: first(searchParams.visitStatus),
    callStatus: first(searchParams.callStatus),
    lifecycle: first(searchParams.lifecycle),
    statusCategory:
      first(searchParams.category) === "open" ||
      first(searchParams.category) === "closed"
        ? (first(searchParams.category) as "open" | "closed")
        : undefined,
  };

  /*
   * The page, read from the URL like every other piece of this screen's state.
   *
   * LENIENT, like the pipeline report's sort: a junk or out-of-range value
   * resolves to a real page rather than erroring, because a stale link should
   * land on something readable. `listTeamVisits` clamps it against the actual
   * result, so "?page=99" of a two-page register shows page 2 rather than an
   * empty table that reads as "nothing matches".
   */
  const requestedPage = Number.parseInt(first(searchParams.page) ?? "1", 10);

  const kinds = reviewKinds(filters);
  const emptyVisits = {
    ok: true as const,
    visits: [],
    total: 0,
    page: 1,
    pageSize: REVIEW_PAGE_SIZE,
    pageCount: 1,
  };
  const emptyCalls = { ok: true as const, reports: [], total: 0 };

  const [result, reps, institutes, catalogue, callCatalogue, calls] = await Promise.all([
    kinds.visits
      ? listTeamVisits(filters, 1, REVIEW_PAGE_SIZE)
      : Promise.resolve(emptyVisits),
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
    /*
     * The CALL vocabulary, read separately since 0070. It is a copy of the visit
     * list today, so the two dropdowns look identical — and that is the point:
     * they stop being identical the moment an admin edits one in Settings, and
     * the register has to offer the list its rows were actually filed under.
     */
    listCallStatusCatalogue(),
    kinds.calls
      ? listCallReports(filters, REVIEW_PAGE_SIZE)
      : Promise.resolve(emptyCalls),
  ]);

  const failure = (
    <>
      <PageHeader
        title="Review"
        description="Call Reports and Log Visit Reports submitted by the team."
      />
      <ErrorState message="We could not load the team's reports just now. Please try again in a moment." />
    </>
  );

  if (!result.ok || !calls.ok) return failure;

  const combinedTotal = result.total + calls.total;
  const combinedPageCount = Math.max(1, Math.ceil(combinedTotal / REVIEW_PAGE_SIZE));
  const normalizedPage =
    Number.isFinite(requestedPage) && requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;
  const resolvedPage = Math.min(normalizedPage, combinedPageCount);
  let visitCandidates = result.visits;
  let callCandidates = calls.reports;

  if (resolvedPage > 1) {
    const limit = resolvedPage * REVIEW_PAGE_SIZE;
    const [visitPage, callPage] = await Promise.all([
      kinds.visits
        ? listTeamVisits(filters, 1, limit)
        : Promise.resolve(emptyVisits),
      kinds.calls ? listCallReports(filters, limit) : Promise.resolve(emptyCalls),
    ]);
    if (!visitPage.ok || !callPage.ok) return failure;
    visitCandidates = visitPage.visits;
    callCandidates = callPage.reports;
  }

  const feed = mergeReviewFeed({
    visits: visitCandidates,
    calls: callCandidates,
    visitTotal: result.total,
    callTotal: calls.total,
    requestedPage: resolvedPage,
    pageSize: REVIEW_PAGE_SIZE,
  });

  return (
    <>
      <PageHeader
        title="Review"
        description="Call Reports and Log Visit Reports submitted by the team."
      />

      <VisitReview
        visits={feed.rows}
        total={feed.total}
        visitTotal={feed.visitTotal}
        callTotal={feed.callTotal}
        page={feed.page}
        pageCount={feed.pageCount}
        reps={reps.map((r) => ({ id: r.id, name: r.name }))}
        institutes={institutes.map((i) => ({ id: i.id, name: i.name }))}
        statuses={catalogue.map((s) => ({
          status: s.status,
          isActive: s.isActive,
        }))}
        callStatuses={callCatalogue.map((s) => ({
          status: s.status,
          isActive: s.isActive,
        }))}
        pageSize={feed.pageSize}
      />

    </>
  );
}
