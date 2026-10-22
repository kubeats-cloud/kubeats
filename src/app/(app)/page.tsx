import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheetIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { DailyPlan } from "@/components/dashboard/daily-plan";
import { TodaySnapshot } from "@/components/dashboard/today-snapshot";
import { MetricList } from "@/components/weekly/metric-list";
import { AdminOverview } from "@/components/admin/overview";
import { InstituteActivityTable } from "@/components/report/institute-activity-table";
import { RangeControls } from "@/components/report/range-controls";
import { getCurrentUser, isAdmin } from "@/lib/auth";
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
import { PHASE_A_DAILY_PLAN } from "@/lib/features";
import { getWeekSummary } from "@/lib/week-summary";
import { formatWeekRange, mondayOf, weekCountEnd } from "@/lib/weeks";
import { todayISO } from "@/lib/dates";
import { getOverview } from "@/lib/admin-workspace";
import {
  getInstituteActivityModel,
  DEFAULT_INSTITUTE_ACTIVITY_SORT,
} from "@/lib/institute-activity-report";
import { isInstituteActivitySortKey } from "@/lib/institute-activity-counts";
import { instituteActivityExportHref } from "@/lib/institute-activity-links";
import { pipelineRangeSchema, type PipelineRange } from "@/lib/validation/pipeline-report";

export const metadata = { title: "Dashboard" };

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

export default async function DashboardPage(props: PageProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "team_lead") redirect("/team");

  const admin = isAdmin(user);
  const weekStart = mondayOf();

  /*
   * A1 — the institute-wise Activity Report's own range and sort, read from
   * this page's URL exactly as `/institutes/report` reads its own: optional,
   * no default window, so a quiet pipeline is not hidden behind "this month".
   * Rep branch never reads these.
   */
  const searchParams = await props.searchParams;
  const parsedActivityRange = admin
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
  const activityRange: PipelineRange = parsedActivityRange?.success
    ? parsedActivityRange.data
    : {};
  const activitySortKeyParam = first(searchParams.sort);
  const activitySort = {
    key: isInstituteActivitySortKey(activitySortKeyParam)
      ? activitySortKeyParam
      : DEFAULT_INSTITUTE_ACTIVITY_SORT.key,
    dir: first(searchParams.dir) === "desc" ? ("desc" as const) : ("asc" as const),
  };

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
  const [
    plan,
    institutes,
    purposes,
    week,
    overview,
    catalogue,
    report,
    tasks,
    alerts,
    totalInstitutes,
  ] = await Promise.all([
    admin
      ? Promise.resolve({ ok: true as const, entries: [] })
      : settled(getTodayPlan(user.id), { ok: false as const }, "dashboard:plan"),
    admin
      ? Promise.resolve([])
      : settled(listInstitutesForPicker(), [], "dashboard:institutes"),
    admin ? Promise.resolve([]) : settled(listPurposes(), [], "dashboard:purposes"),
    admin
      ? Promise.resolve(null)
      : settled(getWeekSummary(user.id, weekStart), null, "dashboard:week"),
    admin ? settled(getOverview(), null, "dashboard:overview") : Promise.resolve(null),
    // The status vocabulary. Cheap, and needed by the plan picker to say when an
    // institute is being re-opened after a closed loop.
    settled(listStatusCatalogue(), SEED_STATUS_CATALOGUE, "dashboard:statuses"),
    admin && !activityRangeError
      ? settled(
          getInstituteActivityModel({ range: activityRange, sort: activitySort }),
          null,
          "dashboard:report",
        )
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
    admin
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
    // Rep's own registered-institutes count for the Today snapshot. Not an
    // admin figure — countMyInstitutes() relies on institutes_select already
    // narrowing a rep to their own rows, which is not true for an admin.
    admin
      ? Promise.resolve(null)
      : settled(countMyInstitutes(), null, "dashboard:institute-count"),
  ]);

  const entries = plan.ok ? plan.entries : [];
  const held = entries.filter((entry) => entry.meetings_actual !== null).length;

  return (
    <>
      <PageHeader
        title={admin ? "Overview" : `Hello, ${user.name.split(" ")[0]}`}
        description={
          admin
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

      {/* Fieldwork belongs to reps. An admin's landing screen is supervision:
          what the team did, who was out, what is still open. */}
      {!admin && (
        <>
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

      {admin ? (
        <>
          {overview?.ok ? (
            /* `todayISO()` read once and shared: the tile's counts and the
               link it opens must agree about which day it is. */
            <AdminOverview
              data={overview.data}
              today={todayISO()}
              weekStart={weekStart}
              weekEnd={weekCountEnd(weekStart)}
            />
          ) : (
            <ErrorState message="We could not load the team's activity just now. Please try again in a moment." />
          )}

          {/* A1 — the institute-wise Activity Report, in the place the old
              rep-wise "Pipeline by rep" / "Activity this month" grid used to
              sit. One table, not a compact preview with a link elsewhere:
              the date filter, the column sorting and the Excel download are
              all live right here, reusing the exact model and table
              `/institutes/report` renders — `basePath="/"` is the only thing
              that differs, so a sort click stays on the dashboard. */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle className="mb-0">Activity report</SectionTitle>
            {report?.ok && (
              <Button asChild variant="outline" className="h-11">
                <a
                  href={instituteActivityExportHref({
                    range: report.model.range,
                    sortKey: report.model.sort.key,
                    sortDir: report.model.sort.dir,
                  })}
                  download
                >
                  <FileSpreadsheetIcon className="size-4" aria-hidden />
                  Download Excel
                </a>
              </Button>
            )}
          </div>

          <RangeControls
            start={activityRange.from ?? ""}
            end={activityRange.to ?? ""}
            basePath="/"
            optional
            extraParams={
              report?.ok &&
              (report.model.sort.key !== DEFAULT_INSTITUTE_ACTIVITY_SORT.key ||
                report.model.sort.dir !== DEFAULT_INSTITUTE_ACTIVITY_SORT.dir)
                ? { sort: report.model.sort.key, dir: report.model.sort.dir }
                : undefined
            }
            hint="Filters by the date the work was logged. Leave both blank for all time."
          />

          {activityRangeError ? (
            <ErrorState message={activityRangeError} />
          ) : report?.ok ? (
            <div className="mt-3">
              <InstituteActivityTable
                rows={report.model.rows}
                sort={report.model.sort}
                range={report.model.range}
                basePath="/"
                caption="Institute-wise activity, Open and Closed by type"
              />
            </div>
          ) : (
            <ErrorState message="We could not load the activity report just now. Please try again in a moment." />
          )}
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
                    <Link href="/targets">Set this week&rsquo;s targets</Link>
                  </Button>
                }
              />
              <Button asChild variant="outline" className="mt-3 h-11 w-full">
                <Link href="/targets">Open Targets</Link>
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
