import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { periodRange, type Period } from "@/lib/periods";
import { ACTIVITIES, activityLabelFor } from "@/lib/validation/visit";
import { TYPE_LABELS, type InstituteType } from "@/lib/validation/institute";

/**
 * One rep's field activity, aggregated.
 *
 * This reads the same tables /review reads and adds nothing to them. The
 * difference is the question: /review lists individual visits so an admin can
 * read one, this counts them so management can see a pattern. Keeping them
 * apart is deliberate — a list that also tried to be a summary would page at
 * fifty rows and quietly under-report every total.
 *
 * Everything is scoped by RLS, which is what actually decides whose rows come
 * back: a rep's queries return only their own visits, an admin's return the
 * team's. The member filter is for correctness of the answer, not for security.
 *
 * COUNTED BY `date`, the day the work was logged, exactly as Rule 7 counts the
 * weekly figures — so the report and the Targets screen can never disagree
 * about which period a visit falls in.
 */

export interface ActivityCount {
  key: string;
  label: string;
  visits: number;
}

export interface InstituteVisits {
  id: string;
  name: string;
  type: InstituteType | null;
  typeLabel: string;
  visits: number;
  lastVisit: string;
}

export interface PeriodBucket {
  /** "2026-09" for a month, "2026" for a year. */
  key: string;
  label: string;
  visits: number;
}

export interface ActivityReport {
  memberId: string;
  memberName: string;
  range: { start: string; end: string };

  totalVisits: number;
  institutesCovered: number;
  /** Rule 7's meetings figure: plan entries actually held, not visit rows. */
  meetingsHeld: number;

  /**
   * Rule 3's open loops. A session or campus visit logged as "Set" is pending
   * until it is closed as "Done"; every other activity is a one-shot and counts
   * as completed the moment it is logged.
   */
  completed: number;
  pending: number;

  /** Whether a closing report has been filed, which is a different axis. */
  reported: number;
  unreported: number;

  byActivity: ActivityCount[];
  byInstitute: InstituteVisits[];

  /** Every month of the year containing the selected period. */
  byMonth: PeriodBucket[];
  /** Every year this rep has logged anything in, oldest first. */
  byYear: PeriodBucket[];
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A visit as the aggregation selects it. */
interface RawVisit {
  date: string;
  activity: string;
  lifecycle_status: string | null;
  reported_at: string | null;
  institute_id: string;
  institutes: { name: string | null; type: string | null } | null;
}

/**
 * Rule 3: only a session or a campus visit can be pending, and only while it
 * says "Set". Written as a predicate rather than inline so the report and any
 * later screen answer it the same way.
 */
function isPending(visit: { lifecycle_status: string | null }): boolean {
  return visit.lifecycle_status === "Set";
}

export async function getActivityReport(
  memberId: string,
  memberName: string,
  period: Period,
  periodStart: string,
): Promise<{ ok: true; report: ActivityReport } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange(period, periodStart);
  const year = periodStart.slice(0, 4);

  const [inRange, plansHeld, yearVisits, allVisits] = await Promise.all([
    // The selected period, with everything the breakdowns need.
    supabase
      .from("visits")
      .select(
        "date, activity, lifecycle_status, reported_at, institute_id, institutes(name, type)",
      )
      .eq("member", memberId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: false }),
    // Rule 7's meetings half, which never comes from the visits log.
    supabase
      .from("daily_plans")
      .select("id", { count: "exact", head: true })
      .eq("member", memberId)
      .eq("meetings_actual", 1)
      .gte("date", start)
      .lte("date", end),
    // The month-by-month rollup across the selected year. Only the date is
    // needed, so this stays cheap however many visits there are.
    supabase
      .from("visits")
      .select("date")
      .eq("member", memberId)
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`),
    // The year-by-year rollup, over everything this rep has ever logged.
    supabase.from("visits").select("date").eq("member", memberId),
  ]);

  for (const [context, result] of [
    ["report:in-range", inRange],
    ["report:plans", plansHeld],
    ["report:year", yearVisits],
    ["report:all", allVisits],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false };
    }
  }

  const visits = (inRange.data ?? []) as unknown as RawVisit[];

  // --- activity breakdown, in the app's own activity order -------------------
  const activityCounts = new Map<string, number>();
  for (const visit of visits) {
    activityCounts.set(visit.activity, (activityCounts.get(visit.activity) ?? 0) + 1);
  }
  const byActivity: ActivityCount[] = ACTIVITIES.map((a) => ({
    key: a.key,
    label: a.label,
    visits: activityCounts.get(a.key) ?? 0,
  }));

  // --- per institute --------------------------------------------------------
  const institutes = new Map<string, InstituteVisits>();
  for (const visit of visits) {
    const existing = institutes.get(visit.institute_id);
    if (existing) {
      existing.visits += 1;
      // Rows arrive newest first, so the first date seen is the latest.
      if (visit.date > existing.lastVisit) existing.lastVisit = visit.date;
    } else {
      const type = (visit.institutes?.type ?? null) as InstituteType | null;
      institutes.set(visit.institute_id, {
        id: visit.institute_id,
        name: visit.institutes?.name ?? "Unknown institute",
        type,
        typeLabel: type ? TYPE_LABELS[type] : "Other",
        visits: 1,
        lastVisit: visit.date,
      });
    }
  }
  const byInstitute = [...institutes.values()].sort(
    (a, b) => b.visits - a.visits || a.name.localeCompare(b.name),
  );

  // --- month and year rollups ----------------------------------------------
  const monthCounts = new Map<string, number>();
  for (const row of yearVisits.data ?? []) {
    const key = row.date.slice(0, 7);
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }
  const byMonth: PeriodBucket[] = MONTH_LABELS.map((label, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { key, label, visits: monthCounts.get(key) ?? 0 };
  });

  const yearCounts = new Map<string, number>();
  for (const row of allVisits.data ?? []) {
    const key = row.date.slice(0, 4);
    yearCounts.set(key, (yearCounts.get(key) ?? 0) + 1);
  }
  const byYear: PeriodBucket[] = [...yearCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, visits]) => ({ key, label: key, visits }));

  const pending = visits.filter(isPending).length;
  const reported = visits.filter((v) => v.reported_at !== null).length;

  return {
    ok: true,
    report: {
      memberId,
      memberName,
      range: { start, end },
      totalVisits: visits.length,
      institutesCovered: institutes.size,
      meetingsHeld: plansHeld.count ?? 0,
      completed: visits.length - pending,
      pending,
      reported,
      unreported: visits.length - reported,
      byActivity,
      byInstitute,
      byMonth,
      byYear,
    },
  };
}

/** Re-exported so a caller does not need to reach into the visit vocabulary. */
export { activityLabelFor };
