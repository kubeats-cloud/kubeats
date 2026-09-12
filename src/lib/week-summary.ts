import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { periodRange } from "@/lib/periods";
import {
  METRIC_KEYS,
  ZERO_COUNTS,
  tallyVisitMetrics,
  type MetricCounts,
  type TallyableVisit,
} from "@/lib/validation/weekly";

/**
 * A rep's week: what they committed to, and what they actually did.
 *
 * This file was targets.ts, answered both questions, and was cut down to the
 * second one by stage 2 of the redesign. The client's spec put the weekly
 * commitment back, so the `public.targets` read is back with it and the table
 * is live again rather than dormant. The name stays week-summary.ts — the
 * screen is a week either way, and renaming a file back and forth buys nobody
 * anything.
 *
 * WEEKLY, AND ONLY WEEKLY. `public.targets` is keyed by (member, period,
 * period_start) and its CHECK still accepts 'daily' and 'monthly'; every query
 * here pins period = 'weekly'. Rows committed to a day or a month before stage
 * 2 therefore stay exactly where they are, readable and untouched, and are
 * simply not what this screen is about. Offering a period again is a form
 * control plus a filter, not a migration.
 *
 * RULE 7 IS UNCHANGED, AND IT IS THE PART THAT MATTERS. Meetings are counted
 * from `daily_plans` where `meetings_actual = 1`, never from the visits log;
 * the other seven metrics are counted from `visits`. Both are counted by
 * `date`, the day the work was logged, over the range periods.ts gives for the
 * week — including its deliberate Sunday end, so a Sunday's work still folds
 * into the week that just ended instead of falling out of every total.
 *
 * Every read is scoped by RLS: a rep's queries return only their own rows, an
 * admin's return the team's. The member filters below are for correctness of
 * the answer, not for security.
 */

/** One week's commitment. `id` is null when no row exists yet. */
export interface WeekTargets {
  id: string | null;
  member: string;
  week_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
  targets: MetricCounts;
}

export interface WeekSummary {
  member: string;
  weekStart: string;
  /** Rule 6's row: the promise, and whether it has been locked. */
  record: WeekTargets;
  /** Rule 7's eight counts for the week. Never null: a quiet week is zeroes. */
  achieved: MetricCounts;
}

/** A week with no row yet: nothing committed, nothing locked. */
function emptyRecord(member: string, weekStart: string): WeekTargets {
  return {
    id: null,
    member,
    week_start: weekStart,
    locked: false,
    submitted_at: null,
    reopened_at: null,
    targets: { ...ZERO_COUNTS },
  };
}

// Built from METRIC_KEYS so the column list cannot drift from the metrics.
// supabase-js can only infer a row type from a literal select string, so the
// rows come back untyped and `toRecord` below checks each field itself.
const ROW_COLUMNS = `id, member, period_start, locked, submitted_at, reopened_at, ${METRIC_KEYS.join(", ")}`;

type RawRow = Record<string, unknown> & {
  id: string;
  member: string;
  period_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
};

function toRecord(row: RawRow): WeekTargets {
  const targets = { ...ZERO_COUNTS };
  for (const key of METRIC_KEYS) {
    const value = row[key];
    targets[key] = typeof value === "number" ? value : 0;
  }
  return {
    id: row.id,
    member: row.member,
    week_start: row.period_start,
    locked: row.locked,
    submitted_at: row.submitted_at,
    reopened_at: row.reopened_at,
    targets,
  };
}

/**
 * Rule 7 in one place: the visits log fills in seven metrics, and the daily
 * plan fills in the eighth. Meetings are overwritten rather than tallied
 * because tallyVisitMetrics() deliberately refuses to count them.
 */
function achievedFrom(visits: TallyableVisit[], meetingsHeld: number): MetricCounts {
  const achieved = tallyVisitMetrics(visits);
  achieved.meetings = meetingsHeld;
  return achieved;
}

/** True when nothing at all was recorded — the empty state, not an error. */
export function isQuietWeek(achieved: MetricCounts): boolean {
  return Object.values(achieved).every((n) => n === 0);
}

/* ------------------------------------------------------------------ */
/* One member                                                          */
/* ------------------------------------------------------------------ */

export async function getWeekSummary(
  memberId: string,
  weekStart: string,
): Promise<{ ok: true; summary: WeekSummary } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange("weekly", weekStart);

  const [targetsResult, plansResult, visitsResult] = await Promise.all([
    supabase
      .from("targets")
      .select(ROW_COLUMNS)
      .eq("member", memberId)
      .eq("period", "weekly")
      .eq("period_start", weekStart)
      .maybeSingle(),
    // Rule 7: the Meetings figure is the count of plan entries actually held.
    supabase
      .from("daily_plans")
      .select("id", { count: "exact", head: true })
      .eq("member", memberId)
      .eq("meetings_actual", 1)
      .gte("date", start)
      .lte("date", end),
    supabase
      .from("visits")
      .select("member, activity, lifecycle_status")
      .eq("member", memberId)
      .gte("date", start)
      .lte("date", end),
  ]);

  if (targetsResult.error) {
    logError("week-summary:targets", targetsResult.error);
    return { ok: false };
  }
  if (plansResult.error) {
    logError("week-summary:meetings", plansResult.error);
    return { ok: false };
  }
  if (visitsResult.error) {
    logError("week-summary:visits", visitsResult.error);
    return { ok: false };
  }

  return {
    ok: true,
    summary: {
      member: memberId,
      weekStart,
      record: targetsResult.data
        ? toRecord(targetsResult.data as unknown as RawRow)
        : emptyRecord(memberId, weekStart),
      achieved: achievedFrom(
        (visitsResult.data ?? []) as TallyableVisit[],
        plansResult.count ?? 0,
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/* The whole team                                                      */
/* ------------------------------------------------------------------ */

export interface TeamMemberWeek {
  member: string;
  name: string;
  role: string;
  record: WeekTargets;
  achieved: MetricCounts;
}

/**
 * Every member's week in four queries rather than four per member.
 *
 * Only an admin's RLS scope returns other people's rows, so this is safe to
 * call from an admin surface; a rep calling it would simply see themselves.
 */
export async function getTeamWeek(
  weekStart: string,
): Promise<{ ok: true; members: TeamMemberWeek[] } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange("weekly", weekStart);

  const [profilesResult, targetsResult, plansResult, visitsResult] =
    await Promise.all([
      supabase.from("profiles").select("id, name, role").order("name"),
      supabase
        .from("targets")
        .select(ROW_COLUMNS)
        .eq("period", "weekly")
        .eq("period_start", weekStart),
      supabase
        .from("daily_plans")
        .select("member")
        .eq("meetings_actual", 1)
        .gte("date", start)
        .lte("date", end),
      supabase
        .from("visits")
        .select("member, activity, lifecycle_status")
        .gte("date", start)
        .lte("date", end),
    ]);

  for (const [context, result] of [
    ["week-summary:team-profiles", profilesResult],
    ["week-summary:team-targets", targetsResult],
    ["week-summary:team-meetings", plansResult],
    ["week-summary:team-visits", visitsResult],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false };
    }
  }

  const records = new Map<string, WeekTargets>();
  for (const row of (targetsResult.data ?? []) as unknown as RawRow[]) {
    records.set(row.member, toRecord(row));
  }

  const heldByMember = new Map<string, number>();
  for (const row of plansResult.data ?? []) {
    heldByMember.set(row.member, (heldByMember.get(row.member) ?? 0) + 1);
  }

  const visitsByMember = new Map<string, TallyableVisit[]>();
  for (const row of (visitsResult.data ?? []) as (TallyableVisit & {
    member: string;
  })[]) {
    const list = visitsByMember.get(row.member);
    if (list) list.push(row);
    else visitsByMember.set(row.member, [row]);
  }

  const members = (profilesResult.data ?? []).map((profile) => ({
    member: profile.id,
    name: profile.name ?? "Unnamed member",
    role: profile.role as string,
    record: records.get(profile.id) ?? emptyRecord(profile.id, weekStart),
    achieved: achievedFrom(
      visitsByMember.get(profile.id) ?? [],
      heldByMember.get(profile.id) ?? 0,
    ),
  }));

  return { ok: true, members };
}

/** A member's display name, for the admin drill-in header. */
export async function memberName(memberId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    logError("week-summary:member-name", error);
    return null;
  }
  return data?.name ?? null;
}

/** Kept for callers that only need the zero shape. */
export const NO_ACTIVITY: MetricCounts = { ...ZERO_COUNTS };
