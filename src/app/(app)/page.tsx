import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { DailyPlan } from "@/components/dashboard/daily-plan";
import { TodaySnapshot } from "@/components/dashboard/today-snapshot";
import { DailyStatusToggle } from "@/components/report/daily-status-toggle";
import { MetricList } from "@/components/weekly/metric-list";
import { AdminOverview } from "@/components/admin/overview";
import { CustomisableGrid } from "@/components/report/customisable-grid";
import { ExportExcel } from "@/components/report/export-excel";
import { RangeControls } from "@/components/report/range-controls";
import { getCurrentUser, isAdmin, isStaff } from "@/lib/auth";
import { countMyInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import { settled } from "@/lib/errors";
import {
  getTodayPlan,
  listFollowUpTasks,
  listInstitutesForPicker,
  listPurposes,
} from "@/lib/visits";
import { listUnseenAlerts } from "@/lib/alerts";
import { getWeekSummary } from "@/lib/week-summary";
import { getMyTodayStatus } from "@/lib/rep-daily-status";
import { formatWeekRange, mondayOf, weekCountEnd } from "@/lib/weeks";
import { todayISO } from "@/lib/dates";
import { getOverview } from "@/lib/admin-workspace";
import { getActivityReportModel } from "@/lib/exports/activity-export";
import { activitySortKeys, pageReps } from "@/lib/exports/activity-grid";
import { exportRangeSchema } from "@/lib/validation/export";
import {
  DEFAULT_PIPELINE_SORT,
  nextSortDirection,
  parsePipelineSort,
} from "@/lib/validation/pipeline-report";

export const metadata = { title: "Dashboard" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

export default async function DashboardPage(props: PageProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  /*
   * `admin` still means exactly "may change what the whole company shares" —
   * the two Go-to shortcuts AdminOverview hides behind it (/data,
   * /materials/manage) stay admin-only for that reason. Every other branch
   * on this page is the admin-shaped SUPERVISION view versus a rep's own day,
   * and a team lead supervises too — so those branch on `staff`, and
   * getOverview()/listTeamVisits()/getActivityReportModel() narrow themselves
   * to `supervises()` via RLS once a lead is the caller.
   */
  const admin = isAdmin(user);
  const staff = isStaff(user);
  const weekStart = mondayOf();
  const searchParams = await props.searchParams;
  const parsedRepRange = staff
    ? exportRangeSchema.safeParse({
        start: first(searchParams.start),
        end: first(searchParams.end),
      })
    : null;
  const repRangeError =
    parsedRepRange && !parsedRepRange.success
      ? (parsedRepRange.error.issues[0]?.message ??
        "That date range is not one we can report on.")
      : null;
  const repRange = parsedRepRange?.success
    ? { start: parsedRepRange.data.start, end: parsedRepRange.data.end }
    : null;

  const otherParams = (omit: readonly string[]) => {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value !== "string" || value === "" || omit.includes(key)) continue;
      kept[key] = value;
    }
    return Object.keys(kept).length > 0 ? kept : undefined;
  };
  const repRangeExtra = otherParams(["start", "end", "repPage"]);
  const resetRepRangeHref = (() => {
    const params = new URLSearchParams(otherParams(["start", "end", "repPage"]));
    const query = params.toString();
    return query ? `/?${query}` : "/";
  })();

  // An admin loads the supervision view; a rep loads their own day. Neither
  // pays for the other's queries.

  /*
   * EVERY FETCH IS WRAPPED, because this is the screen a rep lands on.
   *
   * Each helper below already degrades on a database error. `Promise.all`
   * rejects as a whole the moment ANY of them rejects outright, though — a
   * dropped connection fetching the campus list would take the plan, the
   * institutes and the week's figures down with it and show the error
   * boundary instead of the Dashboard. `settled()` gives each one the same
   * fallback it would have returned for itself, so a rejection now costs one
   * panel rather than the screen.
   *
   * The fallbacks are deliberately the helpers' OWN: `{ ok: false }` is what
   * getTodayPlan answers with, SEED_STATUS_CATALOGUE is what listStatusCatalogue
   * falls back to. Nothing downstream can tell the two routes apart, which is
   * why this needed no change to how the page reads any of it.
   */
  const catalogueRead = settled(
    listStatusCatalogue(),
    SEED_STATUS_CATALOGUE,
    "dashboard:statuses",
  );

  const [
    plan,
    institutes,
    purposes,
    week,
    overview,
    catalogue,
    activityReport,
    tasks,
    alerts,
    totalInstitutes,
    todayStatus,
  ] = await Promise.all([
    staff
      ? Promise.resolve({ ok: true as const, entries: [] })
      : settled(getTodayPlan(user.id), { ok: false as const }, "dashboard:plan"),
    staff
      ? Promise.resolve([])
      : settled(listInstitutesForPicker(), [], "dashboard:institutes"),
    staff ? Promise.resolve([]) : settled(listPurposes(), [], "dashboard:purposes"),
    staff
      ? Promise.resolve(null)
      : settled(getWeekSummary(user.id, weekStart), null, "dashboard:week"),
    staff ? settled(getOverview(), null, "dashboard:overview") : Promise.resolve(null),
    // The status vocabulary. Cheap, and needed by the plan picker to say when an
    // institute is being re-opened after a closed loop.
    catalogueRead,
    staff && repRange
      ? (async () => {
          const loaded = await catalogueRead;
          return settled(
            getActivityReportModel(repRange, null, {
              sort: {
                key: first(searchParams.repSort),
                dir: first(searchParams.repDir),
              },
              catalogue: loaded,
              groupInactiveStatuses: true,
            }),
            null,
            "dashboard:activity-report",
          );
        })()
      : Promise.resolve(null),
    /*
     * A3/A1 — today's follow-ups, from `follow_up_tasks`.
     *
     * `settled()` like every other fetch here, for the reason stated above: one
     * rejection must cost one panel rather than the screen a rep lands on. The
     * fallback is the helper's own `{ ok: false }`, so nothing downstream can
     * tell the two routes apart.
     *
     * `todayISO()` and not `new Date()` — the helper takes "on or before this
     * day", so an overdue call is still in front of the rep this morning.
     *
     * ⚠ NOT FETCHED WHILE PHASE_A_DAILY_PLAN IS OFF. Gating the QUERY as well
     * as the section is not tidiness: this is the screen a rep lands on, and a
     * round trip whose only reader is behind a flag is latency nobody can see
     * the cause of. The empty answer is the one the admin branch already
     * returns, so the component below needs no third case.
     */
    staff
      ? Promise.resolve({ ok: true as const, tasks: [] })
      : settled(
          listFollowUpTasks(user.id, todayISO()),
          { ok: false as const },
          "dashboard:tasks",
        ),
    /*
     * E1 — what the database noticed, for WHOEVER is reading.
     *
     * NOT gated on `!admin`, unlike every fetch above it. The others are a
     * rep's own fieldwork, which an admin does not have; an alert is addressed
     * to a member, and an admin who is sent one (today none of the five
     * predicates selects a non-rep, but that is the function's business and
     * not this page's) should see it. Scoping is RLS's either way: read by
     * `member = auth.uid() or is_admin()`, and this asks for its own id.
     */
    settled(listUnseenAlerts(user.id), { ok: false as const }, "dashboard:alerts"),
    // Rep's own registered-institutes count for the Today snapshot. Not a
    // staff figure — countMyInstitutes() relies on institutes_select already
    // narrowing a rep to their own rows, which is not true for an admin or a
    // team lead.
    staff
      ? Promise.resolve(null)
      : settled(countMyInstitutes(), null, "dashboard:institute-count"),
    /*
     * 0069 — today's declared field status, for the rep's own Dashboard only.
     * Skipped for staff exactly like every other rep-only fetch above: their
     * landing screen is supervision and has nowhere to write this.
     */
    staff
      ? Promise.resolve(null)
      : settled(
          getMyTodayStatus(user.id),
          {
            ok: false as const,
            error: "We could not load today's status just now.",
          },
          "dashboard:daily-status",
        ),
  ]);

  const entries = plan.ok ? plan.entries : [];
  const held = entries.filter((entry) => entry.meetings_actual !== null).length;

  const repActivitySort = activityReport?.ok
    ? parsePipelineSort(
        first(searchParams.repSort),
        first(searchParams.repDir),
        activitySortKeys(activityReport.model.columns),
      )
    : DEFAULT_PIPELINE_SORT;
  const repPageRequested = Number.parseInt(first(searchParams.repPage) ?? "1", 10);
  const repPage = activityReport?.ok
    ? pageReps(activityReport.model.reps, repPageRequested)
    : { reps: [], page: 1, pageCount: 1 };
  const repPageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParams)) {
      if (typeof value !== "string" || value === "" || name === "repPage") continue;
      params.set(name, value);
    }
    if (repRange) {
      params.set("start", repRange.start);
      params.set("end", repRange.end);
    }
    if (page > 1) params.set("repPage", String(page));
    return `/?${params.toString()}`;
  };
  const repSortHrefs: Record<string, string> | undefined =
    activityReport?.ok && repRange
      ? Object.fromEntries(
          activitySortKeys(activityReport.model.columns).map((key) => {
            const dir = nextSortDirection(key, repActivitySort);
            const params = new URLSearchParams();
            for (const [name, value] of Object.entries(searchParams)) {
              if (
                typeof value !== "string" ||
                value === "" ||
                name === "repSort" ||
                name === "repDir" ||
                name === "repPage"
              ) {
                continue;
              }
              params.set(name, value);
            }
            params.set("start", repRange.start);
            params.set("end", repRange.end);
            if (
              key !== DEFAULT_PIPELINE_SORT.key ||
              dir !== DEFAULT_PIPELINE_SORT.dir
            ) {
              params.set("repSort", key);
              params.set("repDir", dir);
            }
            return [key, `/?${params.toString()}`] as const;
          }),
        )
      : undefined;

  return (
    <>
      <PageHeader
        title={staff ? "Overview" : `Hello, ${user.name.split(" ")[0]}`}
        description={
          staff
            ? "What the team has been doing, and what is still open."
            : "Plan today's visits here, then log them as they happen."
        }
      />

      {/* Above everything, because an alert is the reason the rep opened the
          app. A failed read renders nothing rather than an error strip: an
          alert that cannot be loaded is not worth taking a line of the
          dashboard to apologise for, and the work it points at is still on
          the plan below. */}
      {alerts.ok && <AlertBanner alerts={alerts.alerts} />}

      {/* Fieldwork belongs to reps. A staff member's (admin's or team lead's)
          landing screen is supervision: what the team did, who was out, what
          is still open. */}
      {!staff && (
        <>
          {/*
            THE DAILY STATUS CONTROL SITS AT THE VERY TOP OF THE REP DASHBOARD,
            above Today: it is the one thing on this screen a rep DECLARES
            rather than reads, and the day's plan only makes sense after it.
            Staff never reach this branch — their landing screen is supervision
            — so neither a team lead nor an admin is offered a control that
            0069 refuses them.
          */}
          {todayStatus && !todayStatus.ok ? (
            <p className="text-destructive mt-4 text-sm">{todayStatus.error}</p>
          ) : (
            <DailyStatusToggle
              initial={todayStatus?.ok ? todayStatus.today?.status ?? null : null}
            />
          )}

          <SectionTitle>Today</SectionTitle>
          <TodaySnapshot
            planned={entries.length}
            held={held}
            totalInstitutes={totalInstitutes ?? 0}
          />

          {plan.ok ? (
            <DailyPlan
              institutes={institutes}
              purposes={purposes}
              entries={plan.entries}
              catalogue={catalogue}
              // A failed read shows an empty calls section rather than taking
              // the plan down with it — the same degradation every other panel
              // on this screen gets.
              tasks={tasks.ok ? tasks.tasks : []}
            />
          ) : (
            <ErrorState message="We could not load today's plan. Please try again in a moment." />
          )}
        </>
      )}

      {staff ? (
        <>
          {overview?.ok ? (
            /* `todayISO()` read once and shared: the tile's counts and the
               link it opens must agree about which day it is. */
            <AdminOverview
              data={overview.data}
              today={todayISO()}
              weekStart={weekStart}
              weekEnd={weekCountEnd(weekStart)}
              isAdmin={admin}
            />
          ) : (
            <ErrorState message="We could not load the team's activity just now. Please try again in a moment." />
          )}

          {/*
            THE INSTITUTE-WISE TABLE IS NOT HERE ANY MORE. The client asked for
            it to move behind the "Institute Activity" button on the Institutes
            tab, so this page keeps only the aef8213 sections — Today and this
            week, Latest from the team, Out today, Still checked in, Open loops,
            Go to. There was no rep-wise report on this page at aef8213 to keep;
            the old "Pipeline by rep" grid it replaced is gone, not hidden.
          */}
          <div className="mt-8 min-w-0 max-w-full">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <SectionTitle className="mb-0">Rep activity report</SectionTitle>
              {activityReport?.ok && repRange && (
                <ExportExcel
                  start={repRange.start}
                  end={repRange.end}
                  sort={repActivitySort}
                  showActivityStatuses
                  label="Export to Excel"
                />
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              What each rep did over the period, open and closed by activity.
              The individual statuses are in Columns.
            </p>

            {repRangeError ? (
              <>
                <ErrorState message={repRangeError} />
                <Button asChild variant="outline" className="mt-4 h-11">
                  <Link href={resetRepRangeHref}>Back to this month</Link>
                </Button>
              </>
            ) : repRange ? (
              <>
                <RangeControls
                  start={repRange.start}
                  end={repRange.end}
                  basePath="/"
                  idPrefix="rep-activity"
                  extraParams={repRangeExtra}
                  hint="Filters this report by the date the work was logged."
                />
                {activityReport?.ok ? (
                  <>
                    <div className="mt-3">
                      <CustomisableGrid
                        viewKey="overview-activity-report"
                        reps={repPage.reps}
                        /*
                          The footer says "All reps", so it is given all of
                          them even though the body is one page.
                        */
                        totalsReps={activityReport.model.reps}
                        columns={activityReport.model.columns}
                        unsetColumn={activityReport.model.otherStatusColumn}
                        showActivities={false}
                        showActivityStatuses
                        linkReps
                        reviewRange={repRange}
                        sort={repActivitySort}
                        sortHrefs={repSortHrefs}
                        caption={`Activity by rep from ${repRange.start} to ${repRange.end}`}
                      />
                    </div>

                    {/*
                      Links, not buttons, for the reason Review's pager gives:
                      the page lives in the URL, so a pager navigates. Every
                      filter and the sort are preserved, and the pager is
                      hidden on a single page — it would be furniture.
                    */}
                    {repPage.pageCount > 1 && (
                      <nav
                        className="mt-3 flex flex-wrap items-center justify-between gap-3"
                        aria-label="Rep activity report pages"
                      >
                        <Button
                          asChild={repPage.page > 1}
                          variant="outline"
                          className="h-11"
                          disabled={repPage.page <= 1}
                        >
                          {repPage.page > 1 ? (
                            <Link
                              href={repPageHref(repPage.page - 1)}
                              scroll={false}
                            >
                              <ChevronLeftIcon className="size-4" aria-hidden />
                              Previous
                            </Link>
                          ) : (
                            <span>
                              <ChevronLeftIcon className="size-4" aria-hidden />
                              Previous
                            </span>
                          )}
                        </Button>

                        <p
                          className="text-muted-foreground text-xs tabular-nums"
                          aria-live="polite"
                        >
                          Page {repPage.page} of {repPage.pageCount} ·{" "}
                          {activityReport.model.reps.length} reps
                        </p>

                        <Button
                          asChild={repPage.page < repPage.pageCount}
                          variant="outline"
                          className="h-11"
                          disabled={repPage.page >= repPage.pageCount}
                        >
                          {repPage.page < repPage.pageCount ? (
                            <Link
                              href={repPageHref(repPage.page + 1)}
                              scroll={false}
                            >
                              Next
                              <ChevronRightIcon className="size-4" aria-hidden />
                            </Link>
                          ) : (
                            <span>
                              Next
                              <ChevronRightIcon className="size-4" aria-hidden />
                            </span>
                          )}
                        </Button>
                      </nav>
                    )}
                  </>
                ) : (
                  <ErrorState message="We could not load the activity report just now. Please try again in a moment." />
                )}
              </>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <SectionTitle className="mt-8">
            This week
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {formatWeekRange(weekStart)}
            </span>
          </SectionTitle>
          {week?.ok ? (
            <>
              <MetricList
                title="Target vs achieved"
                targets={week.summary.record.targets}
                achieved={week.summary.achieved}
                emptyDescription="Set the eight numbers on the Targets tab, and the bars fill in as you log visits."
                emptyAction={
                  <Button asChild className="h-11">
                    <Link prefetch={false} href="/targets">Set this week&rsquo;s targets</Link>
                  </Button>
                }
              />
              <Button asChild variant="outline" className="mt-3 h-11 w-full">
                <Link prefetch={false} href="/targets">Open Targets</Link>
              </Button>
            </>
          ) : (
            <ErrorState message="We could not load this week's targets. Please try again in a moment." />
          )}
        </>
      )}
    </>
  );
}
