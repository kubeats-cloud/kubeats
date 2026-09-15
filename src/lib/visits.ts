import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { instituteNameFrom } from "@/lib/institute-scope";
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

/**
 * A purpose as the planner needs it: the label a rep reads, and the mapping
 * that decides what the visit will BE.
 *
 * Stage 3 derives the activity from this rather than asking the rep, so the
 * picker has to carry it. `requiresNote` is what makes "Other" ask for words.
 */
export interface PurposeOption {
  id: string;
  label: string;
  activity: string | null;
  lifecycle: string | null;
  requiresNote: boolean;
}

/**
 * The purposes a rep may plan under, retired ones excluded.
 *
 * `is_active` is filtered HERE rather than by a policy, because a retired
 * purpose must stay READABLE — every plan row that already references one needs
 * its mapping to resolve for ever. Retiring takes it out of the picker, not out
 * of the database. See migration 0025.
 */
export async function listPurposes(): Promise<PurposeOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purposes")
    .select("id, label, activity, lifecycle, requires_note, is_active")
    .eq("is_active", true)
    .order("label");

  if (error) {
    logError("visits:purposes", error);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id,
    label: p.label,
    activity: p.activity,
    lifecycle: p.lifecycle,
    requiresNote: p.requires_note ?? false,
  }));
}

/**
 * The joined purpose row, whatever shape PostgREST hands back.
 *
 * `daily_plans.purpose_id` is a many-to-one, so the embed is logically a single
 * row — but supabase-js infers an ARRAY from the select string, because the
 * relationship direction is not in the literal. Rather than cast the whole
 * result and lose every other field's type, this narrows the one embed and
 * accepts both shapes: an object, a one-element array, or null.
 *
 * Null is a real and expected answer, not a failure: a plan made before 0025
 * has no `purpose_id`, and so does one whose purpose was DELETED rather than
 * retired. Callers ask `plannedActivityIsValid()` before relying on it.
 */
type JoinedPurpose = { activity: string | null; lifecycle: string | null };

function purposeOf(
  embedded: JoinedPurpose | JoinedPurpose[] | null | undefined,
): JoinedPurpose | null {
  if (!embedded) return null;
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded;
}

export interface PlanEntry {
  id: string;
  institute_id: string;
  instituteName: string;
  purpose: string;
  /**
   * What this plan's purpose makes the visit, derived rather than asked.
   *
   * Stage 3 deleted Log Visit's Activity selector; this pair is what replaced
   * it. It comes from the joined `purposes` row (`activity` from 0024,
   * `lifecycle` from 0025), so a rename cannot break it and an admin adding a
   * purpose decides it at that moment.
   *
   * Null when the plan predates the link, or its purpose was deleted rather
   * than retired. `plannedActivityIsValid()` is what callers ask before walking
   * a rep into a visit that could not be saved.
   */
  activity: string | null;
  lifecycle: string | null;
  /** "Other" — the rep's own words about what this visit is for. */
  purposeNote: string | null;
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
    // The purpose row rides along, because it is what decides the visit's
    // activity now. A literal select string, and the join is inferred from
    // daily_plans.purpose_id (migration 0025) — which is also why that FK
    // exists rather than the label being matched a second time here.
    .select(
      "id, institute_id, purpose, purpose_note, meetings_actual, follow_up_date, assigned_by, checkin_at, checkin_lat, checkin_lng, checkout_at, checkout_lat, checkout_lng, checkout_missing, checkin_location_manual, checkin_manual_reason, purposes(activity, lifecycle)",
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
        purpose_note,
        purposes,
        ...r
      }) => ({
        ...r,
        // PostgREST returns an embedded one-to-one as an object, or null when
        // purpose_id is null — a plan made before 0025, or one whose purpose was
        // deleted rather than retired. Null here is not an error; it is a plan
        // whose activity cannot be derived, which the Dashboard and Log Visit
        // both handle rather than crash on.
        activity: purposeOf(purposes)?.activity ?? null,
        lifecycle: purposeOf(purposes)?.lifecycle ?? null,
        purposeNote: purpose_note ?? null,
        instituteName: instituteNameFrom(names, r.institute_id, "visits"),
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
      instituteName: instituteNameFrom(names, r.institute_id, "visits"),
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
 * The visit already logged against this check-in whose report is not finished.
 *
 * MATCHED ON THE PLAN'S OWN KEY, NOT ON visits.daily_plan_id, and that is the
 * whole point of this function rather than an incidental detail.
 *
 * Logging and filing are one submit but two RPCs. If the first succeeds and the
 * second does not, the visit exists, unreported, and the rep is still checked
 * in — which is exactly the case this exists to recover. But `daily_plan_id` is
 * written by `close_visit()`, the step that just failed, so looking the visit up
 * by that link finds nothing in precisely the situation it was added for. The
 * rep would be handed the full log form and would log a SECOND visit for one
 * arrival.
 *
 * So it matches the way the plan row itself is keyed: (member, date,
 * institute_id), which `daily_plans_unique_per_day` has made unique since 0001
 * and which #8 keeps to one check-in cycle. `reported_at is null` is what makes
 * it a resume rather than a duplicate — once the report is filed this returns
 * nothing and the screen stops offering it.
 *
 * Newest first, because a cycle may legitimately record more than one activity
 * (Q3) and the one still owing a report is the one just logged.
 */
export async function getUnreportedVisitFor(plan: {
  member: string;
  date: string;
  institute_id: string;
}): Promise<{
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
    .eq("member", plan.member)
    .eq("date", plan.date)
    .eq("institute_id", plan.institute_id)
    .is("reported_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    logError("visits:unreported-for-plan", error);
    return null;
  }
  return data?.[0] ?? null;
}

/**
 * Every visit of this rep's still owing a report — the "pending closing report"
 * list.
 *
 * Distinct from `getPendingVisits()`, which lists "Set" loops waiting to be
 * COMPLETED. This lists visits that already happened and are waiting to be
 * DESCRIBED, which is a different kind of owing and a much shorter one: a rep
 * finishes these today.
 */
export interface UnreportedVisit {
  id: string;
  activity: string;
  date: string;
  instituteName: string;
  planId: string | null;
}

export async function getUnreportedVisits(
  memberId: string,
): Promise<UnreportedVisit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("id, activity, date, institute_id, daily_plan_id")
    .eq("member", memberId)
    .is("reported_at", null)
    .order("date", { ascending: false });

  if (error) {
    logError("visits:unreported", error);
    return [];
  }

  const rows = data ?? [];
  const names = await instituteNames(rows.map((r) => r.institute_id));
  return rows.map((r) => ({
    id: r.id,
    activity: r.activity,
    date: r.date,
    instituteName: instituteNameFrom(names, r.institute_id, "visits"),
    planId: r.daily_plan_id,
  }));
}

/**
 * One plan row by id, whatever day it belongs to.
 *
 * getTodayPlan() answers "what am I doing today", which is the right question
 * for the Dashboard and the wrong one for finishing a report: a visit logged
 * yesterday and never reported still owes one, and by then its plan row has
 * been swept closed and is not in today's list at all.
 *
 * Scoped by RLS to the caller, and by member as well for correctness.
 */
export async function getPlanById(
  memberId: string,
  planId: string,
): Promise<{
  id: string;
  date: string;
  institute_id: string;
  instituteName: string;
  purpose: string;
  purposeNote: string | null;
  activity: string | null;
  lifecycle: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  checkoutMissing: boolean;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select(
      "id, date, institute_id, purpose, purpose_note, checkin_at, checkout_at, checkout_missing, purposes(activity, lifecycle)",
    )
    .eq("id", planId)
    .eq("member", memberId)
    .maybeSingle();

  if (error || !data) {
    if (error) logError("visits:plan-by-id", error);
    return null;
  }

  const names = await instituteNames([data.institute_id]);
  return {
    id: data.id,
    date: data.date,
    institute_id: data.institute_id,
    instituteName: instituteNameFrom(names, data.institute_id, "visits"),
    purpose: data.purpose,
    purposeNote: data.purpose_note ?? null,
    activity: purposeOf(data.purposes)?.activity ?? null,
    lifecycle: purposeOf(data.purposes)?.lifecycle ?? null,
    checkinAt: data.checkin_at,
    checkoutAt: data.checkout_at,
    checkoutMissing: data.checkout_missing ?? false,
  };
}
