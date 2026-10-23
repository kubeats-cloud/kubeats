import Link from "next/link";
import { ArrowLeftIcon, PlusIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import {
  InstitutesBrowser,
  type InstituteFilters,
} from "@/components/institutes/institutes-browser";
import { RepInstituteSearch } from "@/components/report/rep-institute-search";
import { RangeControls } from "@/components/report/range-controls";
import { DownloadActivity } from "@/components/report/download-activity";
import { getRegistryPage } from '@/lib/registry-page';
import { auditHref } from '@/lib/audit-pagination';
import {
  instituteActivityExportHref,
  instituteActivityExportRangeProblem,
} from '@/lib/institute-activity-links';
import { listStatusCatalogue } from "@/lib/statuses";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  getInstituteActivityModel,
  getInstituteStatusActivityModel,
  DEFAULT_INSTITUTE_ACTIVITY_SORT,
} from "@/lib/institute-activity-report";
import {
  isInstituteActivitySortKey,
  isStatusActivitySortKey,
} from "@/lib/institute-activity-counts";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";
import { ActivityPages } from '@/components/report/activity-pages';
import { ActivityFilters } from '@/components/report/activity-filters';
import { InstituteStatusActivityTable } from '@/components/report/institute-status-activity-table';
import { defaultExportRange } from "@/lib/validation/export";

export const metadata = { title: "Institutes" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * THE FILTERS ARRIVE IN THE URL, so a filtered registry is a link.
 *
 * That is the whole point of reading them here: the client's "click 3
 * scheduled and open those three institutes" is a count on another screen
 * becoming an href into this one. Nothing is filtered on the server — the
 * browser still does that over the list it is sent — so these are SEED values,
 * handed to the control once and then owned by it.
 *
 * NOT VALIDATED AGAINST ANYTHING HERE, and deliberately. A status that no
 * longer exists, a city nobody is in, a rep id that is not a rep: each lands
 * on an empty list with its own filter visible and clearable, which is a
 * readable answer. Rejecting them would turn a stale bookmark into an error
 * page. There is nothing to protect against either — the values only ever
 * reach a client-side `.filter()`, and which rows exist to be filtered was
 * already decided by RLS before this function returned.
 */
export default async function InstitutesPage(props: PageProps<"/institutes">) {
  const [searchParams, catalogue, user] = await Promise.all([
    props.searchParams,
    listStatusCatalogue(),
    getCurrentUser(),
  ]);

  const admin = isAdmin(user);
  const isRep = user?.role === "rep";
  const staff = admin || user?.role === "team_lead";
  const params = Object.fromEntries(Object.entries(searchParams).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
  const activityView = staff && first(searchParams.view) === 'activity';
  // The registry is not fetched for the activity view: it would be a page of
  // rows nothing on screen reads.
  const result = !isRep && !activityView ? await getRegistryPage(params) : null;

  /*
   * "INSTITUTE ACTIVITY" IS THE ADMIN/TEAM-LEAD REPORT, BEHIND A BUTTON.
   *
   * The client asked for the institute-wise table to live on the Institutes
   * tab rather than on Overview, reached by its own button — so the registry
   * stays the default view and `?view=activity` swaps it for the report.
   * Keeping it in the URL rather than local state means a filtered report
   * (dates, rep, campus, sort, page) can be linked and bookmarked, and the
   * Excel link reads the same parameters the table did.
   *
   * REP ONLY BELOW is the restored R1 table; a rep never sees this branch.
   */
  const parsedActivityRange = activityView
    ? pipelineRangeSchema.safeParse({
        from: first(searchParams.from),
        to: first(searchParams.to),
      })
    : null;
  const activityRangeError =
    parsedActivityRange && !parsedActivityRange.success
      ? (parsedActivityRange.error.issues[0]?.message ??
        "That date range is not one we can report on.")
      : null;
  const activityRange = parsedActivityRange?.success
    ? parsedActivityRange.data
    : {};
  const rawActivitySort = first(searchParams.sort);
  const activitySort = {
    key: isStatusActivitySortKey(rawActivitySort)
      ? rawActivitySort
      : 'institute',
    dir: first(searchParams.dir) === 'desc' ? ('desc' as const) : ('asc' as const),
  };
  const activityResult =
    activityView && !activityRangeError
      ? await getInstituteStatusActivityModel({
          range: activityRange,
          sort: activitySort,
          page: first(searchParams.page),
          search: first(searchParams.q),
          member: first(searchParams.member),
          campus: first(searchParams.campus),
        })
      : null;
  const exportProblem = instituteActivityExportRangeProblem(activityRange);
  const activityExtraParams = Object.fromEntries(
    Object.entries({
      view: 'activity',
      q: first(searchParams.q),
      member: first(searchParams.member),
      campus: first(searchParams.campus),
    }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  const initial: InstituteFilters = {
    q: first(searchParams.q),
    status: first(searchParams.status),
    owner: first(searchParams.owner),
    state: first(searchParams.state),
    city: first(searchParams.city),
    area: first(searchParams.area),
    type: first(searchParams.type),
    board: first(searchParams.board),
  };

  const repActivitySort = {
    key: isInstituteActivitySortKey(first(searchParams.sort))
      ? first(searchParams.sort)!
      : DEFAULT_INSTITUTE_ACTIVITY_SORT.key,
    dir: first(searchParams.dir) === "desc" ? ("desc" as const) : ("asc" as const),
  };
  const parsedRepRange = isRep
    ? pipelineRangeSchema.safeParse({
        from: first(searchParams.from),
        to: first(searchParams.to),
      })
    : null;
  const repRangeError =
    parsedRepRange && !parsedRepRange.success
      ? (parsedRepRange.error.issues[0]?.message ??
        "That date range is not one we can report on.")
      : null;
  const repRange = parsedRepRange?.success ? parsedRepRange.data : {};
  const repActivityResult =
    isRep && !repRangeError
      ? await getInstituteActivityModel({
          range: repRange,
          sort: repActivitySort,
        })
      : null;
  /*
   * The rep's download follows the table's range when it has both ends, and
   * otherwise opens on this month. It always offers BOTH ends: the 31-day cap
   * cannot be checked against a range that is open at one end.
   */
  const activityDownloadRange =
    repRange.from && repRange.to
      ? { start: repRange.from, end: repRange.to }
      : defaultExportRange();
  return (
    <>
      <PageHeader
        title="Institutes"
        // NOT "the shared registry" any more. After 0028 a rep sees only the
        // institutes they registered, so the old line promised a list they do
        // not get. An admin still sees all of them, and for them "everyone's"
        // is the honest word.
        description={
          admin
            ? "Every school, coaching centre and consultant, across all campuses."
            : "The schools, coaching centres and consultants you registered."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {staff && !activityView && (
              <Button asChild variant="outline" className="h-11">
                <Link href="/institutes?view=activity">
                  <TableIcon className="size-4" aria-hidden />
                  Institute Activity
                </Link>
              </Button>
            )}
            {activityView && (
              <Button asChild variant="outline" className="h-11">
                <Link href="/institutes">
                  <ArrowLeftIcon className="size-4" aria-hidden />
                  Back to institutes
                </Link>
              </Button>
            )}
            <Button asChild className="h-11">
              <Link href="/institutes/new">
                <PlusIcon className="size-4" aria-hidden />
                Register
              </Link>
            </Button>
          </div>
        }
      />

      {activityView ? (
        <>
          {/*
            A1 — the institute-wise report, moved here from Overview at the
            client's request. One row per institute with one column per active
            status, the SQL totals across every matching institute in the
            footer, and an Excel link that exports every matching visit.
          */}
          <ActivityFilters
            params={params}
            action="/institutes"
            clearHref="/institutes?view=activity"
          />
          <RangeControls
            start={activityRange.from ?? ""}
            end={activityRange.to ?? ""}
            basePath="/institutes"
            optional
            extraParams={{
              ...activityExtraParams,
              page: '1',
              sort: activitySort.key,
              dir: activitySort.dir,
            }}
            hint="Filters by the date the work was logged. Leave both blank for all time; the Excel export needs both dates."
          />

          {activityRangeError ? (
            <ErrorState message={activityRangeError} />
          ) : !activityResult?.ok ? (
            <ErrorState
              message={
                activityResult?.error ??
                "We could not load the institute activity just now. Please try again in a moment."
              }
            />
          ) : (
            <>
              {exportProblem ? (
                <p className="text-muted-foreground my-3 text-sm">
                  {exportProblem}
                </p>
              ) : (
                <a
                  download
                  className="my-3 inline-flex min-h-11 items-center rounded-md border px-4"
                  href={instituteActivityExportHref({
                    range: activityResult.model.range,
                    sortKey: activityResult.model.sort.key,
                    sortDir: activityResult.model.sort.dir,
                    search: first(searchParams.q),
                    member: first(searchParams.member),
                    campus: first(searchParams.campus),
                  })}
                >
                  Download Excel
                </a>
              )}
              <ActivityPages
                model={activityResult.model}
                basePath="/institutes"
                params={params}
              />
              <InstituteStatusActivityTable
                rows={activityResult.model.rows}
                statuses={activityResult.model.statuses}
                totals={activityResult.model.totals}
                sort={activityResult.model.sort}
                range={activityResult.model.range}
                basePath="/institutes"
                caption="One row per institute, one column per active status"
                extraParams={activityExtraParams}
              />
              <p className="text-muted-foreground mt-2 text-xs">
                Counts are logged visit rows in the chosen range. Status columns
                come from the status table — one per active status, in the
                app&apos;s order — and count the status recorded on the visit; a
                status with no visits still shows a 0 column. Follow-ups owned
                and pending come from <code>follow_up_tasks</code> (owned: not
                done; pending: not done and due on or before today). Meetings
                completed is <code>daily_plans.meetings_actual = 1</code>. Total
                visits counts every logged visit row. The totals row covers every
                matching institute, not only this page. In the Excel, one row is
                one visit; Meeting purpose is{' '}
                <code>daily_plans.purpose</code>, Next action is{' '}
                <code>visits.next_action</code>, Duration is check-out minus
                check-in and is blank unless both times are recorded; Follow-up
                Date and Time come from{' '}
                <code>visits.follow_up_date</code> and{' '}
                <code>visits.follow_up_time</code>, Follow-up Created is whether
                a <code>follow_up_tasks</code> row names the visit in{' '}
                <code>from_visit_id</code>, times are IST, missing times are
                blank, and the Total row sums the status and Follow-up Created
                columns.
              </p>
            </>
          )}
        </>
      ) : !isRep ? (
        result?.ok ? (
          <>
          <InstitutesBrowser
            key={new URLSearchParams(params).toString()}
            institutes={result.institutes}
            catalogue={catalogue}
            initial={initial}
            // Admin-only: a rep sees only their own institutes, so an owner
            // column would repeat one name down the page.
            showOwner={admin}
            serverFacets={result.facets}
            total={result.total}
          />
          <nav aria-label="Registry pages" className="my-4 flex items-center justify-between gap-3 text-sm">
            <p>Page {result.page} of {result.pages}</p>
            {result.page > 1 && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/institutes',params,result.page-1)}>Previous</Link>}
            {result.page < result.pages && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/institutes',params,result.page+1)}>Next</Link>}
          </nav>
          </>
        ) : (
          <ErrorState message="We could not load the registry just now. Please try again in a moment." />
        )
      ) : (
        <>
          <RangeControls
            start={repRange.from ?? ""}
            end={repRange.to ?? ""}
            basePath="/institutes"
            optional
            extraParams={
              repActivitySort.key !== DEFAULT_INSTITUTE_ACTIVITY_SORT.key ||
              repActivitySort.dir !== DEFAULT_INSTITUTE_ACTIVITY_SORT.dir
                ? { sort: repActivitySort.key, dir: repActivitySort.dir }
                : undefined
            }
            hint="Filters by the date the work was logged. Leave both blank for all time."
          />

          <div className="mb-4">
            <DownloadActivity
              start={activityDownloadRange.start}
              end={activityDownloadRange.end}
              sort={repActivitySort}
            />
          </div>

          {repRangeError ? (
            <ErrorState message={repRangeError} />
          ) : !repActivityResult?.ok ? (
            <ErrorState
              message={
                repActivityResult?.error ??
                "We could not load your activity just now. Please try again in a moment."
              }
            />
          ) : (
            <RepInstituteSearch
              rows={repActivityResult.model.rows}
              sort={repActivityResult.model.sort}
              range={repRange}
              caption="Your institutes: details, follow-ups and activity"
              basePath="/institutes"
              catalogue={catalogue}
            />
          )}
        </>
      )}
    </>
  );
}
