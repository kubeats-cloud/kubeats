import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { instituteNameOr } from "@/lib/institute-scope";
import { signVisitPhotos } from "@/lib/photos";
import type { VisitPhoto } from "@/lib/photos";
import { activityLabelFor } from "@/lib/validation/visit";
import { mondayOf, weekCountEnd } from "@/lib/weeks";
import { todayISO } from "@/lib/dates";

/**
 * The reading side of the admin workspace.
 *
 * Everything here runs as the signed-in admin, not as the service role. That is
 * deliberate: RLS already says an admin may read the whole team's work, so
 * going through the ordinary client means these screens are governed by the
 * same policy as everything else. If the policy were ever wrong, these queries
 * would come back empty rather than quietly leaking past it.
 *
 * Nothing here writes. The admin's destructive tools live in admin-actions.ts,
 * where they can be guarded one at a time.
 */

export interface VisitRow {
  id: string;
  date: string;
  activity: string;
  activityLabel: string;
  lifecycle: string | null;
  status: string | null;
  notes: string | null;
  reportedAt: string | null;
  outcome: string | null;
  memberId: string;
  memberName: string;
  instituteId: string;
  instituteName: string;
  city: string | null;
  photo: VisitPhoto | null;
}

export interface VisitFilters {
  member?: string;
  institute?: string;
  activity?: string;
  from?: string;
  to?: string;
  /** "reported" | "unreported" — whether a closing report has been filed. */
  reported?: string;
}

/**
 * One literal select string.
 *
 * supabase-js can only infer a row type from a literal, so building this by
 * concatenation would hand back GenericStringError instead of a row — the same
 * trap that has caught this codebase before.
 */
const VISIT_SELECT =
  "id, date, activity, lifecycle_status, status_set_to, notes, reported_at, visit_outcome, institute_interested, photo_url, member, institute_id, profiles!visits_member_fkey(name), institutes(name, city)";

interface RawVisit {
  id: string;
  date: string;
  activity: string;
  lifecycle_status: string | null;
  status_set_to: string | null;
  notes: string | null;
  reported_at: string | null;
  visit_outcome: string | null;
  institute_interested: boolean | null;
  photo_url: string | null;
  member: string;
  institute_id: string;
  profiles: { name: string | null } | null;
  institutes: { name: string | null; city: string | null } | null;
}

/** Keeps one page of results honest about how much there is behind it. */
export const REVIEW_PAGE_SIZE = 50;

export async function listTeamVisits(
  filters: VisitFilters = {},
): Promise<
  { ok: true; visits: VisitRow[]; total: number } | { ok: false }
> {
  const supabase = await createClient();

  let query = supabase
    .from("visits")
    .select(VISIT_SELECT, { count: "exact" })
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(REVIEW_PAGE_SIZE);

  // Each filter is optional and independent; an absent one is not a filter of
  // "null", it is no filter at all.
  if (filters.member) query = query.eq("member", filters.member);
  if (filters.institute) query = query.eq("institute_id", filters.institute);
  if (filters.activity) query = query.eq("activity", filters.activity);
  if (filters.from) query = query.gte("date", filters.from);
  if (filters.to) query = query.lte("date", filters.to);
  if (filters.reported === "reported") query = query.not("reported_at", "is", null);
  if (filters.reported === "unreported") query = query.is("reported_at", null);

  const { data, error, count } = await query;

  if (error) {
    logError("admin:visits", error);
    return { ok: false };
  }

  const rows = (data ?? []) as unknown as RawVisit[];
  const photos = await signVisitPhotos(rows.map((r) => r.photo_url));

  return {
    ok: true,
    total: count ?? rows.length,
    visits: rows.map((row) => ({
      id: row.id,
      date: row.date,
      activity: row.activity,
      activityLabel: activityLabelFor(row.activity),
      lifecycle: row.lifecycle_status,
      status: row.status_set_to,
      notes: row.notes,
      reportedAt: row.reported_at,
      /**
       * The Outcome column reads `visit_outcome` again — the field is back on
       * the form, so the column that was named after it works again.
       *
       * The fallback to `institute_interested` stays behind it rather than
       * being taken out. It costs one comparison and it covers the case this
       * column has already been caught by once: a visit whose outcome was left
       * blank still says something, instead of a dash in the one column an
       * admin scans down.
       */
      outcome:
        row.visit_outcome ??
        (row.institute_interested === null
          ? null
          : row.institute_interested
            ? "Interested"
            : "Not interested"),
      memberId: row.member,
      memberName: row.profiles?.name ?? "Unknown",
      instituteId: row.institute_id,
      instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
      city: row.institutes?.city ?? null,
      photo: row.photo_url ? (photos.get(row.photo_url) ?? { status: "expired" }) : null,
    })),
  };
}

/**
 * A visit somebody is still inside.
 *
 * Shown to an admin so a rep whose flow was orphaned can be unblocked the same
 * day rather than waiting for the 01:30 sweep — with one-open-visit-at-a-time,
 * an orphan stops that rep working anywhere.
 */
export interface OpenCheckIn {
  planId: string;
  memberName: string;
  instituteName: string;
  checkinAt: string;
  /** Older than today, so almost certainly orphaned rather than in progress. */
  stale: boolean;
  locationManual: boolean;
}

export interface Overview {
  visitsToday: number;
  visitsThisWeek: number;
  reportsThisWeek: number;
  photosThisWeek: number;
  openLoops: number;
  activeToday: { id: string; name: string; visits: number }[];
  openCheckIns: OpenCheckIn[];
  recent: VisitRow[];
}

/**
 * The supervisor's landing screen, in one round of queries.
 *
 * Counts use `head: true` so Postgres returns a number and no rows — the page
 * needs "how many", not "which", and pulling a thousand rows to call .length on
 * them is how a dashboard becomes the slowest screen in an app.
 */
export async function getOverview(): Promise<
  { ok: true; data: Overview } | { ok: false }
> {
  const supabase = await createClient();
  const today = todayISO();
  const weekStart = mondayOf();
  const weekEnd = weekCountEnd(weekStart);

  const countOf = (build: (q: ReturnType<typeof baseCount>) => typeof q) => {
    return build(baseCount());
  };
  function baseCount() {
    return supabase.from("visits").select("id", { count: "exact", head: true });
  }

  const [todayCount, weekCount, reported, photos, loops, recent, actives, openIns] =
    await Promise.all([
      countOf((q) => q.eq("date", today)),
      countOf((q) => q.gte("date", weekStart).lte("date", weekEnd)),
      countOf((q) =>
        q.gte("date", weekStart).lte("date", weekEnd).not("reported_at", "is", null),
      ),
      countOf((q) =>
        q.gte("date", weekStart).lte("date", weekEnd).not("photo_url", "is", null),
      ),
      countOf((q) => q.eq("lifecycle_status", "Set")),
      listTeamVisits({}),
      supabase
        .from("visits")
        .select("member, profiles!visits_member_fkey(name)")
        .eq("date", today),
      // Everyone currently inside a visit. The predicate is the same one
      // daily_plans_one_open_visit indexes, so this asks exactly the question
      // that decides whether a rep is blocked.
      supabase
        .from("daily_plans")
        .select(
          "id, date, checkin_at, checkin_location_manual, profiles!daily_plans_member_fkey(name), institutes(name)",
        )
        .not("checkin_at", "is", null)
        .is("checkout_at", null)
        .eq("checkout_missing", false)
        .order("checkin_at", { ascending: true }),
    ]);

  if (todayCount.error || weekCount.error || !recent.ok) {
    logError("admin:overview", todayCount.error ?? weekCount.error ?? "recent failed");
    return { ok: false };
  }

  // Who was out today, and how much they logged. Built here rather than in SQL
  // because it is a handful of rows and a group-by would need a view.
  const tally = new Map<string, { id: string; name: string; visits: number }>();
  for (const row of (actives.data ?? []) as unknown as {
    member: string;
    profiles: { name: string | null } | null;
  }[]) {
    const found = tally.get(row.member);
    if (found) found.visits += 1;
    else
      tally.set(row.member, {
        id: row.member,
        name: row.profiles?.name ?? "Unknown",
        visits: 1,
      });
  }

  const openCheckIns: OpenCheckIn[] = (
    (openIns.data ?? []) as unknown as {
      id: string;
      date: string;
      checkin_at: string;
      checkin_location_manual: boolean | null;
      profiles: { name: string | null } | null;
      institutes: { name: string | null } | null;
    }[]
  ).map((row) => ({
    planId: row.id,
    memberName: row.profiles?.name ?? "Unknown",
    instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
    checkinAt: row.checkin_at,
    stale: row.date < today,
    locationManual: row.checkin_location_manual ?? false,
  }));

  return {
    ok: true,
    data: {
      visitsToday: todayCount.count ?? 0,
      visitsThisWeek: weekCount.count ?? 0,
      reportsThisWeek: reported.count ?? 0,
      photosThisWeek: photos.count ?? 0,
      openLoops: loops.count ?? 0,
      activeToday: [...tally.values()].sort((a, b) => b.visits - a.visits),
      openCheckIns,
      recent: recent.visits.slice(0, 8),
    },
  };
}

export interface AssignmentRow {
  id: string;
  date: string;
  purpose: string;
  held: boolean;
  memberName: string;
  instituteName: string;
}

/** What has been allocated and not yet done — the other half of the Assign screen. */
export async function listAssignments(): Promise<AssignmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select(
      "id, date, purpose, meetings_actual, assigned_by, profiles!daily_plans_member_fkey(name), institutes(name)",
    )
    .not("assigned_by", "is", null)
    .gte("date", todayISO())
    .order("date", { ascending: true });

  if (error) {
    logError("admin:assignments", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    date: string;
    purpose: string;
    meetings_actual: number | null;
    profiles: { name: string | null } | null;
    institutes: { name: string | null } | null;
  }[]).map((row) => ({
    id: row.id,
    date: row.date,
    purpose: row.purpose,
    held: row.meetings_actual !== null,
    memberName: row.profiles?.name ?? "Unknown",
    instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
  }));
}
