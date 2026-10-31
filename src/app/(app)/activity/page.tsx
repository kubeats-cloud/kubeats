import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { requireAdmin } from "@/lib/admin";
import { listReps } from "@/lib/closing-report";
import { listStatusCatalogue } from "@/lib/statuses";
import { exportRangeSchema } from "@/lib/validation/export";
import { getActivityReportModel } from "@/lib/exports/activity-export";
import {
  getCallActivityReport,
  parseCallActivityFilters,
  parseCallActivitySort,
} from "@/lib/call-activity-report";
import { getInstituteStatusModel } from "@/lib/institute-status-report";
import { pipelineRangeSchema } from "@/lib/validation/pipeline-report";
import { getInstituteStatusActivityModel } from "@/lib/institute-activity-report";
import { isStatusActivitySortKey } from "@/lib/institute-activity-counts";
import { ActivityTabs } from "@/components/activity/activity-tabs";
import {
  DEFAULT_ACTIVITY_TAB,
  isActivityTabKey,
  type ActivityTabKey,
} from "@/components/activity/activity-tabs-meta";
import { RepActivityBox } from "@/components/activity/rep-activity-box";
import { CallActivityBox } from "@/components/activity/call-activity-box";
import { PipelineBox } from "@/components/activity/pipeline-box";
import { InstituteActivityBox } from "@/components/activity/institute-activity-box";

export const metadata = { title: "Activity" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The Activity tab: Rep Activity, Call Activity, Pipeline by Rep and
 * Institute-Wise Activity, as four switchable cards over one report region.
 *
 * ⚠ CONSOLIDATION, NOT A REBUILD. Every report here reads from the SAME
 * model function, renders the SAME table component and downloads from the
 * SAME export route its own standalone screen already uses — `/team/report`,
 * `/institutes/report` and `/institutes?view=activity` are untouched and keep
 * working. Call Activity's summary moved here from `/review`, which keeps the
 * Call/Visit register and its editing but no longer renders that summary.
 * Only Pipeline by Rep gained something new: it had no Excel export before
 * this (`/api/export/pipeline`, explicitly allowed by the brief because the
 * screen had none).
 *
 * ALL FOUR ARE FETCHED ON EVERY LOAD, each under its own query-param names,
 * so switching cards (`ActivityTabs`) never has to fetch anything and never
 * navigates. See that component's header comment for the one subtlety this
 * buys: the visible tab can drift from `?tab=` between navigations, so every
 * link a report box builds restates its own tab rather than trusting the URL.
 *
 * PARAM NAMES, ONE PER REPORT, NONE SHARED:
 *   Rep Activity          start / end                  (unique already)
 *   Call Activity         callFrom / callTo / callMember / callInstitute /
 *                         callStatus / callSort / callDir / callPage
 *                         (unique already — /review's own convention)
 *   Pipeline by Rep       pipeFrom / pipeTo / pipeSort / pipeDir
 *                         (prefixed here — see pipeline-box.tsx)
 *   Institute-Wise        from / to / sort / dir / page / member / campus / q
 *                         (bare, unchanged — see institute-activity-box.tsx)
 *
 * Admin-only: this consolidated tab is a new admin-only surface, which is
 * why it gates with `requireAdmin()` rather than `requireStaff()` and is
 * added only to `ADMIN_NAV`. The reports that keep a standalone screen
 * (`/team/report`, `/institutes/report`, `/institutes?view=activity`) keep
 * their existing staff gate unchanged.
 */
export default async function ActivityPage(props: PageProps<"/activity">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Activity" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const searchParams = await props.searchParams;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    const v = first(value);
    if (v) flat[key] = v;
  }

  const rawTab = first(searchParams.tab);
  const initialTab: ActivityTabKey = isActivityTabKey(rawTab)
    ? rawTab
    : DEFAULT_ACTIVITY_TAB;

  /** Everything on the URL except the keys named, as a fresh object. */
  function without(...keys: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(flat)) {
      if (!keys.includes(key)) result[key] = value;
    }
    return result;
  }

  // Rep Activity — bare start/end, exactly like /team/report.
  const repParsed = exportRangeSchema.safeParse({
    start: first(searchParams.start),
    end: first(searchParams.end),
  });
  const repRange = repParsed.success
    ? { start: repParsed.data.start, end: repParsed.data.end }
    : { start: first(searchParams.start) ?? "", end: first(searchParams.end) ?? "" };

  // Call Activity — its own callFrom/callTo/... vocabulary, exactly like the
  // Call Activity Report section on /review.
  const callSort = parseCallActivitySort(
    first(searchParams.callSort),
    first(searchParams.callDir),
  );
  const callPage = Number.parseInt(first(searchParams.callPage) ?? "1", 10);

  // Pipeline by Rep — prefixed pipeFrom/pipeTo/pipeSort/pipeDir.
  const pipelineParsed = pipelineRangeSchema.safeParse({
    from: first(searchParams.pipeFrom),
    to: first(searchParams.pipeTo),
  });

  // Institute-Wise Activity — bare from/to/sort/dir/page/member/campus/q,
  // exactly like /institutes?view=activity.
  const instituteParsed = pipelineRangeSchema.safeParse({
    from: first(searchParams.from),
    to: first(searchParams.to),
  });
  const instituteRangeError = !instituteParsed.success
    ? instituteParsed.error.issues[0]?.message ??
      "That date range is not one we can report on."
    : null;
  const instituteRange = instituteParsed.success ? instituteParsed.data : {};
  const rawInstituteSort = first(searchParams.sort);
  const instituteSort = {
    key: isStatusActivitySortKey(rawInstituteSort) ? rawInstituteSort : "institute",
    dir: first(searchParams.dir) === "desc" ? ("desc" as const) : ("asc" as const),
  };

  // The catalogue is read once and reused for both Call Activity's filter
  // validation and its rep-facing status list — asking twice would be the
  // performance mistake review/page.tsx's own comment calls out.
  const [reps, catalogue] = await Promise.all([listReps(), listStatusCatalogue()]);

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

  const [repResult, callResult, pipelineResult, instituteResult] = await Promise.all([
    repParsed.success
      ? getActivityReportModel({ start: repRange.start, end: repRange.end }, null)
      : Promise.resolve({
          ok: false as const,
          error:
            repParsed.error.issues[0]?.message ??
            "That date range is not one we can report on.",
        }),
    getCallActivityReport(callFilters, callSort, callPage),
    pipelineParsed.success
      ? getInstituteStatusModel({
          range: pipelineParsed.data,
          sort: {
            key: first(searchParams.pipeSort),
            dir: first(searchParams.pipeDir),
          },
        })
      : Promise.resolve({
          ok: false as const,
          error:
            pipelineParsed.error.issues[0]?.message ??
            "That date range is not one we can report on.",
        }),
    !instituteRangeError
      ? getInstituteStatusActivityModel({
          range: instituteRange,
          sort: instituteSort,
          page: first(searchParams.page),
          search: first(searchParams.q),
          member: first(searchParams.member),
          campus: first(searchParams.campus),
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Rep Activity, Call Activity, Pipeline by Rep and Institute-Wise Activity, in one place."
      />

      <ActivityTabs
        initialTab={initialTab}
        rep={
          <RepActivityBox
            start={repRange.start}
            end={repRange.end}
            extraParams={{ tab: "rep", ...without("start", "end", "tab") }}
            result={repResult}
          />
        }
        call={
          <CallActivityBox
            reps={reps.map((r) => ({ id: r.id, name: r.name }))}
            statuses={catalogue
              .filter((s) => s.isActive)
              .map((s) => ({ status: s.status, category: s.category }))}
            filters={callFilters}
            sort={callSort}
            notices={callNotices}
            result={callResult}
            flat={flat}
          />
        }
        pipeline={
          <PipelineBox
            range={pipelineParsed.success ? pipelineParsed.data : {}}
            extraParams={{ tab: "pipeline", ...without("pipeFrom", "pipeTo", "tab") }}
            flat={flat}
            result={pipelineResult}
          />
        }
        institute={
          <InstituteActivityBox
            params={flat}
            range={instituteRange}
            rangeError={instituteRangeError}
            extraParams={{
              tab: "institute",
              ...without(
                "from",
                "to",
                "sort",
                "dir",
                "page",
                "member",
                "campus",
                "q",
                "tab",
              ),
            }}
            search={first(searchParams.q)}
            member={first(searchParams.member)}
            campus={first(searchParams.campus)}
            result={instituteResult}
          />
        }
      />
    </>
  );
}
