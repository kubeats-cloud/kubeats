import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { weekCountEnd } from "@/lib/weeks";
import {
  METRIC_KEYS,
  ZERO_COUNTS,
  tallyVisitMetrics,
  type MetricCounts,
  type TallyableVisit,
} from "@/lib/validation/weekly";

/**
 * Reading the week: what was committed, and what actually happened.
 *
 * Rule 7 in one sentence: Meetings come from the daily plan, everything else
 * comes from the visits log. Both are counted by `date` — the day the work was
 * logged — which is why a "Set" visit is dated today rather than its expected
 * date. The window runs Monday through Sunday even though the week is reported
 * as Monday to Saturday, so a Sunday's work counts towards the week that has
 * just ended instead of falling out of the figures altogether.
 *
 * Every read here is scoped by RLS: a rep's queries can only return their own
 * rows, an admin's return the whole team's. The member filters below are for
 * correctness of the answer, not for security.
 */

export interface WeekRecord {
  id: string | null;
  member: string;
  week_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
  targets: MetricCounts;
}

export interface WeekView {
  record: WeekRecord;
  achieved: MetricCounts;
}

/** A week with no row yet: nothing committed, nothing locked. */
function emptyRecord(member: string, weekStart: string): WeekRecord {
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
const ROW_COLUMNS = `id, member, week_start, locked, submitted_at, reopened_at, ${METRIC_KEYS.join(", ")}`;

type RawRow = Record<string, unknown> & {
  id: string;
  member: string;
  week_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
};

function toRecord(row: RawRow): WeekRecord {
  const targets = { ...ZERO_COUNTS };
  for (const key of METRIC_KEYS) {
    const value = row[key];
    targets[key] = typeof value === "number" ? value : 0;
  }
  return {
    id: row.id,
    member: row.member,
    week_start: row.week_start,
    locked: row.locked,
    submitted_at: row.submitted_at,
    reopened_at: row.reopened_at,
    targets,
  };
}

/* ------------------------------------------------------------------ */
/* Counting what happened                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* One member                                                          */
/* ------------------------------------------------------------------ */

export async function getWeek(
  memberId: string,
  weekStart: string,
): Promise<{ ok: true; view: WeekView } | { ok: false }> {
  const supabase = await createClient();
  // Sunday counts towards the week that just ended, so the upper bound is the
  // Sunday rather than the Saturday the rep is shown. See lib/weeks.ts.
  const end = weekCountEnd(weekStart);

  const [targetsResult, plansResult, visitsResult] = await Promise.all([
    supabase
      .from("weekly_targets")
      .select(ROW_COLUMNS)
      .eq("member", memberId)
      .eq("week_start", weekStart)
      .maybeSingle(),
    // Rule 7: the Meetings figure is the count of plan entries actually held.
    supabase
      .from("daily_plans")
      .select("id", { count: "exact", head: true })
      .eq("member", memberId)
      .eq("meetings_actual", 1)
      .gte("date", weekStart)
      .lte("date", end),
    supabase
      .from("visits")
      .select("member, activity, lifecycle_status")
      .eq("member", memberId)
      .gte("date", weekStart)
      .lte("date", end),
  ]);

  if (targetsResult.error) {
    logError("weekly:targets", targetsResult.error);
    return { ok: false };
  }
  if (plansResult.error) {
    logError("weekly:meetings", plansResult.error);
    return { ok: false };
  }
  if (visitsResult.error) {
    logError("weekly:visits", visitsResult.error);
    return { ok: false };
  }

  const achieved = tallyVisitMetrics(visitsResult.data ?? []);
  achieved.meetings = plansResult.count ?? 0;

  return {
    ok: true,
    view: {
      record: targetsResult.data
        ? toRecord(targetsResult.data as unknown as RawRow)
        : emptyRecord(memberId, weekStart),
      achieved,
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
  view: WeekView;
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
  // Sunday counts towards the week that just ended, so the upper bound is the
  // Sunday rather than the Saturday the rep is shown. See lib/weeks.ts.
  const end = weekCountEnd(weekStart);

  const [profilesResult, targetsResult, plansResult, visitsResult] =
    await Promise.all([
      supabase.from("profiles").select("id, name, role").order("name"),
      supabase.from("weekly_targets").select(ROW_COLUMNS).eq("week_start", weekStart),
      supabase
        .from("daily_plans")
        .select("member")
        .eq("meetings_actual", 1)
        .gte("date", weekStart)
        .lte("date", end),
      supabase
        .from("visits")
        .select("member, activity, lifecycle_status")
        .gte("date", weekStart)
        .lte("date", end),
    ]);

  for (const [context, result] of [
    ["weekly:team-profiles", profilesResult],
    ["weekly:team-targets", targetsResult],
    ["weekly:team-meetings", plansResult],
    ["weekly:team-visits", visitsResult],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false };
    }
  }

  const records = new Map<string, WeekRecord>();
  for (const row of (targetsResult.data ?? []) as unknown as RawRow[]) {
    records.set(row.member, toRecord(row));
  }

  const heldByMember = new Map<string, number>();
  for (const row of plansResult.data ?? []) {
    heldByMember.set(row.member, (heldByMember.get(row.member) ?? 0) + 1);
  }

  const visitsByMember = new Map<string, TallyableVisit[]>();
  for (const row of (visitsResult.data ?? []) as (TallyableVisit & { member: string })[]) {
    const list = visitsByMember.get(row.member);
    if (list) list.push(row);
    else visitsByMember.set(row.member, [row]);
  }

  const members = (profilesResult.data ?? []).map((profile) => {
    const achieved = tallyVisitMetrics(visitsByMember.get(profile.id) ?? []);
    achieved.meetings = heldByMember.get(profile.id) ?? 0;
    return {
      member: profile.id,
      name: profile.name ?? "Unnamed member",
      role: profile.role as string,
      view: {
        record: records.get(profile.id) ?? emptyRecord(profile.id, weekStart),
        achieved,
      },
    };
  });

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
    logError("weekly:member-name", error);
    return null;
  }
  return data?.name ?? null;
}
