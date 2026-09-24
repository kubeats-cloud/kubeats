import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, NetworkIcon, SlidersHorizontalIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SectionTitle } from "@/components/section-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";
import { MetricList } from "@/components/weekly/metric-list";
import { ActivitySummary } from "@/components/report/activity-summary";
import { PeriodControls } from "@/components/weekly/period-controls";
import { OpenCheckIns } from "@/components/admin/open-checkins";
import { FollowUpList } from "@/components/visits/follow-up-list";
import {
  PipelineCard,
  RecentVisits,
  TheirInstitutes,
  TodayCard,
} from "@/components/team/member-hub";
import { RepSwitcher } from "@/components/team/rep-switcher";
import { requireAdmin } from "@/lib/admin";
import { listTeamMembers } from "@/lib/admin";
import { listOpenCheckIns, listTeamVisits } from "@/lib/admin-workspace";
import { listReps } from "@/lib/closing-report";
import { getActivityReport } from "@/lib/activity-report";
import { getWeekSummary, memberName } from "@/lib/week-summary";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { getOpenFollowUps } from "@/lib/visits";
import { getMemberToday, pipelineOf } from "@/lib/team-hub";
import { settled } from "@/lib/errors";
import { SEED_STATUS_CATALOGUE } from "@/lib/validation/institute";
import { formatWeekRange, normaliseWeekParam } from "@/lib/weeks";
import {
  REPORT_PERIODS,
  isReportPeriod,
  normalisePeriodStart,
  type ReportPeriod,
} from "@/lib/periods";

/**
 * The tab says WHO, not WHAT.
 *
 * A static "Team member" made every open hub indistinguishable in a browser's
 * tab strip and in history — which is exactly the situation an admin comparing
 * two reps ends up in. `memberName()` is a single-column lookup and the same
 * one /report uses for its header, so this adds one cheap query and no new
 * definition of anything.
 *
 * `requireAdmin()` is NOT repeated here. Metadata for a page a rep cannot reach
 * is never rendered — proxy.ts 307s them off the /team subtree first — and a
 * name is not a secret from someone who has the whole roster on /team anyway.
 * The fallback covers a member who does not exist, whose page will `notFound()`
 * a moment later.
 */
export async function generateMetadata(
  props: PageProps<"/team/[memberId]">,
): Promise<Metadata> {
  const { memberId } = await props.params;
  const name = await memberName(memberId);
  return { title: name ?? "Team member" };
}

const first = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

/** How many rows the two "and here is a link to the rest" lists show. */
const RECENT_VISITS = 10;
const INSTITUTES_SHOWN = 8;

/**
 * EVERYTHING ABOUT ONE REP, IN ONE PLACE.
 *
 * The problem this solves is tab-hopping: an admin asking "how is Priya doing"
 * had to read /team for her week, /report for her activity, /review for her
 * visits, /institutes for her pipeline and /pending for what she owes — five
 * screens, each filtered by hand, none of them linking to the next.
 *
 * SO IT COMPOSES; IT DOES NOT REBUILD. Every block below is an existing helper
 * and an existing component pointed at one member. `MetricList` is the Targets
 * screen's, `ActivitySummary` is /report's, `FollowUpList` and `OpenCheckIns`
 * are Pending's and the Overview's. Two small pieces had nowhere to come from
 * and live in `team-hub.ts`; nothing else here counts anything.
 *
 * That matters beyond tidiness: a hub that recomputed the week would be a
 * second answer to a question /targets already answers, and the two would
 * disagree the first time either changed. The rule is that this screen is a
 * VIEW and never a source.
 *
 * WHERE IT STOPS. It shows a slice of the two long lists — the last ten visits,
 * the first few institutes — and links to the screens that own the full
 * versions, pre-filtered. Review owns the register; /institutes owns the
 * registry; /targets owns the lock and the reopen. Pulling any of those in
 * whole would mean rebuilding their filtering here, which is the restructure
 * this work is explicitly not.
 *
 * GATING, THREE LAYERS. `/team` is in `ADMIN_ONLY_PATHS` and `matches()` is
 * prefix-based, so `proxy.ts` already turns a rep away from this subtree with a
 * 307 before the page runs — no new entry in nav.ts was needed, and adding one
 * to `ADMIN_ONLY_PATTERNS` would have been the wrong mechanism, which exists
 * only for admin leaves hanging off SHARED routes like /institutes/[id]/edit.
 * `requireAdmin()` below is the second layer, and RLS under every query is the
 * third and the one that actually decides which rows come back.
 */
export default async function MemberHubPage(props: PageProps<"/team/[memberId]">) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return (
      <>
        <PageHeader title="Team member" />
        <ErrorState message={gate.error} />
      </>
    );
  }

  const { memberId } = await props.params;
  const searchParams = await props.searchParams;

  const periodParam = first(searchParams.period);
  const period: ReportPeriod = isReportPeriod(periodParam) ? periodParam : "monthly";
  const periodStart = normalisePeriodStart(period, first(searchParams.start));

  /*
   * THE WEEK COMES FROM THE URL, defaulting to this one.
   *
   * /team has a week navigator, and an admin reading a past week who taps a
   * name is still asking about THAT week — landing them on the current one
   * silently answers a question they did not ask. `normaliseWeekParam()` is
   * the same helper /team itself uses, so a malformed or absent value falls
   * back to this week identically on both screens.
   */
  const weekStart = normaliseWeekParam(first(searchParams.week));

  /*
   * THE MEMBER IS RESOLVED FROM THE TEAM LIST, not from a lookup of their own.
   *
   * `listTeamMembers()` is what Settings already reads, so the name, role and
   * campus on this page are the same values the roster shows — and it carries
   * `ownedInstitutes`, which would otherwise be a second query.
   *
   * It is also the query with the scar: a self-embed on `profiles` once made it
   * return [] for every admin screen at once, silently, against a table with
   * every row intact. A `notFound()` here is therefore genuinely ambiguous —
   * "no such member" and "the roster failed to load" look identical — which is
   * why the failure is separated out below rather than folded into it.
   */
  const team = await settled(listTeamMembers(), [], "team-hub:members");
  if (team.length === 0) {
    return (
      <>
        <PageHeader title="Team member" />
        <ErrorState message="We could not load the team just now. Please try again in a moment." />
      </>
    );
  }

  const member = team.find((entry) => entry.id === memberId);
  if (!member) notFound();

  /*
   * EVERY READ IS WRAPPED, for the reason the Dashboard states: `Promise.all`
   * rejects as a whole the moment any one of them rejects outright, so a
   * dropped connection fetching the follow-ups would take the week, the
   * activity and the register down with it and show the error boundary instead
   * of the hub. Each fallback is the helper's OWN, so nothing downstream can
   * tell the two routes apart.
   */
  const [catalogue, week, report, visits, registry, today, openCheckIns, reps] =
    await Promise.all([
      settled(listStatusCatalogue(), SEED_STATUS_CATALOGUE, "team-hub:statuses"),
      settled(getWeekSummary(memberId, weekStart), { ok: false as const }, "team-hub:week"),
      settled(
        getActivityReport(memberId, member.name, period, periodStart),
        { ok: false as const },
        "team-hub:activity",
      ),
      settled(listTeamVisits({ member: memberId }), { ok: false as const }, "team-hub:visits"),
      settled(listInstitutes(), { ok: false as const }, "team-hub:institutes"),
      settled(getMemberToday(memberId), { planned: 0, visited: 0, institutes: 0 }, "team-hub:today"),
      settled(listOpenCheckIns(memberId), [], "team-hub:checkins"),
      /* Reps only — `listReps()` filters `role = 'rep'`, so the switcher
         cannot offer an admin whose hub would have nothing on it. */
      settled(listReps(), [], "team-hub:reps"),
    ]);

  /*
   * THEIR institutes — `registered_by`, filtered here rather than in the query.
   *
   * `listInstitutes()` runs in an admin's scope, where `institutes_select`
   * returns every campus, so the whole registry is already in hand and a second
   * scoped read would be a round trip to learn something we have. It is also
   * what lets the pipeline below be counted from the very array the list
   * prints, which is what stops the two disagreeing.
   */
  const theirInstitutes = registry.ok
    ? registry.institutes.filter((institute) => institute.registered_by === memberId)
    : [];
  const pipeline = pipelineOf(theirInstitutes, catalogue);

  /*
   * Follow-ups owed, scoped to the institutes this rep OWNS rather than to the
   * visits they logged.
   *
   * `FollowUp.owner` is `institutes.registered_by`; `FollowUp.member` is
   * whoever logged the visit that left the status open. They part company on a
   * reassignment — the old owner's visit still explains the status, and the new
   * owner is the only rep who can act on it. "What does this rep owe" is the
   * second question, so `owner` is the right key.
   */
  const openStatuses = catalogue
    .filter((row) => row.category === "open")
    .map((row) => row.status);

  const followUps = await settled(
    getOpenFollowUps(openStatuses, gate.user.id),
    { ok: false as const },
    "team-hub:follow-ups",
  );
  const theirFollowUps = followUps.ok
    ? followUps.items.filter((item) => item.owner === memberId)
    : [];

  const recent = visits.ok ? visits.visits.slice(0, RECENT_VISITS) : [];
  const totalVisits = visits.ok ? visits.total : 0;

  return (
    <>
      <PageHeader
        eyebrow="Team member"
        title={member.name}
        description={
          member.campusName
            ? `${member.role === "admin" ? "Admin" : "Field rep"} · ${member.campusName}`
            : member.role === "admin"
              ? "Admin · every campus"
              : "Field rep · no campus set"
        }
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/team">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Team
            </Link>
          </Button>
        }
      />

      {/*
        SWITCH REP, then the links out.

        The switcher carries the CURRENT query string across, so an admin
        comparing two people over the same month stays in that month rather
        than being dropped back to the default on every switch.
      */}
      {reps.length > 1 && (
        <div className="mb-4">
          <RepSwitcher
            reps={reps.map((rep) => ({ value: rep.id, label: rep.name }))}
            current={memberId}
            search={new URLSearchParams(
              Object.entries(searchParams).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value] as [string, string]] : [],
              ),
            ).toString()}
          />
        </div>
      )}

      {/* Links OUT to the screens that own what they own. /targets is where a
          locked week is reopened — a second reopen control here would be a
          second writer in front of `enforce_target_lock`. */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11">
          <Link href={`/targets?week=${weekStart}&member=${memberId}`}>
            <SlidersHorizontalIcon className="size-4" aria-hidden />
            Targets &amp; lock
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/review?member=${memberId}`}>Every visit in Review</Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link href="/team/hierarchy">
            <NetworkIcon className="size-4" aria-hidden />
            Hierarchy
          </Link>
        </Button>
      </div>

      <SectionTitle>Today</SectionTitle>
      <TodayCard today={today} />

      {/* Only when there is something to say. An empty "Still checked in" panel
          on a page this long is a row of furniture. One open visit stops a rep
          working anywhere else, so when there IS one it is worth the space. */}
      {openCheckIns.length > 0 && (
        <>
          <SectionTitle className="mt-8">
            Still checked in
            {openCheckIns.some((visit) => visit.stale) && (
              <Badge variant="danger" className="ml-2">
                stuck
              </Badge>
            )}
          </SectionTitle>
          <OpenCheckIns visits={openCheckIns} />
        </>
      )}

      <SectionTitle className="mt-8">
        This week
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {formatWeekRange(weekStart)}
        </span>
      </SectionTitle>
      {week.ok ? (
        <MetricList
          title="Target vs achieved"
          targets={week.summary.record.targets}
          achieved={week.summary.achieved}
          emptyDescription="This rep has not set targets for this week. Their counts still appear here as they log visits."
        />
      ) : (
        <ErrorState message="We could not load this rep's week just now. Please try again in a moment." />
      )}

      <SectionTitle className="mt-8">
        Their pipeline
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          institutes they registered
        </span>
      </SectionTitle>
      {registry.ok ? (
        <PipelineCard pipeline={pipeline} catalogue={catalogue} />
      ) : (
        <ErrorState message="We could not load the registry just now. Please try again in a moment." />
      )}

      {registry.ok && theirInstitutes.length > 0 && (
        <div className="mt-4">
          <TheirInstitutes
            institutes={theirInstitutes}
            catalogue={catalogue}
            shown={INSTITUTES_SHOWN}
          />
          {theirInstitutes.length > INSTITUTES_SHOWN && (
            <Button asChild variant="outline" className="mt-3 h-11 w-full">
              <Link href="/institutes">
                See all {theirInstitutes.length} institutes
              </Link>
            </Button>
          )}
        </div>
      )}

      <SectionTitle className="mt-8">
        Follow-ups owed
        {theirFollowUps.length > 0 && (
          <Badge variant="warning" className="ml-2">
            {theirFollowUps.length}
          </Badge>
        )}
      </SectionTitle>
      {followUps.ok ? (
        <FollowUpList
          items={theirFollowUps}
          /* Empty, and `readOnly`: an admin cannot start a field visit, and
             `startFollowUp()` refuses them itself rather than trusting a view. */
          purposes={[]}
          catalogue={catalogue}
          readOnly
        />
      ) : (
        <ErrorState message="We could not load what is still owed. Please try again in a moment." />
      )}

      <SectionTitle
        className="mt-8"
        action={
          totalVisits > recent.length ? (
            <Button asChild variant="outline" className="h-9">
              <Link href={`/review?member=${memberId}`}>See all {totalVisits}</Link>
            </Button>
          ) : undefined
        }
      >
        Recent visits
      </SectionTitle>
      {visits.ok ? (
        <RecentVisits visits={recent} />
      ) : (
        <ErrorState message="We could not load this rep's visits just now. Please try again in a moment." />
      )}

      <SectionTitle className="mt-8">Activity</SectionTitle>
      {/* The member is in the PATH here, not in a query param, so no `member`
          prop: these links stay on /team/[memberId] and only move the period. */}
      <PeriodControls
        period={period}
        periodStart={periodStart}
        options={REPORT_PERIODS}
        basePath={`/team/${memberId}`}
      />
      {report.ok ? (
        <ActivitySummary report={{ ...report.report, memberName: member.name }} />
      ) : (
        <ErrorState message="We could not load this rep's activity report. Please try again in a moment." />
      )}
    </>
  );
}
