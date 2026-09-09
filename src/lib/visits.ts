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

  /**
   * Check-in / check-out (migration 0014). Every coordinate may be null: a
   * denied permission or no signal still records the arrival.
   */
  checkinAt: string | null;
  checkinLat: number | null;
  checkinLng: number | null;
  checkoutAt: string | null;
  checkoutLat: number | null;
  checkoutLng: number | null;
  checkoutMissing: boolean;
  /**
   * #6 — this arrival's position was declared by the rep, not measured. The
   * reason is their own words and is shown to admins.
   */
  checkinLocationManual: boolean;
  checkinManualReason: string | null;
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
    .select(
      "id, institute_id, purpose, meetings_actual, follow_up_date, assigned_by, checkin_at, checkin_lat, checkin_lng, checkout_at, checkout_lat, checkout_lng, checkout_missing, checkin_location_manual, checkin_manual_reason",
    )
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
    entries: rows.map(
      ({
        assigned_by,
        checkin_at,
        checkin_lat,
        checkin_lng,
        checkout_at,
        checkout_lat,
        checkout_lng,
        checkout_missing,
        checkin_location_manual,
        checkin_manual_reason,
        ...r
      }) => ({
        ...r,
        instituteName: names.get(r.institute_id) ?? "Unknown institute",
        assignedBy: assigned_by,
        assignedByName: assigned_by ? (assigners.get(assigned_by) ?? null) : null,
        checkinAt: checkin_at,
        checkinLat: checkin_lat,
        checkinLng: checkin_lng,
        checkoutAt: checkout_at,
        checkoutLat: checkout_lat,
        checkoutLng: checkout_lng,
        checkoutMissing: checkout_missing ?? false,
        checkinLocationManual: checkin_location_manual ?? false,
        checkinManualReason: checkin_manual_reason ?? null,
      }),
    ),
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
    // Q2 — a Set is closed by the rep checking in again and logging the visit
    // that completes it. That stamps closed_at here and leaves lifecycle_status
    // alone, so Rule 7 keeps crediting the Set to the week it was set in and
    // the Done to the week it happened. Without this filter a completed loop
    // would sit on Pending for ever.
    .is("closed_at", null)
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
    .eq("lifecycle_status", "Set")
    // The same filter Pending uses, and it has to be here too: miss it and the
    // Dashboard's "open loops" tile never comes down even though the loop is
    // closed and gone from the list.
    .is("closed_at", null);

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

/* ------------------------------------------------------------------ */
/* Q2 — the earlier "Set" a visit can close                            */
/* ------------------------------------------------------------------ */

export interface OpenLoop {
  id: string;
  activity: string;
  expected_date: string | null;
  date: string;
}

/**
 * The rep's own open loops at ONE institute, oldest first.
 *
 * This is what lets the feedback form ask "you set a session here on the 4th —
 * did it happen?". It is only ever an OFFER: a rep closing a different loop, or
 * none, must not be silently credited with the wrong one, so nothing here
 * decides anything. `close_visit()` re-checks the answer against the same three
 * conditions before it stamps anything.
 *
 * Scoped by RLS to the caller, and by member as well for correctness of the
 * answer rather than for security.
 */
export async function openLoopsAt(
  memberId: string,
  instituteId: string,
): Promise<OpenLoop[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("id, activity, expected_date, date")
    .eq("member", memberId)
    .eq("institute_id", instituteId)
    .eq("lifecycle_status", "Set")
    .is("closed_at", null)
    .order("expected_date", { ascending: true, nullsFirst: false })
    .order("date", { ascending: true });

  if (error) {
    logError("visits:open-loops-at", error);
    return [];
  }
  return data ?? [];
}

/**
 * The visit already logged against a check-in, if there is one.
 *
 * The flow logs the visit and files the feedback in one submit, but they are
 * two RPCs and only the second is a transaction with the check-out. If the
 * first succeeds and the second does not — a dropped connection at exactly the
 * wrong moment — the visit exists, unreported, and the rep is still checked in.
 *
 * So the Log Visit screen asks this before it renders. Finding a visit means
 * the logging half is already done, and the rep is shown the feedback alone
 * rather than a form that would log a SECOND visit for the same arrival.
 */
export async function getVisitForPlan(
  planId: string,
): Promise<{
  id: string;
  activity: string;
  lifecycle_status: string | null;
  status_set_to: string | null;
  reported_at: string | null;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("id, activity, lifecycle_status, status_set_to, reported_at")
    .eq("daily_plan_id", planId)
    .maybeSingle();

  if (error) {
    logError("visits:for-plan", error);
    return null;
  }
  return data ?? null;
}
