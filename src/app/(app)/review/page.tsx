import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { VisitReview } from "@/components/admin/visit-review";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { requireStaff } from "@/lib/admin";
import { listTeamVisits, REVIEW_PAGE_SIZE } from "@/lib/admin-workspace";
import { listReps } from "@/lib/closing-report";
import { listStatusCatalogue } from "@/lib/statuses";
import { listInstitutesForPicker } from "@/lib/visits";
import { listCallReports } from "@/lib/call-reports";
import { mergeReviewFeed, reviewKinds } from "@/lib/review-feed";
import {
  getCallActivityReport,
  parseCallActivityFilters,
  parseCallActivitySort,
  totalsRow,
} from "@/lib/call-activity-report";
import { CallActivityFilters } from "@/components/report/call-activity-filters";
import { FormNotice } from "@/components/form-notice";

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

  /*
   * THE CALL ACTIVITY REPORT'S OWN PAGE/SORT PARAMS, DELIBERATELY NAMED
   * DIFFERENTLY FROM THE REGISTER'S ABOVE (`page`, not `callPage`). The two
   * tables on this screen page and sort independently — this is its own
   * section, below the register, and must not fight it over one query key.
   */
  const callSort = parseCallActivitySort(
    first(searchParams.callSort),
    first(searchParams.callDir),
  );
  const callPageRequested = Number.parseInt(first(searchParams.callPage) ?? "1", 10);

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

  const [result, reps, institutes, catalogue, calls] = await Promise.all([
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
    kinds.calls
      ? listCallReports(filters, REVIEW_PAGE_SIZE)
      : Promise.resolve(emptyCalls),
  ]);

  /*
   * THE CALL ACTIVITY REPORT'S OWN FILTERS — parsed only now, because
   * validating `callStatus` against the live catalogue needs `catalogue`
   * resolved first (it is the same read `listStatusCatalogue()` above
   * already did; asking twice would be the thing this file's performance
   * rule exists to avoid). Each bad field is dropped and explained rather
   * than thrown — see `parseCallActivityFilters()`'s own header.
   */
  const { filters: callFilters, notices: callNotices } = parseCallActivityFilters(
    {
      from: first(searchParams.callFrom),
      to: first(searchParams.callTo),
      member: first(searchParams.callMember),
      institute: first(searchParams.callInstitute),
      status: first(searchParams.callStatus),
    },
    catalogue,
  );
  const callActivity = await getCallActivityReport(
    callFilters,
    callSort,
    callPageRequested,
  );

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

  /*
   * THE CALL ACTIVITY REPORT'S OWN SORT LINKS AND PAGER, built the same way
   * the register's above are — every OTHER search param preserved, only
   * this section's own (`callSort`/`callDir`/`callPage`) replaced.
   */
  const callActivitySortHrefs: Record<string, string> = {};
  const callActivityHref = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParams)) {
      if (typeof value !== "string" || value === "") continue;
      params.set(name, value);
    }
    for (const [name, value] of Object.entries(overrides)) {
      if (value === null) params.delete(name);
      else params.set(name, value);
    }
    const query = params.toString();
    return query ? `/review?${query}` : "/review";
  };

  if (callActivity.ok) {
    for (const key of [
      "rep",
      "open_total",
      "closed_total",
      "total",
      ...callActivity.columns.closed.map((c) => `status:${c.status}`),
      ...callActivity.columns.open.map((c) => `status:${c.status}`),
    ]) {
      const dir =
        callSort.key === key ? (callSort.dir === "asc" ? "desc" : "asc") : key === "rep" ? "asc" : "desc";
      callActivitySortHrefs[key] = callActivityHref({
        callSort: key,
        callDir: dir,
        callPage: null,
      });
    }
  }
  const callActivityPageHref = (page: number) =>
    callActivityHref({ callPage: page <= 1 ? null : String(page) });

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
        pageSize={feed.pageSize}
      />

      {/*
        ITS OWN SECTION, BELOW THE REGISTER — per the placement rule, no
        overlap with the list above: a different heading, a different pair of
        query keys, and a different fetch. Admin and Team Lead both reach
        this page via requireStaff(); a Team Lead's rows are narrowed to
        their own reps by the RPC itself (supervises()), never by this page.
      */}
      <SectionTitle className="mt-8">Call Activity Report</SectionTitle>
      <p className="text-muted-foreground mb-3 text-xs">
        One row per rep: every call counted once, under its current status.
      </p>

      <CallActivityFilters
        reps={reps.map((r) => ({ id: r.id, name: r.name }))}
        statuses={catalogue
          .filter((s) => s.isActive)
          .map((s) => ({ status: s.status, category: s.category }))}
        initial={{
          from: first(searchParams.callFrom),
          to: first(searchParams.callTo),
          member: first(searchParams.callMember),
          institute: first(searchParams.callInstitute),
          status: first(searchParams.callStatus),
        }}
      />

      {callNotices.map((notice) => (
        <div key={notice} className="mb-3">
          <FormNotice message={notice} />
        </div>
      ))}

      {!callActivity.ok ? (
        <ErrorState message={callActivity.error} />
      ) : (
        <>
          <CustomisableGrid
            viewKey="call-activity-report"
            reps={callActivity.reps}
            columns={callActivity.columns}
            totalsReps={[totalsRow(callActivity.totals)]}
            showActivities={false}
            showGroupTotals
            linkReps
            sort={callSort}
            sortHrefs={callActivitySortHrefs}
            caption="Call Activity Report — one row per rep"
          />

          {callActivity.pages > 1 && (
            <nav
              className="mt-3 flex items-center justify-between gap-3"
              aria-label="Call Activity Report pages"
            >
              <Button
                asChild={callActivity.page > 1}
                variant="outline"
                className="h-11"
                disabled={callActivity.page <= 1}
              >
                {callActivity.page > 1 ? (
                  <Link href={callActivityPageHref(callActivity.page - 1)} scroll={false}>
                    <ChevronLeftIcon className="size-4" aria-hidden />
                    Newer
                  </Link>
                ) : (
                  <span>
                    <ChevronLeftIcon className="size-4" aria-hidden />
                    Newer
                  </span>
                )}
              </Button>

              <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
                Page {callActivity.page} of {callActivity.pages}
              </p>

              <Button
                asChild={callActivity.page < callActivity.pages}
                variant="outline"
                className="h-11"
                disabled={callActivity.page >= callActivity.pages}
              >
                {callActivity.page < callActivity.pages ? (
                  <Link href={callActivityPageHref(callActivity.page + 1)} scroll={false}>
                    Older
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <span>
                    Older
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </span>
                )}
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
