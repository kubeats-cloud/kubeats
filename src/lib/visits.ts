import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import type { InstituteStatus } from "@/lib/validation/institute";

/*
 * There used to be a second copy of todayISO() here, computing the day from the
 * server's own calendar while weeks.ts computed it from its own. One definition
 * of "today" is the most this app can safely have — see dates.ts, which is now
 * the only place it is decided, and the database function it has to match.
 */
export { todayISO };

export interface PickerInstitute {
  id: string;
  name: string;
  city: string | null;
  /**
   * Carried so a picker can say when an institute's loop is already finished.
   * Nothing filters on it — a closed institute has always been plannable, and
   * this exists so a rep can SEE that they are reopening an old thread rather
   * than starting a new one by mistake.
   */
  status: InstituteStatus | null;
}

export async function listInstitutesForPicker(): Promise<PickerInstitute[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institutes")
    .select("id, name, city, status")
    .order("name");

  if (error) {
    logError("visits:institutes", error);
    return [];
  }
  return data ?? [];
}

export async function listPurposes(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purposes")
    .select("label")
    .order("label");

  if (error) {
    logError("visits:purposes", error);
    return [];
  }
  return (data ?? []).map((p) => p.label);
}

export interface PlanEntry {
  id: string;
  institute_id: string;
  instituteName: string;
  purpose: string;
  meetings_actual: number | null;
  follow_up_date: string | null;
  /** Set when an admin put this on the rep's plan rather than the rep. */
  assignedBy: string | null;
  assignedByName: string | null;
}

/**
 * Today's plan for the signed-in rep.
 *
 * RLS restricts daily_plans to the caller's own rows, so this needs no explicit
 * member filter — but one is applied anyway, since an admin would otherwise see
 * the whole team's plan on their own Dashboard.
 */
export async function getTodayPlan(
  memberId: string,
): Promise<{ ok: true; entries: PlanEntry[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select("id, institute_id, purpose, meetings_actual, follow_up_date, assigned_by")
    .eq("member", memberId)
    .eq("date", todayISO())
    .order("created_at", { ascending: false });

  if (error) {
    logError("visits:today-plan", error);
    return { ok: false };
  }

  const rows = data ?? [];
  const [names, assigners] = await Promise.all([
    instituteNames(rows.map((r) => r.institute_id)),
    memberNames(rows.map((r) => r.assigned_by).filter((id): id is string => Boolean(id))),
  ]);

  return {
    ok: true,
    entries: rows.map(({ assigned_by, ...r }) => ({
      ...r,
      instituteName: names.get(r.institute_id) ?? "Unknown institute",
      assignedBy: assigned_by,
      assignedByName: assigned_by ? (assigners.get(assigned_by) ?? null) : null,
    })),
  };
}

export interface PendingVisit {
  id: string;
  activity: string;
  institute_id: string;
  instituteName: string;
  date: string;
  expected_date: string | null;
  member: string;
  memberName: string | null;
  notes: string | null;
}

/**
 * Everything still sitting at "Set" (rule 3), oldest first so the longest-open
 * loop is at the top.
 *
 * Scoped by RLS: a rep sees their own, an admin sees the whole team's.
 */
export async function getPendingVisits(): Promise<
  { ok: true; visits: PendingVisit[] } | { ok: false }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("id, activity, institute_id, date, expected_date, member, notes")
    .eq("lifecycle_status", "Set")
    // Soonest due first, which is what the rep has to act on. `date` is only a
    // tiebreak now that it records when the visit was logged, not when it is due.
    .order("expected_date", { ascending: true, nullsFirst: false })
    .order("date", { ascending: true });

  if (error) {
    logError("visits:pending", error);
    return { ok: false };
  }

  const rows = data ?? [];
  const [names, members] = await Promise.all([
    instituteNames(rows.map((r) => r.institute_id)),
    memberNames(rows.map((r) => r.member)),
  ]);

  return {
    ok: true,
    visits: rows.map((r) => ({
      ...r,
      instituteName: names.get(r.institute_id) ?? "Unknown institute",
      memberName: members.get(r.member) ?? null,
    })),
  };
}

/* Lookups kept separate rather than embedded, so nothing depends on PostgREST
 * inferring the right relationship. */

async function instituteNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institutes")
    .select("id, name")
    .in("id", unique);

  if (error) {
    logError("visits:institute-names", error);
    return new Map();
  }
  return new Map((data ?? []).map((i) => [i.id, i.name]));
}

async function memberNames(ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .in("id", unique);

  if (error) {
    // Names are decoration; the list is still useful without them.
    logError("visits:member-names", error);
    return new Map();
  }
  return new Map((data ?? []).map((p) => [p.id, p.name]));
}

/**
 * Open loops per member — everything still at "Set", all-time rather than
 * week-scoped, because an unclosed session from three weeks ago is exactly the
 * one that needs chasing.
 *
 * RLS decides the scope: a rep's call returns only their own, an admin's
 * returns the whole team's, which is what the team snapshot needs.
 */
export async function openLoopsByMember(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("member")
    .eq("lifecycle_status", "Set");

  if (error) {
    logError("visits:open-loops", error);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.member, (counts.get(row.member) ?? 0) + 1);
  }
  return counts;
}
