import Link from "next/link";
import { PlusIcon, TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import {
  InstitutesBrowser,
  type InstituteFilters,
} from "@/components/institutes/institutes-browser";
import { RepInstituteSearch } from "@/components/report/rep-institute-search";
import { RangeControls } from "@/components/report/range-controls";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  getInstituteActivityModel,
  DEFAULT_INSTITUTE_ACTIVITY_SORT,
} from "@/lib/institute-activity-report";
import { isInstituteActivitySortKey } from "@/lib/institute-activity-counts";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";
import { ActivityPages } from '@/components/report/activity-pages';

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
  const [searchParams, result, catalogue, user] = await Promise.all([
    props.searchParams,
    listInstitutes(),
    listStatusCatalogue(),
    getCurrentUser(),
  ]);

  const admin = isAdmin(user);
  const isRep = user?.role === "rep";

  const initial: InstituteFilters = {
    q: first(searchParams.q),
    status: first(searchParams.status),
    owner: first(searchParams.owner),
    state: first(searchParams.state),
    city: first(searchParams.city),
    area: first(searchParams.area),
    type: first(searchParams.type),
  };

  /*
   * REP SIDE #1 — "Create a single institute-wise table for the Rep."
   *
   * A rep no longer sees `InstitutesBrowser` at all (see the render below):
   * this is the ONE table the Institute tab shows them, built from
   * `getInstituteActivityModel` and carrying institute details (type,
   * location, status) alongside the activity counts, sortable, with its own
   * `?from=`/`?to=`/`?sort=`/`?dir=`.
   *
   * REP ONLY, per the client's own heading ("Rep Side") — not team_lead, not
   * admin, who keep `InstitutesBrowser` exactly as it was and already have
   * the fuller per-activity-type grid at /institutes/report. The model
   * itself needs no role branch (RLS scopes every role the same way); this
   * `isRep` check is only about which roles see which table on THIS shared
   * page, not about security.
   */
  const sortParam = first(searchParams.sort);
  const instituteActivitySort = {
    key: isInstituteActivitySortKey(sortParam)
      ? sortParam
      : DEFAULT_INSTITUTE_ACTIVITY_SORT.key,
    dir: first(searchParams.dir) === "desc" ? ("desc" as const) : ("asc" as const),
  };
  const parsedInstituteActivityRange = isRep
    ? pipelineRangeSchema.safeParse({
        from: first(searchParams.from),
        to: first(searchParams.to),
      })
    : null;
  const instituteActivityRangeError =
    parsedInstituteActivityRange && !parsedInstituteActivityRange.success
      ? (parsedInstituteActivityRange.error.issues[0]?.message ??
        "That date range is not one we can report on.")
      : null;
  const instituteActivityRange = parsedInstituteActivityRange?.success
    ? parsedInstituteActivityRange.data
    : {};
  const instituteActivityResult =
    isRep && !instituteActivityRangeError
      ? await getInstituteActivityModel({
          range: instituteActivityRange,
          sort: instituteActivitySort,
          page: first(searchParams.page),
          search: first(searchParams.q),
        })
      : null;
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
          <div className="flex items-center gap-2">
            {/* Admin only, and off the nav bar: the activity report is read
                weekly, not daily. A rep has no team-wide report to read. */}
            {admin && (
              <Button asChild variant="outline" className="h-11">
                <Link href="/institutes/report">
                  <TableIcon className="size-4" aria-hidden />
                  Activity report
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

      {/*
        R1 — a rep sees the one consolidated table and nothing else on this
        tab; `InstitutesBrowser` (the old registry grid, with its own
        text/dropdown filters) stays exactly as it was, but only for the
        roles that still use it.
      */}
      {!isRep && (
        result.ok ? (
          <InstitutesBrowser
            institutes={result.institutes}
            catalogue={catalogue}
            initial={initial}
            // Admin-only: a rep sees only their own institutes, so an owner
            // column would repeat one name down the page.
            showOwner={admin}
          />
        ) : (
          <ErrorState message="We could not load the registry just now. Please try again in a moment." />
        )
      )}

      {isRep && (
        <>
          <RangeControls
            start={instituteActivityRange.from ?? ""}
            end={instituteActivityRange.to ?? ""}
            basePath="/institutes"
            optional
            extraParams={
              instituteActivitySort.key !== DEFAULT_INSTITUTE_ACTIVITY_SORT.key ||
              instituteActivitySort.dir !== DEFAULT_INSTITUTE_ACTIVITY_SORT.dir
                ? { sort: instituteActivitySort.key, dir: instituteActivitySort.dir }
                : undefined
            }
            hint="Filters by the date the work was logged. Leave both blank for all time."
          />

          {instituteActivityRangeError ? (
            <ErrorState message={instituteActivityRangeError} />
          ) : !instituteActivityResult?.ok ? (
            <ErrorState
              message={
                instituteActivityResult?.error ??
                "We could not load your activity just now. Please try again in a moment."
              }
            />
          ) : (
            <>
            <ActivityPages model={instituteActivityResult.model} basePath="/institutes" params={Object.fromEntries(Object.entries(searchParams).filter((entry): entry is [string,string] => typeof entry[1] === 'string'))} />
            <RepInstituteSearch
              rows={instituteActivityResult.model.rows}
              sort={instituteActivityResult.model.sort}
              range={instituteActivityRange}
              caption="Your institutes: details, follow-ups and activity"
              basePath="/institutes"
              catalogue={catalogue}
              extraParams={{q: first(searchParams.q) ?? ''}}
            />
            </>
          )}
        </>
      )}
    </>
  );
}
