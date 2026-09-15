import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { instituteNameFrom } from "@/lib/institute-scope";
import { todayISO } from "@/lib/dates";


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
  status: string | null;
  /**
   * Who it belongs to.
   *
   * A REP NEVER NEEDS THIS — once rep-owned institutes ship, RLS has already
   * narrowed their picker to their own. It is here for the ADMIN's assign
   * picker, where RLS narrows nothing and the list has to be filtered to the
   * rep being assigned to, or every assignment would be refused by FO023.
   */
  registered_by: string | null;
}

export async function listInstitutesForPicker(): Promise<PickerInstitute[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("institutes")
    .select("id, name, city, status, registered_by")
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

/** One institute still in play, and the visit that left it that way. */
export interface FollowUp {
  instituteId: string;
  instituteName: string;
  city: string | null;
  /** The institute's CURRENT status, which is what makes it open. */
  status: string;
  /** From the visit that set it. Null when nothing visible explains it. */
  visitId: string | null;
  member: string | null;
  memberName: string | null;
  setOn: string | null;
  followUpDate: string | null;
  /** A session or campus visit's own date, when the status carries one. */
  expectedDate: string | null;
  notes: string | null;
  /** Whether the viewer is the one who left it open. */
  mine: boolean;
  /**
   * WHO THE INSTITUTE BELONGS TO — `institutes.registered_by`, not the member
   * above.
   *
   * The two are usually the same person and are NOT the same fact. `member` is
   * whoever logged the visit that left this status; `owner` is whoever can act
   * on it now. They part company exactly when an institute is reassigned: the
   * old owner's visit still explains the status, and the new owner is the only
   * rep who can visit again.
   *
   * Stage 5b's admin assignment goes to the OWNER, because that is the only rep
   * FO023 and FO026 will accept a plan row for. Null means the institute is
   * unassigned, and nothing can be assigned at it until an admin gives it to
   * somebody.
   */
  owner: string | null;
  ownerName: string | null;
}

/**
 * What is still owed: every institute whose CURRENT status is OPEN.
 *
 * THIS IS NOT WHAT PENDING USED TO ASK. It listed visits sitting at
 * `lifecycle_status = 'Set'` — sessions and campus visits promised and not yet
 * held. That was one particular kind of owing, and it missed every other:
 * a first meeting that needs chasing, an approval nobody has come back on, an
 * invitation with no RSVP. Those are exactly the statuses the vocabulary calls
 * OPEN, so that is what this asks now.
 *
 * DRIVEN OFF `institutes.status`, NOT OFF EACH VISIT, and the difference
 * matters three times over:
 *
 *   * it is the same value as the badge on /institutes, so the two screens
 *     cannot disagree about whether a school is still in play;
 *   * it collapses correctly — an institute visited five times is ONE row, not
 *     five;
 *   * it handles supersession across reps. Under campus scoping two reps share
 *     a campus, so if A logs "Session scheduled" and B later logs "Session
 *     done", the loop is closed and it must leave Pending. Reading each visit
 *     would leave A's row sitting there for ever.
 *
 * OPEN COMES FROM THE MANAGED VOCABULARY, never from a list here. A status an
 * admin adds and marks open appears in Pending on the next request, with no
 * code change — which is the whole point of stages 4a and 4b.
 *
 * SCOPING IS RLS'S, TWICE OVER AND FOR TWO DIFFERENT REASONS:
 *
 *   institutes   campus-scoped (0020b). A rep sees the open institutes in THEIR
 *                campus; an admin sees every campus. This is what decides which
 *                rows exist at all.
 *   visits       `member = auth.uid() or is_admin()`. This decides only whether
 *                the row can be ATTRIBUTED — a rep sees who left it open when
 *                it was them, and an admin sees whoever it was.
 *
 * So a rep sees an open institute in their campus even when a colleague set the
 * status, and the row says so rather than being hidden. That is deliberate:
 * this list is what is owed in the campus, and silently dropping a school
 * because somebody else touched it last would be a gap nobody could see.
 */
export async function getOpenFollowUps(
  openStatuses: readonly string[],
  viewerId: string,
): Promise<{ ok: true; items: FollowUp[] } | { ok: false }> {
  // A vocabulary with nothing open is a real answer, not an error — and `.in()`
  // with an empty list is a query worth not sending.
  if (openStatuses.length === 0) return { ok: true, items: [] };

  const supabase = await createClient();
  const { data: institutes, error } = await supabase
    .from("institutes")
    .select("id, name, city, status, registered_by")
    .in("status", openStatuses)
    .order("name");

  if (error) {
    logError("visits:open-follow-ups", error);
    return { ok: false };
  }

  const rows = institutes ?? [];
  if (rows.length === 0) return { ok: true, items: [] };

  // The visits that could explain any of them, newest first. `date` then
  // `created_at`, so two visits on one day still resolve in the order they
  // happened rather than arbitrarily.
  const { data: visits, error: visitError } = await supabase
    .from("visits")
    .select(
      "id, institute_id, member, date, status_set_to, follow_up_date, expected_date, notes",
    )
    .in("institute_id", rows.map((r) => r.id))
    .in("status_set_to", openStatuses)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (visitError) {
    logError("visits:open-follow-ups-attribution", visitError);
    return { ok: false };
  }

  /**
   * The visit that left each institute where it is.
   *
   * Matched on the institute's CURRENT status, not merely on being the latest
   * visit: a rep who logged "Session scheduled" and then, later, "First meeting
   * done" leaves the institute at the second, and the follow-up date that
   * matters is the one recorded with it. The list is already newest-first, so
   * the first match wins.
   */
  const attribution = new Map<string, (typeof visits)[number]>();
  for (const visit of visits ?? []) {
    const institute = rows.find((r) => r.id === visit.institute_id);
    if (!institute || visit.status_set_to !== institute.status) continue;
    if (!attribution.has(visit.institute_id)) {
      attribution.set(visit.institute_id, visit);
    }
  }

  // Both sets of names in one lookup: whoever logged the visit, and whoever
  // owns the institute now. Usually the same person, occasionally not.
  const memberIds = [
    ...[...attribution.values()].map((v) => v.member),
    ...rows.map((r) => r.registered_by).filter((id): id is string => Boolean(id)),
  ];
  const members = await memberNames(memberIds);

  const items: FollowUp[] = rows.map((institute) => {
    const visit = attribution.get(institute.id) ?? null;
    return {
      instituteId: institute.id,
      instituteName: institute.name,
      city: institute.city,
      status: institute.status as string,
      visitId: visit?.id ?? null,
      member: visit?.member ?? null,
      memberName: visit ? (members.get(visit.member) ?? null) : null,
      setOn: visit?.date ?? null,
      followUpDate: visit?.follow_up_date ?? null,
      expectedDate: visit?.expected_date ?? null,
      notes: visit?.notes ?? null,
      mine: visit?.member === viewerId,
      owner: institute.registered_by ?? null,
      ownerName: institute.registered_by
        ? (members.get(institute.registered_by) ?? null)
        : null,
    };
  });

  /**
   * Soonest first, and anything with no date at the end.
   *
   * A row with no follow-up date is either a visit logged before Rule 5 started
   * demanding one, or an institute whose status was set without a visit this
   * viewer can see. Neither is urgent in the way an overdue chase is, and
   * sorting them to the top would bury the dates that do mean something.
   */
  items.sort((a, b) => {
    if (a.followUpDate && b.followUpDate) {
      return a.followUpDate.localeCompare(b.followUpDate);
    }
    if (a.followUpDate) return -1;
    if (b.followUpDate) return 1;
    return a.instituteName.localeCompare(b.instituteName);
  });

  return { ok: true, items };
}

/* Lookups kept separate rather than embedded, so nothing depends on PostgREST
 * inferring the right relationship. */

/**
 * Institute names for a batch of visit rows.
 *
 * NOT a plain select on `institutes`, and that is the whole point. Migration
 * 0028 makes an institute readable only by the rep who owns it, so a rep whose
 * institute has been REASSIGNED loses the name on their own past visits — the
 * visit rows are still theirs (`visits` is member-scoped and nothing moved
 * them), but the name lookup misses and their history goes anonymous.
 *
 * `institute_names_i_visited()` answers for exactly the rows that describes:
 * names only, for ids the caller already provably holds a visit against. It
 * grants no listing, no filtering and no detail, so it cannot put the institute
 * back in the picker or back in Pending — which is what widening
 * `institutes_select` to "institutes I have visited" would have done, RLS
 * giving one SELECT for all purposes.
 *
 * THE FALLBACK IS THE DEPLOY WINDOW, not a preference. This code may run for a
 * few minutes against a database where 0028 has not been applied, and PostgREST
 * answers an unknown function with PGRST202 rather than with rows. So an
 * unknown function drops back to the select this used to be, which is exactly
 * right on a pre-0028 database: the policy there is still campus-scoped, so the
 * select returns what the RPC would have. It is dead code the moment 0028
 * lands, and harmless until then.
 */
/**
 * Institute names for a batch of rows, from the two places they can come from.
 *
 * THE ORDINARY READ FIRST, THE DEFINER FUNCTION ONLY FOR THE GAPS. That order
 * is the whole correctness argument, and getting it wrong shipped a bug:
 *
 * This lookup serves THREE callers, and only one of them is history.
 * `getTodayPlan()` and `getPlanById()` resolve names for entries that have been
 * PLANNED and not yet logged — rows that have no `visits` record at all. Asking
 * `institute_names_i_visited()` first meant those names missed, fell through to
 * `instituteNameOr()` and rendered as "No longer yours" on a rep's own
 * dashboard, for an institute they own and were standing in.
 *
 * So:
 *
 *   1. Select from `institutes` under the caller's own RLS. After 0028 that is
 *      every institute they currently own — which covers a planned entry, an
 *      in-progress visit, and all the history they have not been reassigned out
 *      of. For a rep who has never had anything moved, this answers everything
 *      and step 2 never runs.
 *   2. For whatever is STILL missing — and it can only be an institute
 *      reassigned away from them — ask the definer function, which returns
 *      names for ids the caller provably holds a visit against.
 *
 * Strictly additive: step 2 can only fill blanks, never hide or change a name
 * step 1 already found. That is what makes the ordering safe as well as
 * correct.
 */
async function instituteNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const names = new Map<string, string>();

  const { data, error } = await supabase
    .from("institutes")
    .select("id, name")
    .in("id", unique);

  if (error) {
    logError("visits:institute-names", error);
  } else {
    for (const row of data ?? []) names.set(row.id, row.name);
  }

  // Only what the caller can no longer read: an institute reassigned away from
  // them, whose visits are still theirs. Skipped entirely when nothing is
  // missing, which is the normal case.
  const missing = unique.filter((id) => !names.has(id));
  if (missing.length === 0) return names;

  const recovered = await supabase.rpc("institute_names_i_visited", {
    p_ids: missing,
  });

  if (recovered.error) {
    // PGRST202 is "no function by that name" — 0028 has not been applied. The
    // names from step 1 are then the whole answer, which is exactly right on a
    // pre-0028 database, so this is not worth a log line.
    if (recovered.error.code !== "PGRST202") {
      logError("visits:institute-names-recover", recovered.error);
    }
    return names;
  }

  for (const row of (recovered.data ?? []) as { id: string; name: string }[]) {
    names.set(row.id, row.name);
  }
  return names;
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

/*
 * openLoopsByMember() stood here — a count of visits still at "Set" and not
 * closed, per member. It fed two tiles: "Open loops" on the rep's Dashboard,
 * and a column of the same name on the admin's Team screen.
 *
 * Both are deleted, and the function with them (decision D7). Pending now means
 * "institutes whose current status is OPEN", which is a different and wider
 * question — so the tiles would have sat beside it counting something else
 * under the same word. Two near-identical "open" numbers that disagree is how a
 * team stops trusting either.
 *
 * The Set→Done machinery is NOT gone and must not be confused with this: it is
 * Rule 7's arithmetic, not a screen. `openLoopsAt()` below, `closes_visit_id`,
 * `closed_at` and `visits_open_set_idx` are all untouched, and the activity
 * report still distinguishes a lifecycle activity that stays open until it is
 * closed as Done.
 */

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
