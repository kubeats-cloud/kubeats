import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { periodRange } from "@/lib/periods";
import {
  ZERO_COUNTS,
  tallyVisitMetrics,
  type MetricCounts,
  type TallyableVisit,
} from "@/lib/validation/weekly";

/**
 * What a rep actually did in a week.
 *
 * This file used to be targets.ts and answered two questions at once — what
 * was promised, and what happened. Stage 2 of the redesign
 * (docs/flow-redesign-plan.md, change 4) dropped the first: the weekly screen
 * is a read-only account of the work, not a commitment to be met. So the
 * `public.targets` query is gone from here and NOTHING in the app reads or
 * writes that table any more.
 *
 * The table itself is untouched, rows and all. Keeping it is the reversible
 * choice — the same one taken for `institutes_covered` — and reviving weekly
 * commitments means restoring the query and the form, not a migration.
 *
 * RULE 7 IS THE PART THAT SURVIVED, AND IT IS UNCHANGED. Meetings are counted
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

export interface WeekSummary {
  member: string;
  weekStart: string;
  /** Rule 7's eight counts for the week. Never null: a quiet week is zeroes. */
  achieved: MetricCounts;
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

  const [plansResult, visitsResult] = await Promise.all([
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
  achieved: MetricCounts;
}

/**
 * Every member's week in three queries rather than three per member.
 *
 * Only an admin's RLS scope returns other people's rows, so this is safe to
 * call from an admin surface; a rep calling it would simply see themselves.
 */
export async function getTeamWeek(
  weekStart: string,
): Promise<{ ok: true; members: TeamMemberWeek[] } | { ok: false }> {
  const supabase = await createClient();
  const { start, end } = periodRange("weekly", weekStart);

  const [profilesResult, plansResult, visitsResult] = await Promise.all([
    supabase.from("profiles").select("id, name, role").order("name"),
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
    ["week-summary:team-meetings", plansResult],
    ["week-summary:team-visits", visitsResult],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false };
    }
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
