import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { periodRange, type TargetPeriod } from "@/lib/periods";
import {
  METRIC_KEYS,
  ZERO_COUNTS,
  tallyVisitMetrics,
  type MetricCounts,
  type TallyableVisit,
} from "@/lib/validation/weekly";

/**
 * Reading a target period: what was committed, and what actually happened.
 *
 * Rule 7 is unchanged and now applies to all three periods. Meetings come from
 * the daily plan, the other visit metrics come from the visits log, and both
 * are counted by `date` — the day the work was logged — over whatever range the
 * period covers. periods.ts owns that range, including the weekly case's
 * deliberate Sunday end, so a Sunday still folds into the week that just ended.
 *
 * institutes_covered is the exception to "count the rows": it is the number of
 * DISTINCT institutes reached, so four visits to one school count once. It is
 * filled in here rather than by tallyVisitMetrics() for the same reason
 * `meetings` is — that function counts matching rows and cannot express it.
 *
 * Every read is scoped by RLS: a rep's queries return only their own rows, an
 * admin's return the team's. The member filters below are for correctness of
 * the answer, not for security.
 */

export interface TargetRecord {
  id: string | null;
  member: string;
  period: TargetPeriod;
  period_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
  targets: MetricCounts;
}

export interface TargetView {
  record: TargetRecord;
  achieved: MetricCounts;
}

/** A period with no row yet: nothing committed, nothing locked. */
function emptyRecord(
  member: string,
  period: TargetPeriod,
  periodStart: string,
): TargetRecord {
  return {
    id: null,
    member,
    period,
    period_start: periodStart,
    locked: false,
    submitted_at: null,
    reopened_at: null,
    targets: { ...ZERO_COUNTS },
  };
}

// Built from METRIC_KEYS so the column list cannot drift from the metrics.
// supabase-js can only infer a row type from a literal select string, so the
// rows come back untyped and `toRecord` below checks each field itself.
const ROW_COLUMNS = `id, member, period, period_start, locked, submitted_at, reopened_at, ${METRIC_KEYS.join(", ")}`;

type RawRow = Record<string, unknown> & {
  id: string;
  member: string;
  period: string;
  period_start: string;
  locked: boolean;
  submitted_at: string | null;
  reopened_at: string | null;
};

function toRecord(row: RawRow): TargetRecord {
  const targets = { ...ZERO_COUNTS };
  for (const key of METRIC_KEYS) {
    const value = row[key];
    targets[key] = typeof value === "number" ? value : 0;
  }
  return {
    id: row.id,
    member: row.member,
    period: row.period as TargetPeriod,
    period_start: row.period_start,
    locked: row.locked,
    submitted_at: row.submitted_at,
    reopened_at: row.reopened_at,
    targets,
  };
}

/** A visit row as the achieved-count queries select it. */
type CountableVisit = TallyableVisit & { institute_id: string };

function achievedFrom(visits: CountableVisit[], meetingsHeld: number): MetricCounts {
  const achieved = tallyVisitMetrics(visits);
  achieved.meetings = meetingsHeld;
  achieved.institutes_covered = new Set(visits.map((v) => v.institute_id)).size;
  return achieved;
}

/* ------------------------------------------------------------------ */
/* One member                                                          */
/* ------------------------------------------------------------------ */

export async function getTargets(
  memberId: string,
  period: TargetPeriod,
  periodStart: string,
): Promise<{ ok: true; view: TargetView } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange(period, periodStart);

  const [targetsResult, plansResult, visitsResult] = await Promise.all([
    supabase
      .from("targets")
      .select(ROW_COLUMNS)
      .eq("member", memberId)
      .eq("period", period)
      .eq("period_start", periodStart)
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
      .select("member, activity, lifecycle_status, institute_id")
      .eq("member", memberId)
      .gte("date", start)
      .lte("date", end),
  ]);

  if (targetsResult.error) {
    logError("targets:row", targetsResult.error);
    return { ok: false };
  }
  if (plansResult.error) {
    logError("targets:meetings", plansResult.error);
    return { ok: false };
  }
  if (visitsResult.error) {
    logError("targets:visits", visitsResult.error);
    return { ok: false };
  }

  return {
    ok: true,
    view: {
      record: targetsResult.data
        ? toRecord(targetsResult.data as unknown as RawRow)
        : emptyRecord(memberId, period, periodStart),
      achieved: achievedFrom(
        (visitsResult.data ?? []) as CountableVisit[],
        plansResult.count ?? 0,
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/* The whole team                                                      */
/* ------------------------------------------------------------------ */

export interface TeamMemberTargets {
  member: string;
  name: string;
  role: string;
  view: TargetView;
}

/**
 * Every member's period in four queries rather than four per member.
 *
 * Only an admin's RLS scope returns other people's rows, so this is safe to
 * call from an admin surface; a rep calling it would simply see themselves.
 */
export async function getTeamTargets(
  period: TargetPeriod,
  periodStart: string,
): Promise<{ ok: true; members: TeamMemberTargets[] } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange(period, periodStart);

  const [profilesResult, targetsResult, plansResult, visitsResult] =
    await Promise.all([
      supabase.from("profiles").select("id, name, role").order("name"),
      supabase
        .from("targets")
        .select(ROW_COLUMNS)
        .eq("period", period)
        .eq("period_start", periodStart),
      supabase
        .from("daily_plans")
        .select("member")
        .eq("meetings_actual", 1)
        .gte("date", start)
        .lte("date", end),
      supabase
        .from("visits")
        .select("member, activity, lifecycle_status, institute_id")
        .gte("date", start)
        .lte("date", end),
    ]);

  for (const [context, result] of [
    ["targets:team-profiles", profilesResult],
    ["targets:team-rows", targetsResult],
    ["targets:team-meetings", plansResult],
    ["targets:team-visits", visitsResult],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false };
    }
  }

  const records = new Map<string, TargetRecord>();
  for (const row of (targetsResult.data ?? []) as unknown as RawRow[]) {
    records.set(row.member, toRecord(row));
  }

  const heldByMember = new Map<string, number>();
  for (const row of plansResult.data ?? []) {
    heldByMember.set(row.member, (heldByMember.get(row.member) ?? 0) + 1);
  }

  const visitsByMember = new Map<string, CountableVisit[]>();
  for (const row of (visitsResult.data ?? []) as (CountableVisit & {
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
    view: {
      record: records.get(profile.id) ?? emptyRecord(profile.id, period, periodStart),
      achieved: achievedFrom(
        visitsByMember.get(profile.id) ?? [],
        heldByMember.get(profile.id) ?? 0,
      ),
    },
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
    logError("targets:member-name", error);
    return null;
  }
  return data?.name ?? null;
}
